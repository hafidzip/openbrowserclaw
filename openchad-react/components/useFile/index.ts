import { proxy, useSnapshot } from "valtio";
import { type SetStateAction, type Dispatch, useEffect, useRef } from "react";
import { usePython } from "../usePython";
import { sanitizeTauriEvent } from "../../utils/utils";

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;
// ============================================================================
// Type Definitions
// ============================================================================
/**
 * The setter function type - identical to React's useState setter
 */
type FileSetter = Dispatch<SetStateAction<string>>;
/**
 * File utilities returned as the third element
 */
interface FileUtils {
    /** Force refresh the file content from disk */
    refresh: () => Promise<void>;
    /** Get file modification time */
    getMtime: () => Promise<number>;
}
/**
 * Result from file subscription
 */
interface FileSubscriptionResult {
    path?: string;
}
/**
 * The return type of useFile - a tuple like useState
 * [content, setContent, exists, { refresh, getMtime }]
 */
type UseFileReturn = readonly [string, FileSetter, boolean, FileUtils];
// ============================================================================
// Internal Implementation
// ============================================================================
interface IFile {
    content: string;
    exists: boolean;
    mime_type: string;
    setContent: (content: SetStateAction<string>) => void;
    refresh: () => Promise<void>;
    getMtime: () => Promise<number>;
    // Track last modification timestamp
    _lastModified: number;
    // Track subscription count
    _subscriptionCount: number;
    // Track if content has been loaded
    _isLoaded: boolean;
    // Track the resolved file path from Python
    _filePath: string;
}

const files = proxy<Record<string, IFile>>({});
// ============================================================================
// Public API - useState-like Hook
// ============================================================================
/**
 * A file-backed state hook with a useState-like API.
 * Watches the file for changes and auto-syncs using watchfiles.
 * Auto-creates the file if it doesn't exist.
 * 
 * @example
 * // Simple text file
 * const [content, setContent, exists] = useFile("config.txt");
 * setContent("new content");
 * 
 * @example
 * // With initial content
 * const [content, setContent, exists] = useFile("settings.json", "{}");
 * 
 * @example
 * // With custom base directory
 * const [content, setContent, exists] = useFile("data.txt", "", { baseDir: "./data" });
 * 
 * @example
 * // With utilities
 * const [content, setContent, exists, { refresh }] = useFile("notes.txt");
 * if (!exists) console.log("File doesn't exist yet");
 * await refresh(); // Force reload from disk
 * 
 * @param filename - The filename relative to base directory
 * @param initialValue - Optional initial content if file doesn't exist
 * @param options - Optional configuration { baseDir: string }
 * @returns A tuple [content, setContent, exists, { refresh, getMtime }] similar to useState
 */

export function useFileImpl(
    filename: string,
    options: {
        initialValue?: string,
        baseDir?: string,
        width?: number,
        height?: number,
        quality?: number,
        bitrate?: string,
        resolution?: string,
        fps?: number,
        thumbnail?: boolean,
        thumb_time?: string,
        format?: string,
        download?: boolean,
    } = {}
): UseFileReturn {
    const { baseDir = "." } = options;
    const { pyInvoke, isStreamReady } = usePython();
    const fileKey = `${baseDir}:${filename}`;
    const filePathRef = useRef<string>("");
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    function FileURL(src: string): string {
        const params = new URLSearchParams();
        // Add timestamp for cache busting
        params.append('t', Date.now().toString());
        // Add image options
        if (options.width) params.append('width', options.width.toString());
        if (options.height) params.append('height', options.height.toString());
        if (options.quality) params.append('quality', options.quality.toString());
        // Add audio options
        if (options.bitrate) params.append('bitrate', options.bitrate);
        // Add video options
        if (options.resolution) params.append('resolution', options.resolution);
        if (options.fps) params.append('fps', options.fps.toString());
        if (options.thumbnail !== undefined) params.append('thumbnail', options.thumbnail.toString());
        if (options.thumb_time) params.append('thumb_time', options.thumb_time);
        // Add general options
        if (options.format) params.append('format', options.format);
        if (options.download !== undefined) params.append('download', options.download.toString());
        return `/file/${encodeURIComponent(src)}?${params.toString()}`;
    }
    async function request(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
        try {
            const res = await pyInvoke<{ data?: Record<string, unknown>; error?: string }>('file', body);
            if (res && typeof res === 'object' && 'data' in res) {
                return res.data as Record<string, unknown>;
            }
            return null;
        } catch (e) {
            console.error("File request failed", e);
            return null;
        }
    }
    async function refreshFile(filename: string, baseDir: string) {
        const result = await request({
            command: 'read',
            filename,
            base_dir: baseDir,
            initial_content: options.initialValue ?? ""
        });
        if (result) {
            const file = files[fileKey];
            if (file) {
                file.content = result.mime_type !== "text/plain" ? FileURL(result.content as string) : (result.content as string) || "";
                file.mime_type = (result.mime_type as string) || "text/plain";
                file._lastModified = (result.mtime as number) || Date.now();
                file.exists = result.exists === true;
                file._isLoaded = true;
            }
        }
    }
    function setContent(newContent: SetStateAction<string>) {
        const file = files[fileKey];
        if (!file) return;
        let content: string;
        if (typeof newContent === "function") {
            content = newContent(file.content);
        } else {
            content = newContent;
        }
        // Update local state immediately
        file.content = content;
        // Write to file asynchronously
        request({
            command: 'write',
            filename,
            base_dir: baseDir,
            content
        }).then(result => {
            if (result && result.mtime) {
                file._lastModified = result.mtime as number;
                file.mime_type = "text/plain";
                file.exists = true;
            }
        }).catch(e => console.error("File write failed", e));
    }
    function createFile(filename: string, baseDir: string): void {
        files[fileKey] = {
            content: options.initialValue ?? "",
            mime_type: "text/plain",
            exists: false,
            _lastModified: Date.now(),
            _subscriptionCount: 0,
            _isLoaded: false,
            _filePath: "",
            setContent,
            refresh: async () => {
                await refreshFile(filename, baseDir);
            },
            getMtime: async () => {
                const result = await request({
                    command: 'mtime',
                    filename,
                    base_dir: baseDir
                });
                return (result?.mtime as number) || 0;
            },
        };
        // Fetch existing content from file (or create if not exists)
        (async () => {
            await refreshFile(filename, baseDir);
        })();
    }
    if (!files[fileKey]) {
        createFile(filename, baseDir);
    }
    // Subscribe to file change events  works in both WebSocket and Tauri modes
    useEffect(() => {
        const file = files[fileKey];
        if (!file || !isStreamReady) return;
        let eventName = "";
        // Tauri: store the unlisten function
        let tauriUnlisten: (() => void) | undefined;
        // WebSocket mode: event arrives as window CustomEvent with {detail: {response: {timestamp, exists}}}
        const handleFileChangeWS = (event: Event) => {
            const customEvent = event as CustomEvent<{ response: { timestamp: number; exists: boolean } }>;
            const { timestamp, exists: fileExists } = customEvent.detail.response;
            const currentFile = files[fileKey];
            if (currentFile && timestamp > currentFile._lastModified) {
                currentFile._lastModified = timestamp;
                currentFile.exists = fileExists;
                refreshFile(filename, baseDir);
            }
        };
        // Tauri mode: event payload arrives directly as {timestamp, exists}
        const handleFileChangeTauri = (data: { timestamp: number; exists: boolean }) => {
            const { timestamp, exists: fileExists } = data;
            const currentFile = files[fileKey];
            if (currentFile && timestamp > currentFile._lastModified) {
                currentFile._lastModified = timestamp;
                currentFile.exists = fileExists;
                refreshFile(filename, baseDir);
            }
        };
        // Attach listener in the correct mode
        const addListener = async (evtName: string) => {
            if (isTauri) {
                const { listen } = await import("@tauri-apps/api/event");
                tauriUnlisten = await listen<{ timestamp: number; exists: boolean }>(
                    sanitizeTauriEvent(evtName),
                    (e) => handleFileChangeTauri(e.payload)
                );
            } else {
                window.addEventListener(evtName, handleFileChangeWS);
            }
        };
        const setupSubscription = async () => {
            try {
                const result = await pyInvoke<FileSubscriptionResult>('file_subscribe', { filename, base_dir: baseDir }) as FileSubscriptionResult;
                if (!mounted.current) return;
                if (result && result.path) {
                    file._filePath = result.path;
                    filePathRef.current = result.path;
                    eventName = `file_changed:${result.path}`;
                    if (mounted.current) {
                        await addListener(eventName);
                    }
                }
            } catch {
                // Silently fail - server might not support subscriptions yet
            }
        };
        // Increment subscription count and subscribe on first subscriber
        file._subscriptionCount++;
        if (file._subscriptionCount === 1) {
            setupSubscription();
        } else if (file._filePath) {
            // Already have the path, set up listener immediately
            eventName = `file_changed:${file._filePath}`;
            addListener(eventName);
        }
        return () => {
            if (isStreamReady) {
                // Tauri: call the unlisten function; WebSocket: remove window listener
                if (isTauri) {
                    tauriUnlisten?.();
                } else if (eventName) {
                    window.removeEventListener(eventName, handleFileChangeWS);
                }
                const currentFile = files[fileKey];
                if (currentFile) {
                    currentFile._subscriptionCount--;
                    if (currentFile._subscriptionCount === 0) {
                        pyInvoke('file_unsubscribe', { filename, base_dir: baseDir }).catch(() => {});
                    }
                }
            }
        };
    }, [filename, baseDir, fileKey, isStreamReady]);
    const snap = useSnapshot(files[fileKey]);
    return [
        snap.content,
        snap.setContent as FileSetter,
        snap.exists,
        {
            refresh: snap.refresh,
            getMtime: snap.getMtime,
        }
    ] as const;
}
// ============================================================================
// Type Exports
// ============================================================================

export type {
    FileSetter,
    FileUtils,
    UseFileReturn
};