import { useDatabaseImplBase, type UseDatabaseReturn } from "./useDatabase";
import { useSnapshot } from "valtio";
import { Workspace } from "../../utils/state";

export function useDatabaseImpl<T>(
    tb: string,
    options?: { initialValue?: T }
): UseDatabaseReturn<T> {
    const initialValue = options?.initialValue;
    const { workspace } = useSnapshot(Workspace);
    const dbName = workspace || "global";
    return (initialValue !== undefined)
        ? useDatabaseImplBase<T>(dbName, tb, initialValue)
        : useDatabaseImplBase<T>(dbName, tb);
}

export type { UseDatabaseReturn };
