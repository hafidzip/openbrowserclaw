import { proxy, useSnapshot } from "valtio";
import type { SetStateAction, Dispatch } from "react";
// ============================================================================
// Type Utilities for useState-like experience
// ============================================================================
/**
 * Supported primitive types that can be stored globally
 */
type Primitive = string | number | boolean | null | undefined;
/**
 * Supported data types for useGlobal
 */
type GlobalValue =
    | Primitive
    | Primitive[]
    | Record<string, unknown>
    | unknown[];
/**
 * The setter function type - identical to React's useState setter
 */
type GlobalSetter<T> = Dispatch<SetStateAction<T>>;
/**
 * The return type of useGlobal - a tuple like useState
 * [data, setData]
 */
type UseGlobalReturn<T> = readonly [T, GlobalSetter<T>];
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
interface IGlobal {
    data: unknown;
    setData: (data: SetStateAction<unknown>) => void;
    // Track if this global stores a primitive value
    _isPrimitive: boolean;
}

const globalStore = proxy<Record<string, IGlobal>>({});

function createGlobal<T>(key: string, initialValue?: T): void {
    // Determine if this is a primitive type based on initial value
    const primitiveMode = initialValue !== undefined && isPrimitive(initialValue);
    // For primitives, wrap the initial value
    // For objects/arrays, use as-is
    let internalData: unknown;
    if (primitiveMode) {
        internalData = wrapPrimitive(initialValue);
    } else if (initialValue !== undefined) {
        internalData = initialValue;
    } else {
        internalData = {};
    }
    globalStore[key] = {
        data: internalData,
        _isPrimitive: primitiveMode,
        setData: (data: SetStateAction<unknown>) => {
            const store = globalStore[key];
            let newUserData: unknown;
            // Get the current user-facing value (unwrapped if primitive)
            const currentUserData = store._isPrimitive && isWrappedPrimitive(store.data)
                ? unwrapPrimitive(store.data)
                : store.data;
            if (typeof data === "function") {
                newUserData = (data as (prevState: unknown) => unknown)(currentUserData);
            } else {
                newUserData = data;
            }
            // Determine new internal data
            let newInternalData: unknown;
            // Check if the new value is primitive
            if (isPrimitive(newUserData)) {
                // Mark as primitive mode and wrap
                store._isPrimitive = true;
                newInternalData = wrapPrimitive(newUserData);
            } else {
                // Not primitive - store directly
                store._isPrimitive = false;
                newInternalData = newUserData;
            }
            // Update state
            store.data = newInternalData;
        },
    };
}
// ============================================================================
// Public API - useState-like Hook
// ============================================================================
/**
 * A global state hook with a useState-like API.
 * Uses valtio for reactive state management across components.
 * 
 * @example
 * // String value (requires initial value)
 * const [name, setName] = useGlobal("username", "");
 * setName("John");
 * 
 * @example
 * // Boolean flag
 * const [enabled, setEnabled] = useGlobal("settings.enabled", false);
 * setEnabled(true);
 * 
 * @example
 * // Number counter
 * const [count, setCount] = useGlobal("counter", 0);
 * setCount(prev => prev + 1);
 * 
 * @example
 * // Simple string array
 * const [tags, setTags] = useGlobal<string[]>("tags", []);
 * setTags(prev => [...prev, "new-tag"]);
 * 
 * @example
 * // Record/Object with typed values
 * interface User { name: string; age: number; }
 * const [users, setUsers] = useGlobal<Record<string, User>>("users", {});
 * setUsers(prev => ({ ...prev, user1: { name: "John", age: 30 } }));
 * 
 * @param key - The unique key for this global state
 * @param initialValue - Optional initial value (required for primitives to enable type inference)
 * @returns A tuple [data, setData] similar to useState
 */

export function useGlobal<T = Record<string, unknown>>(key: string): UseGlobalReturn<T>;
/**
 * Overload with initial value for type inference (required for primitives)
 */

export function useGlobal<T>(key: string, initialValue: T): UseGlobalReturn<T>;

export function useGlobal<T = Record<string, unknown>>(
    key: string,
    initialValue?: T
): UseGlobalReturn<T> {
    if (!globalStore[key]) {
        createGlobal<T>(key, initialValue);
    }
    const snap = useSnapshot(globalStore[key]);
    // Bridge: unwrap primitive values for seamless user experience
    const userData = snap._isPrimitive && isWrappedPrimitive<T>(snap.data)
        ? unwrapPrimitive<T>(snap.data)
        : snap.data as T;
    // Bridge: the setter already handles wrapping internally
    const setUserData = snap.setData as GlobalSetter<T>;
    return [userData, setUserData] as const;
}
// ============================================================================
// Type Exports for Advanced Usage
// ============================================================================

export type {
    GlobalValue,
    GlobalSetter,
    UseGlobalReturn,
    Primitive
};
