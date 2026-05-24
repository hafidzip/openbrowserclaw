import { useGlobal as useGlobalImpl } from "./useGlobal";
import type { UseGlobalReturn } from "./useGlobal";

export function useGlobal<T = Record<string, unknown>>(
    tb: string,
    options?: { initialValue?: T }
): UseGlobalReturn<T> {
    return typeof options?.initialValue === 'undefined' ? useGlobalImpl<T>(tb) : useGlobalImpl<T>(tb, options.initialValue);
}

export type { UseGlobalReturn };