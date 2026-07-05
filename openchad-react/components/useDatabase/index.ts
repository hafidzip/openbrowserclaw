import { useDatabaseImplBase, type UseDatabaseReturn } from "./useDatabase";
import { useWorkspaceState } from "../../utils/state";

export function useDatabaseImpl<T>(
    tb: string,
    options?: { initialValue?: T }
): UseDatabaseReturn<T> {
    const initialValue = options?.initialValue;
    // useWorkspaceState() re-renders when workspace changes (via useSyncExternalStore),
    // so the database will cleanly unsubscribe from the old DB and subscribe to the new one.
    const [{ workspace }] = useWorkspaceState();
    const dbName = workspace || "global";
    return (initialValue !== undefined)
        ? useDatabaseImplBase<T>(dbName, tb, initialValue)
        : useDatabaseImplBase<T>(dbName, tb);
}

export type { UseDatabaseReturn };
