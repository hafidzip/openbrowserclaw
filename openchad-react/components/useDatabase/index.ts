import { useDatabaseImplBase, type UseDatabaseReturn } from "./useDatabase";
import { useSnapshot } from "valtio";
import { Workspace } from "../../utils/state";

export function useDatabaseImpl<T>(
    tb: string,
    options?: { initialValue?: T }
): UseDatabaseReturn<T> {
    const initialValue = options?.initialValue;
    // Use useSnapshot so this reacts to workspace changes.
    // The previous snapshot()+useRef approach captured the workspace once on the
    // first render. If Workspace.workspace was null at that point (not yet loaded),
    // it defaulted to "global" and stayed there — causing subscriptions to the wrong
    // database (e.g. "global.ControllableBrowser" instead of "hafidz.ControllableBrowser").
    // useSnapshot causes a re-render when workspace changes, which is acceptable because
    // workspace only changes once (on login / workspace switch), and useDatabaseImplBase
    // will cleanly unsubscribe from the old DB and subscribe to the new one.
    const workspaceSnap = useSnapshot(Workspace);
    const dbName = workspaceSnap.workspace || "global";
    return (initialValue !== undefined)
        ? useDatabaseImplBase<T>(dbName, tb, initialValue)
        : useDatabaseImplBase<T>(dbName, tb);
}

export type { UseDatabaseReturn };
