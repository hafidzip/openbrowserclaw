import { useSyncExternalStore, useCallback } from "react";
import type { SetStateAction, Dispatch } from "react";
import { usePython } from "../usePython";
import { sanitizeTauriEvent } from "../../utils/utils";

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;

// ============================================================================
// Module-scope pure utilities
// ============================================================================

function deepParseJson(value: unknown): unknown {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (
            (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
            try {
                return deepParseJson(JSON.parse(trimmed));
            } catch {
                return value;
            }
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed !== value) {
                return deepParseJson(parsed);
            }
        } catch {
            // not JSON, return as-is
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(deepParseJson);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(
                ([k, v]) => [k, deepParseJson(v)]
            )
        );
    }
    return value;
}

function deepEqual(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;
    if (typeof obj1 !== 'object' || obj1 === null || obj2 === null || typeof obj2 !== 'object') {
        return false;
    }
    if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;
    if (Array.isArray(obj1)) {
        if (obj1.length !== obj2.length) return false;
        for (let i = 0; i < obj1.length; i++) {
            if (!deepEqual(obj1[i], obj2[i])) return false;
        }
        return true;
    }
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    if (keys1.length !== keys2.length) return false;
    for (const key of keys1) {
        if (!Object.prototype.hasOwnProperty.call(obj2, key)) return false;
        if (!deepEqual(obj1[key], obj2[key])) return false;
    }
    return true;
}

// ============================================================================
// Types
// ============================================================================

type Primitive = string | number | boolean | null | undefined;

type DatabaseValue =
    | Primitive
    | Primitive[]
    | Record<string, unknown>
    | unknown[];

type DatabaseSetter<T> = Dispatch<SetStateAction<T>>;

interface DatabaseUtils {
    query: (sql: string) => Promise<unknown>;
    ready: boolean;
}

type UseDatabaseReturn<T> = readonly [T, DatabaseSetter<T>, DatabaseUtils];

// ============================================================================
// Internal Wrapper for Primitives
// ============================================================================

const PRIMITIVE_KEY = "__value__";
interface PrimitiveWrapper<T> {
    [PRIMITIVE_KEY]: T;
}

function isPrimitive(value: unknown): value is Primitive {
    return value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean';
}

function isWrappedPrimitive<T>(data: unknown): data is PrimitiveWrapper<T> {
    return typeof data === 'object' &&
        data !== null &&
        PRIMITIVE_KEY in data &&
        Object.keys(data).length === 1;
}

function wrapPrimitive<T>(value: T): PrimitiveWrapper<T> {
    return { [PRIMITIVE_KEY]: value } as PrimitiveWrapper<T>;
}

function unwrapPrimitive<T>(data: PrimitiveWrapper<T>): T {
    return data[PRIMITIVE_KEY];
}

// ============================================================================
// Internal Store Definition
// ============================================================================

interface DbStoreEntry {
    data: unknown;
    _isPrimitive: boolean;
    _isArray: boolean;
    _ready: boolean;
    _lastModified: number;
    listeners: Set<() => void>;
    query: (sql: string, pyInvoke: any) => Promise<unknown>;
    cleanup?: () => void;
}

const dbStores = new Map<string, DbStoreEntry>();
const initialValues = new Map<string, any>();

async function requestQuery(databaseName: string, sql: string, pyInvoke: any): Promise<any> {
    try {
        const res = await pyInvoke('sqlite', { db: databaseName, command: 'query', sql });
        return deepParseJson(res.data);
    } catch (e) {
        console.error("SQLite request failed", e);
        return null;
    }
}

async function refreshTable(databaseName: string, tb: string, pyInvoke: any, initialValue?: any): Promise<void> {
    const dbKey = `${databaseName}.${tb}`;
    const entry = dbStores.get(dbKey);
    if (!entry) return;

    try {
        const rows = await requestQuery(databaseName, `SELECT * FROM "${tb}"`, pyInvoke);
        if (Array.isArray(rows)) {
            const dataMap: Record<string, unknown> = {};
            let detectedPrimitive = false;
            let primitiveValue: unknown = undefined;

            rows.forEach((row: Record<string, unknown>) => {
                if (row.id != null) {
                    const rowId = String(row.id);
                    const parsedRow = { ...row };
                    if (Object.prototype.hasOwnProperty.call(parsedRow, '_v')) {
                        let val = parsedRow._v;
                        if (typeof val === 'string') {
                            try {
                                val = JSON.parse(val);
                            } catch {
                                // Not valid JSON, keep as-is (raw string)
                            }
                        }
                        if (rowId === PRIMITIVE_KEY) {
                            detectedPrimitive = true;
                            primitiveValue = val;
                        } else {
                            dataMap[rowId] = val;
                        }
                    } else {
                        // Legacy behavior: parse JSON strings in all fields
                        for (const key in parsedRow) {
                            const val = parsedRow[key];
                            if (typeof val === 'string') {
                                const trimmed = val.trim();
                                if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                                    try {
                                        const parsed = JSON.parse(val);
                                        if (parsed && typeof parsed === 'object') {
                                            parsedRow[key] = parsed;
                                        }
                                    } catch {
                                        // ignore parse errors
                                    }
                                }
                            }
                        }
                        dataMap[rowId] = parsedRow;
                    }
                }
            });

            const storedInitialValue = initialValues.has(dbKey) ? initialValues.get(dbKey) : initialValue;

            if (detectedPrimitive) {
                let reconciledValue = primitiveValue;
                if (typeof storedInitialValue === 'boolean' && typeof reconciledValue === 'number') {
                    reconciledValue = reconciledValue !== 0;
                }
                const newData = wrapPrimitive(reconciledValue);
                if (!deepEqual(entry.data, newData)) {
                    entry._isPrimitive = true;
                    entry._isArray = false;
                    entry.data = newData;
                }
            } else {
                const keys = Object.keys(dataMap);
                const sortedKeys = [...keys].sort((a, b) => parseInt(a) - parseInt(b));
                const isArrayLike = keys.length > 0 && sortedKeys.every((key, index) => key === String(index));
                const wasInitiallyArray = Array.isArray(storedInitialValue);

                const reconcileTypes = (data: Record<string, unknown>, schema: Record<string, unknown>): Record<string, unknown> => {
                    const result: Record<string, unknown> = { ...data };
                    for (const key in schema) {
                        const schemaVal = schema[key];
                        const dataVal = result[key];
                        if (typeof schemaVal === 'boolean') {
                            if (typeof dataVal === 'number') {
                                result[key] = dataVal !== 0;
                            } else if (typeof dataVal === 'string') {
                                if (dataVal.toLowerCase() === 'true' || dataVal === '1') result[key] = true;
                                if (dataVal.toLowerCase() === 'false' || dataVal === '0') result[key] = false;
                            }
                        } else if (typeof schemaVal === 'number' && typeof dataVal === 'string') {
                            const num = Number(dataVal);
                            if (!isNaN(num)) result[key] = num;
                        }
                    }
                    return result;
                };

                let finalData: unknown;
                if (keys.length === 0 && typeof storedInitialValue !== "undefined") {
                    finalData = storedInitialValue;
                    entry._isArray = wasInitiallyArray;
                    entry._isPrimitive = typeof storedInitialValue !== 'object' && storedInitialValue !== null;
                } else if (isArrayLike && wasInitiallyArray) {
                    finalData = sortedKeys.map(key => dataMap[key]);
                    entry._isArray = true;
                } else if (keys.length === 0 && wasInitiallyArray) {
                    finalData = [];
                    entry._isArray = true;
                } else {
                    finalData = (storedInitialValue && typeof storedInitialValue === 'object' && !Array.isArray(storedInitialValue))
                        ? reconcileTypes(dataMap, storedInitialValue as Record<string, unknown>)
                        : dataMap;
                    entry._isArray = false;
                }

                if (!deepEqual(entry.data, finalData)) {
                    if (rows.length > 0 || typeof entry.data !== "undefined") {
                        entry._isPrimitive = false;
                        entry.data = finalData;
                    }
                }
            }
        }
        
        // Mark as ready and notify listeners of changed state
        entry._ready = true;
        entry.listeners.forEach(l => l());
    } catch (e) {
        console.error("refreshTable failed", e);
    }
}

function setupDbSubscription(databaseName: string, tb: string, entry: DbStoreEntry, pyInvoke: any) {
    const eventName = `db_changed:${databaseName}.${tb}`;

    pyInvoke('db_subscribe', { db: databaseName, table: tb })
        .then(() => {
            refreshTable(databaseName, tb, pyInvoke);
        })
        .catch(() => { });

    let tauriUnlisten: (() => void) | undefined;

    const handleDbChangeWS = (event: Event) => {
        const customEvent = event as CustomEvent<{ response: { timestamp: number } }>;
        let timestamp: number;
        if (customEvent.detail.response && typeof customEvent.detail.response.timestamp === 'number') {
            timestamp = customEvent.detail.response.timestamp;
        } else if ('timestamp' in customEvent.detail) {
            // @ts-ignore
            timestamp = customEvent.detail.timestamp;
        } else {
            return;
        }
        if (timestamp > entry._lastModified) {
            entry._lastModified = timestamp;
            refreshTable(databaseName, tb, pyInvoke);
        }
    };

    const handleDbChangeTauri = (data: { timestamp: number }) => {
        const { timestamp } = data;
        if (timestamp > entry._lastModified) {
            entry._lastModified = timestamp;
            refreshTable(databaseName, tb, pyInvoke);
        }
    };

    if (isTauri) {
        import("@tauri-apps/api/event").then(({ listen }) => {
            listen<{ timestamp: number }>(sanitizeTauriEvent(eventName), (e) => handleDbChangeTauri(e.payload))
                .then((fn) => { tauriUnlisten = fn; })
                .catch(() => { });
        });
    } else {
        window.addEventListener(eventName, handleDbChangeWS);
    }

    entry.cleanup = () => {
        if (isTauri) {
            tauriUnlisten?.();
        } else {
            window.removeEventListener(eventName, handleDbChangeWS);
        }
        pyInvoke('db_unsubscribe', { db: databaseName, table: tb }).catch(() => { });
    };
}

function ensureKey(databaseName: string, tb: string, initialValue: any, pyInvoke: any) {
    const dbKey = `${databaseName}.${tb}`;
    if (!dbStores.has(dbKey)) {
        if (initialValue !== undefined) {
            initialValues.set(dbKey, initialValue);
        }

        const primitiveMode = initialValue !== undefined && isPrimitive(initialValue);
        const arrayMode = Array.isArray(initialValue);

        const entry: DbStoreEntry = {
            data: undefined,
            _isPrimitive: primitiveMode,
            _isArray: arrayMode,
            _ready: false,
            _lastModified: Date.now(),
            listeners: new Set(),
            query: async (sql: string, pyInvoke: any) => {
                const res = await pyInvoke('sqlite', { db: databaseName, command: 'query', sql });
                const result = deepParseJson(res.data);
                const command = sql.trim().split(/\s+/)[0].toUpperCase();
                if (['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'DROP', 'ALTER'].includes(command)) {
                    await refreshTable(databaseName, tb, pyInvoke);
                }
                return result;
            }
        };

        dbStores.set(dbKey, entry);

        // Run initial fetch
        refreshTable(databaseName, tb, pyInvoke, initialValue).catch(e => {
            console.error("Initial refreshTable failed", e);
        });
    }
}

function subscribe(
    databaseName: string,
    tb: string,
    listener: () => void,
    pyInvoke: any,
    isStreamReady: boolean
): () => void {
    const dbKey = `${databaseName}.${tb}`;
    const entry = dbStores.get(dbKey);
    if (!entry) return () => {};

    entry.listeners.add(listener);

    // If this is the first listener, set up subscriptions
    if (entry.listeners.size === 1 && isStreamReady) {
        setupDbSubscription(databaseName, tb, entry, pyInvoke);
    }

    return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) {
            if (entry.cleanup) {
                entry.cleanup();
                entry.cleanup = undefined;
            }
        }
    };
}

// ============================================================================
// Public Hook Implementation
// ============================================================================

export function useDatabaseImplBase<T = Record<string, unknown>>(databaseName: string, tb: string): UseDatabaseReturn<T>;
export function useDatabaseImplBase<T>(databaseName: string, tb: string, initialValue: T): UseDatabaseReturn<T>;

export function useDatabaseImplBase<T = Record<string, unknown>>(
    databaseName: string,
    tb: string,
    initialValue?: T
): UseDatabaseReturn<T> {
    const dbKey = `${databaseName}.${tb}`;
    const { pyInvoke, isStreamReady } = usePython();

    // Register store entry on first mount/call
    ensureKey(databaseName, tb, initialValue, pyInvoke);

    // Stable snapshot function
    const getSnapshot = useCallback((): T => {
        const entry = dbStores.get(dbKey);
        if (!entry) return (initialValues.get(dbKey) ?? initialValue) as T;

        const userData = entry._isPrimitive && isWrappedPrimitive(entry.data)
            ? unwrapPrimitive(entry.data)
            : entry.data;

        return (userData ?? initialValues.get(dbKey) ?? initialValue) as T;
    }, [dbKey, initialValue]);

    // useSyncExternalStore hook
    const value = useSyncExternalStore<T>(
        useCallback((listener) => subscribe(databaseName, tb, listener, pyInvoke, isStreamReady), [databaseName, tb, pyInvoke, isStreamReady]),
        getSnapshot,
        getSnapshot
    );

    // Setter function
    const setData = useCallback((data: SetStateAction<T>) => {
        const entry = dbStores.get(dbKey);
        if (!entry) return;

        const sync = async (obj: object) => {
            entry._lastModified = Date.now() + 500;
            await pyInvoke('sqlite', { db: databaseName, table: tb, command: 'sync_table', data: obj });
        };

        const processDataForSync = (inputData: unknown): Record<string, unknown> => {
            const payload: Record<string, unknown> = {};
            const values = Array.isArray(inputData)
                ? inputData
                : Object.values(inputData as object || {});
            const hasPrimitive = values.some(val =>
                typeof val !== 'object' || val === null || Array.isArray(val)
            );
            if (Array.isArray(inputData)) {
                [...inputData].forEach((val, index) => {
                    if (hasPrimitive || typeof val !== 'object' || val === null || Array.isArray(val)) {
                        payload[String(index)] = { _v: val };
                    } else {
                        payload[String(index)] = val;
                    }
                });
            } else if (typeof inputData === 'object' && inputData !== null) {
                for (const key in { ...inputData } as Record<string, unknown>) {
                    const val = ({ ...inputData } as Record<string, unknown>)[key];
                    if (hasPrimitive || typeof val !== 'object' || val === null || Array.isArray(val)) {
                        payload[key] = { _v: val };
                    } else {
                        payload[key] = val;
                    }
                }
            }
            return payload;
        };

        let newUserData: unknown;
        const currentUserData = entry._isPrimitive && isWrappedPrimitive(entry.data)
            ? unwrapPrimitive(entry.data)
            : entry.data;
        const effectivePrevState = typeof currentUserData !== "undefined" ? currentUserData : (initialValues.get(dbKey) || initialValue || undefined);

        if (typeof data === "function") {
            newUserData = (data as (prevState: unknown) => unknown)(effectivePrevState);
        } else {
            newUserData = data;
        }

        let newInternalData: unknown;
        if (isPrimitive(newUserData)) {
            entry._isPrimitive = true;
            entry._isArray = false;
            newInternalData = wrapPrimitive(newUserData);
        } else if (Array.isArray(newUserData)) {
            entry._isPrimitive = false;
            entry._isArray = true;
            newInternalData = newUserData;
        } else {
            entry._isPrimitive = false;
            entry._isArray = false;
            newInternalData = newUserData;
        }

        // Update local state immediately
        entry.data = newInternalData;
        
        // Notify all subscribers immediately for UI responsiveness
        entry.listeners.forEach(l => l());

        // Sync changes asynchronously to the SQLite DB
        if (typeof newInternalData === "object" && newInternalData !== null) {
            const syncPayload = processDataForSync(newInternalData);
            sync(syncPayload).catch(e => console.error("Sync failed", e));
        }
    }, [databaseName, tb, dbKey, pyInvoke, initialValue]);

    // Stable query function
    const query = useCallback((sql: string) => {
        const entry = dbStores.get(dbKey);
        if (entry) {
            return entry.query(sql, pyInvoke);
        }
        return Promise.resolve(null);
    }, [dbKey, pyInvoke]);

    const entry = dbStores.get(dbKey);
    const ready = isStreamReady && (entry ? entry._ready : false);

    return [
        value,
        setData,
        {
            query,
            ready
        }
    ] as const;
}

export type {
    DatabaseValue,
    DatabaseSetter,
    DatabaseUtils,
    UseDatabaseReturn,
    Primitive
};