import { invoke } from "@tauri-apps/api/core";
import { Webview } from "@tauri-apps/api/webview";
import { AsyncLock } from "openchad-react";

export * from "../utils/utils"

export { default as uuidv4 } from "../utils/uuid"

export interface CreateWebviewOptions {
    url?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    incognito?: boolean;
    userAgent?: string;
}

/**
 * Drop-in replacement for `new Webview(win, label, opts)`.
 * Automatically assigns a persistent data directory based on the label.
 */
export async function createWebview(
    label: string,
    options: CreateWebviewOptions = {}
): Promise<Webview | undefined> {
    await AsyncLock.acquire()
    try {
        let w = await Webview.getByLabel(label);
        
        if (!w) {
            await invoke('create_webview', {
                args: {
                    parentLabel: 'main',
                    label,
                    url: options.url ?? 'about:blank',
                    x: options.x ?? 0,
                    y: options.y ?? 0,
                    width: options.width ?? 100,
                    height: options.height ?? 100,
                    incognito: options.incognito,
                    userAgent: options.userAgent,
                },
            });
        }

        w = await Webview.getByLabel(label);
        if (!w) throw new Error(`Webview "${label}" not found after creation`);
        return w;
    } catch (e){
        console.error(e)
    } 
    finally {
        AsyncLock.release()
    }
}
