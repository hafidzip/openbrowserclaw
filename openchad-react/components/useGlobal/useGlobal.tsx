import { useSyncExternalStore, useCallback } from "react";
import type { SetStateAction, Dispatch } from "react";

// ============================================================================
// Types
// ============================================================================

/**
 * The setter function type - identical to React's useState setter
 */
type GlobalSetter<T> = Dispatch<SetStateAction<T>>;

/**
 * The return type of useGlobal - a tuple like useState
 * [data, setData]
 */
type UseGlobalReturn<T> = readonly [T, GlobalSetter<T>];

type Primitive = string | number | boolean | null | undefined;
type GlobalValue =
    | Primitive
    | Primitive[]
    | Record<string, unknown>
    | unknown[];

// ============================================================================
// Lightweight Store — no Valtio, no proxy, no wrapping
// ============================================================================

/** Sentinel so we know a key has truly never been initialised */
const UNINITIALISED = Symbol("UNINITIALISED");

const store = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

/**
 * Ensure a key exists.  Only writes the initial value the very first time
 * the key is registered — subsequent calls with a different initialValue from
 * another component are silently ignored so the first writer wins.
 */
function ensureKey<T>(key: string, initialValue: T | typeof UNINITIALISED): void {
    if (!store.has(key)) {
        store.set(key, initialValue === UNINITIALISED ? undefined : initialValue);
        listeners.set(key, new Set());
    }
}

function getSnapshot<T>(key: string): T {
    return store.get(key) as T;
}

function notifyListeners(key: string): void {
    listeners.get(key)?.forEach((fn) => fn());
}

function subscribe(key: string, listener: () => void): () => void {
    if (!listeners.has(key)) {
        listeners.set(key, new Set());
    }
    listeners.get(key)!.add(listener);
    return () => listeners.get(key)?.delete(listener);
}

function setGlobal<T>(key: string, action: SetStateAction<T>): void {
    const current = store.get(key) as T;
    const next =
        typeof action === "function"
            ? (action as (prev: T) => T)(current)
            : action;

    // Bail out if unchanged — avoids spurious re-renders
    if (Object.is(current, next)) return;

    store.set(key, next);
    notifyListeners(key);
}

// ============================================================================
// Public API — useState-like Hook
// ============================================================================

/**
 * A global state hook with a useState-like API.
 * Uses React's useSyncExternalStore for reactive, concurrent-safe state
 * management across all components. Works correctly with every value type:
 * boolean, null, undefined, string, number, arrays, and objects.
 *
 * @example
 * // Boolean flag
 * const [enabled, setEnabled] = useGlobal("settings.enabled", false);
 * setEnabled(true);
 *
 * @example
 * // Toggle with updater function
 * const [open, setOpen] = useGlobal("modal.open", false);
 * setOpen(prev => !prev);
 *
 * @example
 * // Nullable value (starts as null)
 * const [selectedId, setSelectedId] = useGlobal<string | null>("selectedId", null);
 *
 * @example
 * // Object with typed values
 * interface User { name: string; age: number; }
 * const [user, setUser] = useGlobal<User | null>("currentUser", null);
 *
 * @example
 * // Record/map
 * const [registry, setRegistry] = useGlobal<Record<string, boolean>>("registry", {});
 * setRegistry(prev => ({ ...prev, [id]: true }));
 *
 * @param key          - Unique global key for this state slice
 * @param initialValue - Initial value (required for type inference on primitives)
 * @returns            A tuple [value, setValue] identical to useState
 */

// Overload 1: no initial value → T defaults to Record<string, unknown>
export function useGlobal<T = Record<string, unknown>>(key: string): UseGlobalReturn<T>;

// Overload 2: with initial value → T inferred from initialValue
export function useGlobal<T>(key: string, initialValue: T): UseGlobalReturn<T>;

export function useGlobal<T = Record<string, unknown>>(
    key: string,
    initialValue?: T
): UseGlobalReturn<T> {
    // Register the key exactly once per key (first caller wins)
    ensureKey<T>(key, arguments.length >= 2 ? initialValue! : UNINITIALISED as any);

    // useSyncExternalStore gives React full control: tearing-free, concurrent-mode
    // compatible, and SSR-ready.
    const value = useSyncExternalStore<T>(
        useCallback((listener) => subscribe(key, listener), [key]),
        useCallback(() => getSnapshot<T>(key), [key]),
        // Server snapshot: same as client (this is a client-only store)
        useCallback(() => getSnapshot<T>(key), [key])
    );

    const setValue = useCallback(
        (action: SetStateAction<T>) => setGlobal<T>(key, action),
        [key]
    );

    return [value, setValue] as const;
}

// ============================================================================
// Imperative helpers — for non-hook code (e.g. state.tsx helper functions)
// ============================================================================

/**
 * Initialise a key in the global store at module level (outside React).
 * Safe to call multiple times — only the first call wins (first-writer rule).
 */
export function initGlobal<T>(key: string, initialValue: T): void {
    ensureKey<T>(key, initialValue);
}

/**
 * Read the current value of a global key imperatively.
 * Returns undefined if the key has never been initialised.
 */
export function getGlobal<T>(key: string): T | undefined {
    return store.get(key) as T | undefined;
}

/**
 * Write a new value (or functional updater) to a global key imperatively,
 * notifying all React subscribers exactly like the hook setter does.
 */
export { setGlobal };

/**
 * Force-notify all subscribers for a key after an in-place mutation.
 * Use with the shallow-clone trigger pattern:
 *   tabState[uuid].foo = newValue;
 *   notifyGlobal("TabState");
 */
export function notifyGlobal(key: string): void {
    notifyListeners(key);
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
