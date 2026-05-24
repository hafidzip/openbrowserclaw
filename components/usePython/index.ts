import { useWebSocket } from "../useWebSocket";
import { pyInvoke } from "tauri-plugin-pytauri-api";
import { useCallback, useEffect, useRef, useState } from "react";
import { WebSocketManager } from "../useWebSocket/useWebSocket";

export type EventHandler<T = any> = (data: T) => void;

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;
/**
 * React hook for subscribing to Python backend events.
 * Works seamlessly with both WebSocket (browser) and Tauri (desktop) modes.
 * 
 * @param event Event name to subscribe to (e.g., "task:progress", "notification")
 * @param handler Callback function that receives the event data
 * 
 * @example
 * ```tsx
 * usePythonEvent('task:progress', (data) => {
 *     console.log('Progress:', data.progress);
 * });
 * 
 * usePythonEvent<{ result: string }>('task:complete', (data) => {
 *     console.log('Completed:', data.result);
 * });
 * ```
 */

export function usePythonEvent<T = any>(event: string, handler: EventHandler<T>): void {
    // Use ref to always have latest handler without re-subscribing
    const handlerRef = useRef(handler);
    handlerRef.current = handler;
    useEffect(() => {
        if (isTauri) {
            // Tauri mode: Use @tauri-apps/api/event
            let unlisten: (() => void) | undefined;
            let mounted = true;
            // Dynamic import to avoid bundling issues in browser mode
            import('@tauri-apps/api/event').then(({ listen }) => {
                if (!mounted) return;
                listen<T>(event, (e) => {
                    handlerRef.current(e.payload);
                }).then((unlistenFn) => {
                    if (mounted) {
                        unlisten = unlistenFn;
                    } else {
                        // Component unmounted before listener was ready
                        unlistenFn();
                    }
                }).catch((err) => {
                    console.error(`Failed to listen to Tauri event '${event}':`, err);
                });
            }).catch((err) => {
                console.error(`Failed to import @tauri-apps/api/event:`, err);
            });
            return () => {
                mounted = false;
                unlisten?.();
            };
        } else {
            // WebSocket mode: Use WebSocketManager event system
            const manager = WebSocketManager.getInstance();
            const wrappedHandler = (data: T) => handlerRef.current(data);
            return manager.on(event, wrappedHandler);
        }
    }, [event]); // Only re-subscribe when event name changes
}
/**
 * Listen to a Python event once (one-time subscription).
 * Works with both WebSocket and Tauri modes.
 * 
 * @param event Event name to subscribe to
 * @returns Promise that resolves with the event data
 */

export function oncePythonEvent<T = any>(event: string): Promise<T> {
    return new Promise((resolve, reject) => {
        if (isTauri) {
            import('@tauri-apps/api/event').then(({ once }) => {
                once<T>(event, (e) => {
                    resolve(e.payload);
                }).catch(reject);
            }).catch(reject);
        } else {
            const manager = WebSocketManager.getInstance();
            manager.once<T>(event, resolve);
        }
    });
}

export function usePython() {
    const [, isWsConnected] = useWebSocket();
    const [isStreamReady, setIsStreamReady] = useState(false);
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        if (isTauri) {
            setIsStreamReady(true);
            return;
        }
        if (isWsConnected) {
            const manager = WebSocketManager.getInstance();
            const ws = manager.getWs;
            if (ws && ws.readyState === WebSocket.OPEN) {
                manager.send({ api: "stream_ready" }, 500)
                    .then(() => {
                        setIsStreamReady(true);
                    })
                    .catch(() => {
                        setRefresh(prev => (prev + 1) % 2);
                    });
            }
        }
    }, [isWsConnected, refresh]);
    /**
     * Send a command to the Python backend
     * @param api - The command name (must be registered in Python via @commands.command())
     * @param body - Parameters to pass to the command
     * @param timeout - Optional timeout for the request in ms
     * @returns Promise with the command result or AsyncGenerator for streaming
     */
    const send = useCallback(async <T = any>(api: string, body: Record<string, unknown> = {}, timeout?: number): Promise<T | AsyncGenerator<T, void, unknown>> => {
        const manager = WebSocketManager.getInstance();
        const ws = manager.getWs;
        // Auto-reroute api/{name} → command "api" with { api: "{name}", ...body }
        if (api.startsWith("api/") && api.split("/").length >= 2) {
            const apiPath = api.slice(4); // strip "api/"
            body = { ...body, api: apiPath };
            api = "api";
        }
        try {
            if (isTauri) {
                // Handle streaming for Tauri
                if (body.stream) {
                    const msgId = (body.id as string) || Math.random().toString(36).substring(7);
                    const requestBody = { ...body, id: msgId };
                    const eventName = `chat_stream:${msgId}`;
                    const { listen } = await import('@tauri-apps/api/event');
                    let resolveNext: ((value: IteratorResult<T, void>) => void) | null = null;
                    const queue: T[] = [];
                    let isDone = false;
                    let error: any = null;
                    let rejectNext: ((reason?: any) => void) | null = null;
                    const unlisten = await listen<any>(eventName, (event) => {
                        const payload = event.payload;
                        if (payload.error) {
                            error = payload.error;
                            if (rejectNext) {
                                rejectNext(error);
                                rejectNext = null;
                                resolveNext = null;
                            }
                        } else if (payload.stream_end) {
                            isDone = true;
                            if (resolveNext) {
                                resolveNext({ value: undefined, done: true });
                                resolveNext = null;
                                rejectNext = null;
                            }
                        } else if (payload.response) {
                            if (resolveNext) {
                                resolveNext({ value: payload.response, done: false });
                                resolveNext = null;
                                rejectNext = null;
                            } else {
                                queue.push(payload.response);
                            }
                        }
                    });
                    // Start command
                    await pyInvoke("pytauri_command", {
                        command: api,
                        request: requestBody
                    });
                    return (async function* () {
                        try {
                            while (true) {
                                if (queue.length > 0) {
                                    yield queue.shift()!;
                                    continue;
                                }
                                if (isDone) return;
                                if (error) throw error;
                                const result = await new Promise<IteratorResult<T, void>>((resolve, reject) => {
                                    resolveNext = resolve;
                                    rejectNext = reject;
                                    // Handle race condition where done/error happened while setting up promise
                                    if (isDone) resolve({ value: undefined, done: true });
                                    if (error) reject(error);
                                });
                                if (result.done) return;
                                yield result.value;
                            }
                        } finally {
                            unlisten();
                        }
                    })();
                }
                // Running in Tauri - use pyInvoke
                return await pyInvoke<T>("pytauri_command", {
                    command: api,
                    request: body
                });
            } else if (ws && ws.readyState === WebSocket.OPEN) {
                // Running in browser with WebSocket connection
                try {
                    return await manager.send<T>({ api, body }, timeout ?? 500);
                } catch (err) {
                     throw err;
                }
            }
            // Fallback to HTTP API
            const httpUrl = (api === "api" && body.api)
                ? `/api/custom/${body.api}`
                : `/api/${api}`;
            const response : any = await fetch(httpUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            if (response.body) {
                // We return a generator that yields chunks
                async function* streamResponse(): AsyncGenerator<T, void, unknown> {
                    const reader = response.body!.getReader();
                    const decoder = new TextDecoder();
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            const text = decoder.decode(value, { stream: true });
                            try {
                                yield JSON.parse(text) as T;
                            } catch {
                                yield text as any as T;
                            }
                        }
                    } finally {
                        reader.releaseLock();
                    }
                }
                if (body.stream) {
                    return streamResponse();
                } else {
                    return await response.json() as T;
                }
            }
            return await response.json() as T;
        } catch (error) {
            console.error(`Python command "${api}" failed:`, error);
            throw error;
        }
    }, [isStreamReady]);
    function encodeMessage(label: string, data: ArrayBufferLike | Blob | ArrayBufferView) {
        const labelBytes = new TextEncoder().encode(label);
        const header = new Uint8Array([labelBytes.length]);
        // Convert data to Uint8Array based on its type
        let dataBytes: Uint8Array;
        if (data instanceof Blob) {
            // Blobs need async handling, so use Blob approach instead
            return new Blob([header, labelBytes, data]);
        } else if (data instanceof ArrayBuffer) {
            dataBytes = new Uint8Array(data);
        } else if (ArrayBuffer.isView(data)) {
            dataBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else {
            throw new Error('Unsupported data type');
        }
        // Combine: [1 byte: length] [variable: label] [variable: data]
        const message = new Uint8Array(1 + labelBytes.length + dataBytes.length);
        message.set(header, 0);
        message.set(labelBytes, 1);
        message.set(dataBytes, 1 + labelBytes.length);
        return message;
    }
    const stream = useCallback(async <T = any>(label: string, data: ArrayBufferLike | Blob | ArrayBufferView) => {
        const manager = WebSocketManager.getInstance();
        const ws = manager.getWs;
        try {
            if (isTauri) {
                await pyInvoke<T>("pytauri_command", {
                    command: label,
                    request: data
                });
            } else if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(encodeMessage(label, data));
                } catch (err) {
                    // Silently fail for stream data - connection may have closed mid-stream
                    console.warn(`Stream send failed (connection may have closed): ${err}`);
                }
            }
            // Don't throw if not connected - stream data is fire-and-forget
        } catch (error) {
            console.error(`Python stream "${label}" failed:`, error);
            throw error;
        }
    }, [isStreamReady]);
    function isBinaryData(data: unknown): data is ArrayBufferLike | Blob | ArrayBufferView {
        return data instanceof ArrayBuffer ||
            data instanceof Blob ||
            ArrayBuffer.isView(data);
    }
    const invoke = useCallback(async <T = any>(
        label: string,
        data?: Record<string, unknown> | ArrayBufferLike | Blob | ArrayBufferView,
        timeout?: number
    ): Promise<T | void | AsyncGenerator<T, void, unknown>> => {
        if (data && isBinaryData(data)) {
            await stream(label, data);
        } else {
            return await send<T>(label, (data ?? {}) as Record<string, unknown>, timeout);
        }
    }, [send, stream, isStreamReady]);
    return {
        pyInvoke: invoke,
        isStreamReady,
    };
}