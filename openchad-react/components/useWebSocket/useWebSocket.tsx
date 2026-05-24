import { useState, useEffect, useCallback } from 'react';
import type { EventHandler } from '../usePython';
// Type definitions
interface WebSocketMessage {
    id: number | string;
    [key: string]: any;
}
interface WebSocketResponse<T = any> {
    id?: number | string;
    event?: string;
    response?: T;
    error?: string;
}
interface PendingRequest<T = any> {
    resolve: (value: T | AsyncGenerator<T, void, unknown>) => void;
    reject: (reason: Error) => void;
}
class AsyncStream<T> {
    private queue: T[] = [];
    private resolvers: ((value: IteratorResult<T>) => void)[] = [];
    private ended = false;
    private error: Error | null = null;
    push(value: T) {
        if (this.resolvers.length > 0) {
            this.resolvers.shift()!({ value, done: false });
        } else {
            this.queue.push(value);
        }
    }
    end() {
        this.ended = true;
        while (this.resolvers.length > 0) {
            this.resolvers.shift()!({ value: undefined as any, done: true });
        }
    }
    fail(err: Error) {
        this.error = err;
        while (this.resolvers.length > 0) {
            this.resolvers.shift()!(Promise.reject(err) as any);
        }
    }
    async *[Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
        while (true) {
            if (this.error) throw this.error;
            if (this.queue.length > 0) {
                yield this.queue.shift()!;
                continue;
            }
            if (this.ended) break;
            const result = await new Promise<IteratorResult<T>>((resolve) => {
                this.resolvers.push(resolve);
            });
            if (result.done) break;
            yield result.value;
        }
    }
}

export type UseWebSocketReturn<T = any> = readonly [<R = T>(message: Omit<WebSocketMessage, 'id'> & { id?: number | string }, timeout?: number) => Promise<R | AsyncGenerator<R, void, unknown>>, boolean];

export class WebSocketManager {
    private static instance: WebSocketManager;
    private ws: WebSocket | null = null;
    private url: string = typeof window !== 'undefined' ? `ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}/ws` : "ws://localhost:3000/ws";
    private isConnected: boolean = false;
    private subscribers: Set<(connected: boolean) => void> = new Set();
    private pendingRequests: Map<number | string, PendingRequest> = new Map();
    private activeStreams: Map<number | string, AsyncStream<any>> = new Map();
    private messageId: number = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    // Event emitter functionality
    private eventHandlers: Map<string, Set<EventHandler>> = new Map();
    private onceHandlers: Map<string, Set<EventHandler>> = new Map();
    private constructor() { }
    public static getInstance(): WebSocketManager {
        if (!WebSocketManager.instance) {
            WebSocketManager.instance = new WebSocketManager();
        }
        return WebSocketManager.instance;
    }
    /**
     * Subscribe to a specific event from the backend.
     * @param event Event name (e.g., "task:progress", "notification")
     * @param handler Callback function that receives the event data
     * @returns Unsubscribe function
     */
    public on<T = any>(event: string, handler: EventHandler<T>): () => void {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event)!.add(handler as EventHandler);
        return () => this.off(event, handler);
    }
    /**
     * Unsubscribe from a specific event.
     * @param event Event name
     * @param handler The handler function to remove
     */
    public off<T = any>(event: string, handler: EventHandler<T>): void {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event)!.delete(handler as EventHandler);
            if (this.eventHandlers.get(event)!.size === 0) {
                this.eventHandlers.delete(event);
            }
        }
        if (this.onceHandlers.has(event)) {
            this.onceHandlers.get(event)!.delete(handler as EventHandler);
            if (this.onceHandlers.get(event)!.size === 0) {
                this.onceHandlers.delete(event);
            }
        }
    }
    /**
     * Subscribe to an event for a single occurrence.
     * @param event Event name
     * @param handler Callback function that receives the event data
     * @returns Unsubscribe function
     */
    public once<T = any>(event: string, handler: EventHandler<T>): () => void {
        if (!this.onceHandlers.has(event)) {
            this.onceHandlers.set(event, new Set());
        }
        this.onceHandlers.get(event)!.add(handler as EventHandler);
        return () => this.off(event, handler);
    }
    /**
     * Emit an event to all registered handlers (internal use).
     */
    private emitEvent(event: string, data: any): void {
        // Call regular handlers
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event)!.forEach(handler => {
                try {
                    handler(data);
                } catch (err) {
                    console.error(`Error in event handler for '${event}':`, err);
                }
            });
        }
        // Call once handlers and remove them
        if (this.onceHandlers.has(event)) {
            const handlers = this.onceHandlers.get(event)!;
            this.onceHandlers.delete(event);
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (err) {
                    console.error(`Error in once handler for '${event}':`, err);
                }
            });
        }
        // Also dispatch as CustomEvent for backwards compatibility
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(event, {
                detail: { response: data }
            }));
        }
    }
    /**
     * Get the number of handlers for a specific event.
     */
    public listenerCount(event: string): number {
        const regular = this.eventHandlers.get(event)?.size || 0;
        const once = this.onceHandlers.get(event)?.size || 0;
        return regular + once;
    }
    /**
     * Remove all handlers for a specific event or all events.
     */
    public removeAllListeners(event?: string): void {
        if (event) {
            this.eventHandlers.delete(event);
            this.onceHandlers.delete(event);
        } else {
            this.eventHandlers.clear();
            this.onceHandlers.clear();
        }
    }
    public connect(url: string) {
        // If already connected to the same URL, do nothing
        if (this.ws?.readyState === WebSocket.OPEN && this.url === url) {
            return;
        }
        // If connecting to the same URL, do nothing
        if (this.ws?.readyState === WebSocket.CONNECTING && this.url === url) {
            return;
        }
        // If URL changed or not connected, close existing and connect new
        if (this.ws) {
            this.ws.close();
        }
        this.url = url;
        this.ws = new WebSocket(url);
        this.ws.onopen = () => {
            this.isConnected = true;
            this.notifySubscribers();
            console.log('WebSocket connected');
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
        };
        this.ws.onmessage = async (event: MessageEvent) => {
            try {
                let data: WebSocketResponse;
                // Handle different data types
                if (typeof event.data === 'string') {
                    data = JSON.parse(event.data);
                } else if (event.data instanceof Blob) {
                    // Binary data as Blob - convert to text first
                    const text = await event.data.text();
                    data = JSON.parse(text);
                } else if (event.data instanceof ArrayBuffer) {
                    // Binary data as ArrayBuffer - decode to text
                    const text = new TextDecoder().decode(event.data);
                    data = JSON.parse(text);
                } else {
                    console.error('Unknown message type:', typeof event.data);
                    return;
                }
                if (data) {
                    const { id, event: e, response, error, stream_end } = data as WebSocketResponse & { stream_end?: boolean };
                    if (id !== undefined) {
                        // Check for active stream first
                        if (this.activeStreams.has(id)) {
                            const stream = this.activeStreams.get(id)!;
                            if (error) {
                                stream.fail(new Error(error));
                                this.activeStreams.delete(id);
                            } else if (stream_end) {
                                stream.end();
                                this.activeStreams.delete(id);
                                // Clean up alias key (effective stream id) if present
                                if (response && (response as any)?.id !== undefined) {
                                    this.activeStreams.delete((response as any).id);
                                }
                            } else if (response !== undefined) {
                                stream.push(response);
                            }
                        } else if (this.pendingRequests.has(id)) {
                            const { resolve, reject } = this.pendingRequests.get(id)!;
                            if (error) {
                                reject(new Error(error));
                            } else if (stream_end !== undefined) {
                                // It's a stream!
                                const stream = new AsyncStream<any>();
                                if (response !== undefined) {
                                    stream.push(response);
                                }
                                if (stream_end) {
                                    stream.end();
                                } else {
                                    // Register under WS correlation id
                                    this.activeStreams.set(id, stream);
                                    // ALSO register under the effective stream id (response.id) if
                                    // different, because the backend sends subsequent chunks keyed
                                    // by the chat-specific id (e.g. "tabId_response_..."), not
                                    // the numeric WS correlation id.
                                    const effectiveStreamId = (response as any)?.id;
                                    if (effectiveStreamId !== undefined && effectiveStreamId !== id) {
                                        this.activeStreams.set(effectiveStreamId, stream);
                                    }
                                }
                                resolve(stream[Symbol.asyncIterator]()); // Resolve with the async generator
                            } else {
                                resolve(response);
                            }
                            this.pendingRequests.delete(id);
                        }
                    }
                    // Handle events via the event emitter system
                    if (typeof e === "string") {
                        this.emitEvent(e, response);
                    }
                }
            } catch (err) {
                console.error('Error parsing message:', err);
            }
        };
        this.ws.onclose = () => {
            const wasConnected = this.isConnected;
            this.isConnected = false;
            if (wasConnected) {
                this.notifySubscribers();
            }
            console.log('WebSocket disconnected');
            this.cleanupPendingRequests('WebSocket connection closed');
            this.cleanupActiveStreams('WebSocket connection closed');
            // Attempt reconnect
            if (!this.reconnectTimer) {
                this.reconnectTimer = setTimeout(() => this.connect(this.url), 3000);
            }
        };
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }
    public send<R>(message: Omit<WebSocketMessage, 'id'> & { id?: number | string }, timeout: number = 500): Promise<R | AsyncGenerator<R, void, unknown>> {
        return new Promise<R | AsyncGenerator<R, void, unknown>>((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket is not connected'));
                return;
            }
            const id = message.id ?? this.messageId++;
            const payload: WebSocketMessage = { ...message, id };
            const m = JSON.stringify(payload);
            const timeoutId = setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, timeout);
            this.pendingRequests.set(id, {
                resolve: (data: any) => {
                    clearTimeout(timeoutId);
                    resolve(data);
                },
                reject: (err: Error) => {
                    clearTimeout(timeoutId);
                    reject(err);
                }
            });
            try {
                this.ws.send(m);
            } catch (err) {
                this.pendingRequests.delete(id);
                clearTimeout(timeoutId);
                reject(new Error(`Failed to send message: ${err}`));
            }
        });
    }
    public subscribe(callback: (connected: boolean) => void): () => void {
        this.subscribers.add(callback);
        callback(this.isConnected);
        return () => this.subscribers.delete(callback);
    }
    private notifySubscribers() {
        this.subscribers.forEach(cb => cb(this.isConnected));
    }
    private cleanupPendingRequests(reason: string) {
        this.pendingRequests.forEach(({ reject }) => reject(new Error(reason)));
        this.pendingRequests.clear();
    }
    private cleanupActiveStreams(reason: string) {
        this.activeStreams.forEach((stream) => stream.fail(new Error(reason)));
        this.activeStreams.clear();
    }
    public get getWs() {
        return this.ws;
    }
}

export const useWebSocketSingleton = <T = any>(url: string = typeof window !== 'undefined' ? `ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}/ws` : "ws://localhost:3000/ws"): UseWebSocketReturn<T> => {
    const [isConnected, setIsConnected] = useState(false);
    const manager = WebSocketManager.getInstance();
    useEffect(() => {
        manager.connect(url);
        return manager.subscribe(setIsConnected);
    }, [url]);
    const send = useCallback(<R = T>(message: Omit<WebSocketMessage, 'id'> & { id?: number | string }, timeout?: number) => {
        return manager.send<R>(message, timeout);
    }, []);
    return [send, isConnected] as const;
};
/**
 * React hook for subscribing to WebSocket events.
 * Automatically cleans up the subscription on unmount.
 * 
 * @param event Event name to subscribe to
 * @param handler Callback function that receives the event data
 * 
 * @example
 * ```tsx
 * useWebSocketEvent('task:progress', (data) => {
 *     console.log('Progress:', data.progress);
 * });
 * ```
 */

export const useWebSocketEvent = <T = any>(event: string, handler: EventHandler<T>): void => {
    const manager = WebSocketManager.getInstance();
    useEffect(() => {
        return manager.on(event, handler);
    }, [event, handler]);
};