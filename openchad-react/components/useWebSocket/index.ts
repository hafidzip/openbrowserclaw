import type { EventHandler } from "../usePython";
import type { UseWebSocketReturn } from "./useWebSocket";
import { useWebSocketSingleton, useWebSocketEvent as useWebSocketEventImpl } from "./useWebSocket";

export function useWebSocket<T>(): UseWebSocketReturn<T> {
    const url = typeof window !== 'undefined' ? `ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}/ws` : "ws://localhost:3000/ws";
    return useWebSocketSingleton<T>(url);
}

export const useWebSocketEvent = <T = any>(event: string, handler: EventHandler<T>): void => {
    return useWebSocketEventImpl(event, handler)
};