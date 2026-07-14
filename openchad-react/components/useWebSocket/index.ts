import { useEffect, useState } from "react";
import type { EventHandler } from "../usePython";
import type { UseWebSocketReturn } from "./useWebSocket";
import { useWebSocketSingleton, useWebSocketEvent as useWebSocketEventImpl } from "./useWebSocket";

export function useWebSocket<T>(): UseWebSocketReturn<T> {
    const [url, setUrl] = useState(typeof window !== 'undefined' ? `ws${window.location.protocol === 'https:' ? 's' : ''}://${(window as any).BASE_URL}/ws` : "ws://localhost:3000/ws");
    
    useEffect(() => {
        const handler = (e: any) => {
            setUrl(e.detail);
        };
        window.addEventListener('websocket-url-change', handler);
        return () => {
            window.removeEventListener('websocket-url-change', handler);
        }
    }, []);

    return useWebSocketSingleton<T>(url);
}

export const useWebSocketEvent = <T = any>(event: string, handler: EventHandler<T>): void => {
    return useWebSocketEventImpl(event, handler)
};