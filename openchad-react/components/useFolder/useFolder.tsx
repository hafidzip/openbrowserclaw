import { proxy, useSnapshot } from "valtio";
import { useEffect, useRef } from "react";
import { usePython } from "../usePython";
import { sanitizeTauriEvent } from "../../utils/utils";

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;
// ============================================================================
// Type Definitions
// ============================================================================
/**
 * Folder utilities returned as the third element
 */
interface FolderUtils {
    /** Create the folder if it doesn't exist */
    create: (folder: string) => Promise<void>;
    /** Check if a folder exists */
    isExists: (folder: string) => Promise<boolean>;
    /** Get only subfolders (items ending with '/') */
    folders: string[];
    /** Get only files (items not ending with '/') */
    files: string[];
    path: string;
}
/**
 * Result from folder subscription
 */
interface FolderSubscriptionResult {
    path?: string;
    contents?: string[];
    exists?: boolean;
}
/**
 * The return type of useFolder - a tuple
 * [contents, exists, { refresh, create }]
 */
type UseFolderReturn = readonly [string[], boolean, FolderUtils];
// ============================================================================
// Internal Implementation
// ============================================================================
interface IFolder {
    /** Array of file and folder paths relative to the folder */
    contents: string[];
    /** Whether the folder exists */
    exists: boolean;
    /** Create the folder */
    create: (folder: string) => Promise<void>;
    isExists: (folder: string) => Promise<boolean>;
    // Track last modification timestamp
    _lastModified: number;
    // Track subscription count
    _subscriptionCount: number;
    // Track if contents have been loaded
    _isLoaded: boolean;
    // Track the resolved folder path from Python
    _folderPath: string;
}

const folders = proxy<Record<string, IFolder>>({});
// ============================================================================
// Public API
// ============================================================================
/**
 * A folder-watching hook that provides real-time folder contents.
 * Uses watchfiles for efficient change detection.
 * 
 * @example
 * // Watch current directory
 * const [contents, exists] = useFolder(".");
 * 
 * @example
 * // Watch absolute path
 * const [contents, exists] = useFolder("C:/Users/data");
 * 
 * @example
 * // Watch relative folder
 * const [contents, exists] = useFolder("subfolder");
 * 
 * @example
 * // With base directory
 * const [contents, exists, { refresh, create }] = useFolder("data", { baseDir: "./project" });
 * 
 * Contents format:
 * - Files: "filename.txt"
 * - Folders: "foldername/"
 * - Nested: "folder/file.txt", "folder/subfolder/"
 * 
 * @param path - The folder path (absolute if starts with drive letter, relative otherwise)
 * @param options - Optional configuration { baseDir: string }
 * @returns A tuple [contents, exists, { refresh, create }]
 */

export function useFolderImplBase(
    path: string,
    options: { baseDir?: string } = {}
): UseFolderReturn {
    const { baseDir = "." } = options;
    const { pyInvoke, isStreamReady } = usePython();
    // Determine if path is absolute (Windows style C:/ or Unix style /)
    const isAbsolute = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/");
    const folderKey = isAbsolute ? path : `${baseDir}:${path}`;
    const folderPathRef = useRef<string>("");
    async function request(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
        try {
            const res = await pyInvoke<{ data?: Record<string, unknown>; error?: string }>('folder', body);
            if (res && typeof res === 'object' && 'data' in res) {
                return res.data as Record<string, unknown>;
            }
            return null;
        } catch (e) {
            console.error("Folder request failed", e);
            return null;
        }
    }
    function createFolder(): void {
        folders[folderKey] = {
            contents: [],
            exists: false,
            _lastModified: Date.now(),
            _subscriptionCount: 0,
            _isLoaded: false,
            _folderPath: "",
            create: async (folder: string) => {
                if (folder === "/") {
                    await request({
                        command: 'create',
                        path,
                        base_dir: isAbsolute ? "." : baseDir
                    });
                } else {
                    await request({
                        command: 'create',
                        path: folder,
                        base_dir: isAbsolute ? "." : baseDir
                    });
                }
            },
            isExists: async (folder: string) => {
                const result = await request({
                    command: 'exists',
                    path: folder,
                    base_dir: isAbsolute ? "." : baseDir
                });
                return result?.exists === true;
            }
        };
        // Fetch initial folder contents
        (async () => {
            const result = await request({
                command: 'list',
                path,
                base_dir: isAbsolute ? "." : baseDir,
                recursive: true
            });
            console.log("checking folder: ", result);
            if (result) {
                const folder = folders[folderKey];
                if (folder) {
                    folder.contents = (result.contents as string[]) || [];
                    folder.exists = !!result.exists;
                    folder._lastModified = Date.now();
                    folder._isLoaded = true;
                    if (result.path) {
                        folder._folderPath = result.path as string;
                    }
                }
            }
        })();
    }
    if (!folders[folderKey]) {
        createFolder();
    }
    // Subscribe to folder change events  works in both WebSocket and Tauri modes
    useEffect(() => {
        const folder = folders[folderKey];
        if (!folder || !isStreamReady) return;
        let eventName = "";
        // Tauri: store the unlisten function returned by listen()
        let tauriUnlisten: (() => void) | undefined;
        // WebSocket mode: event arrives as a window CustomEvent with {detail: {response: {...}}}
        const handleFolderChangeWS = (event: Event) => {
            const customEvent = event as CustomEvent<{ response: { timestamp: number; contents: string[]; exists: boolean } }>;
            const { timestamp, contents, exists: folderExists } = customEvent.detail.response;
            const currentFolder = folders[folderKey];
            if (currentFolder && timestamp > currentFolder._lastModified) {
                currentFolder._lastModified = timestamp;
                currentFolder.contents = contents;
                currentFolder.exists = folderExists;
            }
        };
        // Tauri mode: event payload arrives directly as {timestamp, contents, exists}
        const handleFolderChangeTauri = (data: { timestamp: number; contents: string[]; exists: boolean }) => {
            const { timestamp, contents, exists: folderExists } = data;
            const currentFolder = folders[folderKey];
            if (currentFolder && timestamp > currentFolder._lastModified) {
                currentFolder._lastModified = timestamp;
                currentFolder.contents = contents;
                currentFolder.exists = folderExists;
            }
        };
        // Attach listener in the correct mode
        const addListener = async (evtName: string) => {
            if (isTauri) {
                const { listen } = await import("@tauri-apps/api/event");
                tauriUnlisten = await listen<{ timestamp: number; contents: string[]; exists: boolean }>(
                    sanitizeTauriEvent(evtName),
                    (e) => handleFolderChangeTauri(e.payload)
                );
            } else {
                window.addEventListener(evtName, handleFolderChangeWS);
            }
        };
        const setupSubscription = async () => {
            try {
                const result = await pyInvoke<FolderSubscriptionResult>('folder_subscribe', {
                    path,
                    base_dir: isAbsolute ? "." : baseDir
                }) as FolderSubscriptionResult;
                console.log("folder sub: ", result);
                if (result && result.path) {
                    folder._folderPath = result.path;
                    folderPathRef.current = result.path;
                    eventName = `folder_changed:${result.path}`;
                    if (result.contents) {
                        folder.contents = result.contents;
                    }
                    if (typeof result.exists === 'boolean') {
                        folder.exists = result.exists;
                    }
                    folder._isLoaded = true;
                    await addListener(eventName);
                }
            } catch {
                // Silently fail - server might not support subscriptions yet
            }
        };
        // Increment subscription count and subscribe on first subscriber
        folder._subscriptionCount++;
        if (folder._subscriptionCount === 1) {
            setupSubscription();
        } else if (folder._folderPath) {
            // Already have the path, set up listener immediately
            eventName = `folder_changed:${folder._folderPath}`;
            addListener(eventName);
        }
        return () => {
            if (isStreamReady) {
                // Tauri: call the unlisten function; WebSocket: remove window listener
                if (isTauri) {
                    tauriUnlisten?.();
                } else if (eventName) {
                    window.removeEventListener(eventName, handleFolderChangeWS);
                }
                const currentFolder = folders[folderKey];
                if (currentFolder) {
                    currentFolder._subscriptionCount--;
                    if (currentFolder._subscriptionCount === 0) {
                        pyInvoke('folder_unsubscribe', { path, base_dir: isAbsolute ? "." : baseDir }).catch(() => {});
                    }
                }
            }
        };
    }, [path, baseDir, folderKey, isAbsolute, isStreamReady]);
    const snap = useSnapshot(folders[folderKey]);
    const contents = snap.contents as string[];
    return [
        contents,
        snap.exists,
        {
            create: snap.create,
            isExists: snap.isExists,
            folders: contents.filter(item => item.endsWith('/')),
            files: contents.filter(item => !item.endsWith('/')),
            path: baseDir + path
        }
    ] as const;
}
// ============================================================================
// Type Exports
// ============================================================================

export type {
    FolderUtils,
    UseFolderReturn
};