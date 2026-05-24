import { proxy, useSnapshot } from "valtio";
import { type SetStateAction, type Dispatch, useEffect, useState } from "react";
import { usePython } from "../usePython";
import { sanitizeTauriEvent } from "../../utils/utils";

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;
// ============================================================================
// Type Utilities for useState-like experience
// ============================================================================
/**
 * Supported primitive types that can be stored in the database
 */
type Primitive = string | number | boolean | null | undefined;
/**
 * Supported data types for useDatabase
 */
type DatabaseValue =
    | Primitive
    | Primitive[]
    | Record<string, unknown>
    | unknown[];
/**
 * The setter function type - identical to React's useState setter
 */
type DatabaseSetter<T> = Dispatch<SetStateAction<T>>;
/**
 * Query utilities returned as the third element
 */
interface DatabaseUtils {
    query: (sql: string) => Promise<unknown>;
    ready: boolean,
}
/**
 * The return type of useDatabase - a tuple like useState
 * [data, setData, { query }]
 */
type UseDatabaseReturn<T> = readonly [T, DatabaseSetter<T>, DatabaseUtils];
// ============================================================================
// Internal Wrapper for Primitives
// ============================================================================

const PRIMITIVE_KEY = "__value__";
interface PrimitiveWrapper<T> {
    [PRIMITIVE_KEY]: T;
}
/**
 * Check if a value is a primitive (not object/array)
 */

function isPrimitive(value: unknown): value is Primitive {
    return value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean';
}
/**
 * Check if stored data is our primitive wrapper
 */

function isWrappedPrimitive<T>(data: unknown): data is PrimitiveWrapper<T> {
    return typeof data === 'object' &&
        data !== null &&
        PRIMITIVE_KEY in data &&
        Object.keys(data).length === 1;
}
/**
 * Wrap a primitive value for storage
 */

function wrapPrimitive<T>(value: T): PrimitiveWrapper<T> {
    return { [PRIMITIVE_KEY]: value } as PrimitiveWrapper<T>;
}
/**
 * Unwrap a primitive value from storage
 */

function unwrapPrimitive<T>(data: PrimitiveWrapper<T>): T {
    return data[PRIMITIVE_KEY];
}
// ============================================================================
// Internal Implementation
// ============================================================================
interface IDatabase {
    data: unknown;
    setData: (data: SetStateAction<unknown>) => void;
    query: (query: string) => Promise<unknown>;
    // Track if this database stores a primitive value
    _isPrimitive: boolean;
    // Track if this database stores an array value
    _isArray: boolean;
    // Track last modification timestamp
    _lastModified: number;
    // Track subscription count
    _subscriptionCount: number;
}

const database = proxy<Record<string, IDatabase>>({});

const initialValues = {} as Record<string, any>;
// ============================================================================
// Public API - useState-like Hook
// ============================================================================
/**
 * A database-backed state hook with a useState-like API.
 * 
 * @example
 * // String value (requires initial value)
 * const [name, setName] = useDatabase("username", "");
 * setName("John");
 * 
 * @example
 * // Boolean flag
 * const [enabled, setEnabled] = useDatabase("settings.enabled", false);
 * setEnabled(true);
 * 
 * @example
 * // Number counter
 * const [count, setCount] = useDatabase("counter", 0);
 * setCount(prev => prev + 1);
 * 
 * @example
 * // Simple string array
 * const [tags, setTags] = useDatabase<string[]>("tags");
 * setTags(prev => [...prev, "new-tag"]);
 * 
 * @example
 * // Record/Object with typed values
 * interface User { name: string; age: number; }
 * const [users, setUsers] = useDatabase<Record<string, User>>("users");
 * setUsers(prev => ({ ...prev, user1: { name: "John", age: 30 } }));
 * 
 * @example
 * // With query utility
 * const [data, setData, { query }] = useDatabase<Record<string, Item>>("items");
 * const results = await query("SELECT * FROM items WHERE active = 1");
 * 
 * @param db - The database table/key name
 * @param initialValue - Optional initial value (required for primitives to enable type inference)
 * @returns A tuple [data, setData, { query }] similar to useState
 */

export function useDatabaseImplBase<T = Record<string, unknown>>(databaseName: string, tb: string): UseDatabaseReturn<T>;
/**
 * Overload with initial value for type inference (required for primitives)
 */

export function useDatabaseImplBase<T>(databaseName: string, tb: string, initialValue: T): UseDatabaseReturn<T>;

export function useDatabaseImplBase<T = Record<string, unknown>>(
    databaseName: string,
    tb: string,
    initialValue?: T
): UseDatabaseReturn<T> {
    const dbKey = `${databaseName}.${tb}`;
    const [ready, setReady] = useState(false)
    if (!initialValues[dbKey] && typeof initialValue !== "undefined") {
        initialValues[dbKey] = initialValue;
    }
    const { pyInvoke, isStreamReady } = usePython();
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
            // Handle quoted/multi-encoded strings like '"{\\"key\\":\\"val\\"}"'
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
    async function request(body: any): Promise<any> {
        try {
            const res = await pyInvoke('sqlite', body);
            return deepParseJson(res.data);    // ← parsing happens here
        } catch (e) {
            console.error("SQLite request failed", e);
            return null;
        }
    }
    async function refreshTable(databaseName: string, tb: string) {
        const rows = await request({ db: databaseName, table: tb, command: 'query', sql: `SELECT * FROM ${tb}` });
        if (Array.isArray(rows)) {
            const dataMap: Record<string, unknown> = {};
            let detectedPrimitive = false;
            let primitiveValue: unknown = undefined;
            rows.forEach((row: Record<string, unknown>) => {
                // Use != null to handle both null and undefined, but allow 0 (falsy but valid)
                if (row.id != null) {
                    const rowId = String(row.id);
                    const parsedRow = { ...row };
                    // Check for wrapped value "_v"
                    if (Object.prototype.hasOwnProperty.call(parsedRow, '_v')) {
                        let val = parsedRow._v;
                        // Always try JSON.parse on strings  the backend serializes all _v values
                        // as JSON, so "false" -> false, "0" -> 0, "\"hello\"" -> "hello", etc.
                        if (typeof val === 'string') {
                            try {
                                val = JSON.parse(val);
                            } catch {
                                // Not valid JSON, keep as-is (raw string)
                            }
                        }
                        // Check if this is our primitive wrapper row (id === "__value__")
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
            // If we detected a primitive wrapper row, use primitive mode
            if (detectedPrimitive) {
                const storedInitialValue = initialValues[`${databaseName}.${tb}`];
                let reconciledValue = primitiveValue;
                // Reconcile primitive type if needed
                if (typeof storedInitialValue === 'boolean' && typeof reconciledValue === 'number') {
                    reconciledValue = reconciledValue !== 0;
                }
                const newData = wrapPrimitive(reconciledValue);
                if (!deepEqual(database[`${databaseName}.${tb}`].data, newData)) {
                    database[`${databaseName}.${tb}`]._isPrimitive = true;
                    database[`${databaseName}.${tb}`]._isArray = false;
                    database[`${databaseName}.${tb}`].data = newData;
                }
            } else {
                // Check if this should be reconstructed as an array
                // An array has sequential numeric keys starting from 0
                const keys = Object.keys(dataMap);
                const sortedKeys = [...keys].sort((a, b) => parseInt(a) - parseInt(b));
                const isArrayLike = keys.length > 0 && sortedKeys.every((key, index) => key === String(index));
                const storedInitialValue = initialValues[`${databaseName}.${tb}`];
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
                    database[`${databaseName}.${tb}`]._isArray = wasInitiallyArray;
                    database[`${databaseName}.${tb}`]._isPrimitive = typeof storedInitialValue !== 'object' && storedInitialValue !== null;
                } else if (isArrayLike && wasInitiallyArray) {
                    // Reconstruct as array, sorted by index
                    finalData = sortedKeys.map(key => dataMap[key]);
                    database[`${databaseName}.${tb}`]._isArray = true;
                } else if (keys.length === 0 && wasInitiallyArray) {
                    // Empty result but initial was array - return empty array
                    finalData = [];
                    database[`${databaseName}.${tb}`]._isArray = true;
                } else {
                    // Apply type reconciliation using initialValue as schema
                    finalData = (storedInitialValue && typeof storedInitialValue === 'object' && !Array.isArray(storedInitialValue))
                        ? reconcileTypes(dataMap, storedInitialValue as Record<string, unknown>)
                        : dataMap;
                    database[`${databaseName}.${tb}`]._isArray = false;
                }
                if (!deepEqual(database[`${databaseName}.${tb}`].data, finalData)) {
                    // Only update if we have data OR if the state was already initialized
                    // This prevents clearing the initialValue when the table is empty on first load
                    if (rows.length > 0 || typeof database[`${databaseName}.${tb}`].data !== "undefined") {
                        database[`${databaseName}.${tb}`]._isPrimitive = false;
                        database[`${databaseName}.${tb}`].data = finalData;
                        if(!ready) setReady(true)
                    }
                }
            }
        }
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
    function setData(data: SetStateAction<unknown>) {
        const db = database[`${databaseName}.${tb}`];
        const sync = async (obj: object) => {
            db._lastModified = Date.now() + 500;
            await request({ db: databaseName, table: tb, command: 'sync_table', data: obj });
        };
        const processDataForSync = (inputData: unknown): Record<string, unknown> => {
            const payload: Record<string, unknown> = {};
            // Check if we need to enforce primitive wrapping for consistency
            // If ANY value is a primitive/array, we must wrap ALL values to ensure consistent schema (id, _v)
            const values = Array.isArray(inputData)
                ? inputData
                : Object.values(inputData as object || {});
            const hasPrimitive = values.some(val =>
                typeof val !== 'object' || val === null || Array.isArray(val)
            );
            if (Array.isArray(inputData)) {
                // For arrays, use numeric indices as keys
                [...inputData].forEach((val, index) => {
                    if (hasPrimitive || typeof val !== 'object' || val === null || Array.isArray(val)) {
                        payload[String(index)] = { _v: val };
                    } else {
                        // Only safe to unwrap if ALL items are objects
                        payload[String(index)] = val;
                    }
                });
            } else if (typeof inputData === 'object' && inputData !== null) {
                for (const key in { ...inputData } as Record<string, unknown>) {
                    const val = ({ ...inputData } as Record<string, unknown>)[key];
                    if (hasPrimitive || typeof val !== 'object' || val === null || Array.isArray(val)) {
                        payload[key] = { _v: val };
                    } else {
                        // Only safe to unwrap if ALL items are objects
                        payload[key] = val;
                    }
                }
            }
            return payload;
        };
        let newUserData: unknown;
        // Get the current user-facing value (unwrapped if primitive)
        const currentUserData = db._isPrimitive && isWrappedPrimitive(db.data)
            ? unwrapPrimitive(db.data)
            : db.data;
        const dbKey = `${databaseName}.${tb}`;
        const effectivePrevState = typeof currentUserData !== "undefined" ? currentUserData : (initialValues[dbKey] || undefined);
        if (typeof data === "function") {
            newUserData = (data as (prevState: unknown) => unknown)(effectivePrevState);
        } else {
            newUserData = data;
        }
        // Determine new internal data
        let newInternalData: unknown;
        // Check if the new value is primitive
        if (isPrimitive(newUserData)) {
            // Mark as primitive mode and wrap
            db._isPrimitive = true;
            db._isArray = false;
            newInternalData = wrapPrimitive(newUserData);
        } else if (Array.isArray(newUserData)) {
            // Mark as array mode
            db._isPrimitive = false;
            db._isArray = true;
            newInternalData = newUserData;
        } else {
            // Not primitive - store directly
            db._isPrimitive = false;
            db._isArray = false;
            newInternalData = newUserData;
        }
        // Update local state immediately
        db.data = newInternalData;
        // Sync to DB if it's an object/map or array (which includes wrapped primitives)
        if (typeof newInternalData === "object" && newInternalData !== null) {
            const syncPayload = processDataForSync(newInternalData);
            sync(syncPayload).catch(e => console.error("Sync failed", e));
        }
    }
    function createDatabase<T>(databaseName: string, tb: string, initialValue?: T): void {
        const primitiveMode = initialValue !== undefined && isPrimitive(initialValue);
        const arrayMode = Array.isArray(initialValue);
        database[`${databaseName}.${tb}`] = {
            data: undefined,
            _isPrimitive: primitiveMode,
            _isArray: arrayMode,
            _lastModified: Date.now(),
            _subscriptionCount: 0,
            query: async (sql: string) => {
                const result = await request({ db: databaseName, command: "query", sql });
                // If the query is a modifying command, refresh the table data
                const command = sql.trim().split(/\s+/)[0].toUpperCase();
                if (['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'DROP', 'ALTER'].includes(command)) {
                    await refreshTable(databaseName, tb);
                }
                return result;
            },
            setData: setData,
        };
        // Fetch existing data from database
        (async () => {
            await refreshTable(databaseName, tb);
            // If no data exists in DB, set the initial value locally WITHOUT syncing to DB
            // This prevents clearing existing data on first load
            if (typeof database[`${databaseName}.${tb}`].data === "undefined" && typeof initialValue !== "undefined") {
                const db = database[`${databaseName}.${tb}`];
                // Set initial data locally without syncing to database
                if (isPrimitive(initialValue)) {
                    db._isPrimitive = true;
                    db._isArray = false;
                    db.data = wrapPrimitive(initialValue);
                } else if (Array.isArray(initialValue)) {
                    db._isPrimitive = false;
                    db._isArray = true;
                    db.data = initialValue;
                } else {
                    db._isPrimitive = false;
                    db._isArray = false;
                    db.data = initialValue;
                }
                // Note: We intentionally do NOT sync here - the table doesn't exist yet
                // or has no data. We only sync when the user explicitly changes the data.
            }
        })();
    }
    if (!database[dbKey]) {
        createDatabase<T>(databaseName, tb, initialValue);
    }
    // Subscribe to database change events  works in both WebSocket and Tauri modes
    useEffect(() => {
        const db = database[dbKey];
        if (!isStreamReady || !db) return;
        // Tauri: store the unlisten function
        let tauriUnlisten: (() => void) | undefined;
        const eventName = `db_changed:${databaseName}.${tb}`;
        db._subscriptionCount++;
        if (db._subscriptionCount >= 1) {
            pyInvoke('db_subscribe', { db: databaseName, table: tb }).then(() => {
                refreshTable(databaseName, tb);
            }).catch(() => {});
        }
        // WebSocket mode: event arrives as window CustomEvent with {detail: {response: {timestamp}}}
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
            const currentDb = database[dbKey];
            if (currentDb && timestamp > currentDb._lastModified) {
                currentDb._lastModified = timestamp;
                refreshTable(databaseName, tb);
            }
        };
        // Tauri mode: event payload arrives directly as {timestamp}
        const handleDbChangeTauri = (data: { timestamp: number }) => {
            const { timestamp } = data;
            const currentDb = database[dbKey];
            if (currentDb && timestamp > currentDb._lastModified) {
                currentDb._lastModified = timestamp;
                refreshTable(databaseName, tb);
            }
        };
        if (isTauri) {
            import("@tauri-apps/api/event").then(({ listen }) => {
                listen<{ timestamp: number }>(sanitizeTauriEvent(eventName), (e) => handleDbChangeTauri(e.payload))
                    .then((fn) => { tauriUnlisten = fn; })
                    .catch(() => {});
            });
        } else {
            window.addEventListener(eventName, handleDbChangeWS);
        }
        return () => {
            if (isStreamReady) {
                if (isTauri) {
                    tauriUnlisten?.();
                } else {
                    window.removeEventListener(eventName, handleDbChangeWS);
                }
                const currentDb = database[dbKey];
                if (currentDb) {
                    currentDb._subscriptionCount--;
                    if (currentDb._subscriptionCount === 0) {
                        pyInvoke('db_unsubscribe', { db: databaseName, table: tb }).catch(() => {});
                    }
                }
            }
        };
    }, [databaseName, tb, dbKey, isStreamReady]);
    const snap = useSnapshot(database[dbKey]);
    // Bridge: unwrap primitive values for seamless user experience
    const userData = snap._isPrimitive && isWrappedPrimitive<T>(snap.data)
        ? unwrapPrimitive<T>(snap.data)
        : snap.data as T;
    // Bridge: the setter already handles wrapping internally
    const setUserData = snap.setData as DatabaseSetter<T>;
    return [
        userData ?? initialValues[dbKey] as T ?? initialValue as T,
        setUserData,
        {
            query: snap.query,
            ready: isStreamReady && ready
        }
    ] as const;
}
// ============================================================================
// Type Exports for Advanced Usage
// ============================================================================

export type {
    DatabaseValue,
    DatabaseSetter,
    DatabaseUtils,
    UseDatabaseReturn,
    Primitive
};