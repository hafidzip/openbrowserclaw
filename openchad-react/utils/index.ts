import { invoke } from "@tauri-apps/api/core";
import { Webview } from "@tauri-apps/api/webview";
import { AsyncLock, setGlobal } from "openchad-react";
import { Window as TauriWindow } from "@tauri-apps/api/window";
export * from "../utils/utils"

export { default as uuidv4 } from "../utils/uuid"
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    mainWindow: TauriWindow,
    main: Webview,
    empty: Webview,
    options: CreateWebviewOptions = {}
): Promise<Webview | undefined> {
    const url = options.url ?? 'about:blank';

    // Hold the lock only for the synchronous IPC call that creates the OS webview.
    // Everything after (reparent, sleep, URL navigation, page-load wait) is lock-free
    // so it cannot block other tabs' reparent or size-sync operations.
    let w = await (async () => {
        await AsyncLock.acquire();
        try {
            let existing = await Webview.getByLabel(label);
            if (existing) return existing;

            console.warn("Creating webview :", label, "with options :", options)
            const createdLabel = await invoke<string>('create_webview', {
                args: {
                    parentLabel: main.label,
                    label,
                    url: "about:blank",
                    x: options.x ?? 0,
                    y: options.y ?? 0,
                    width: options.width ?? 100,
                    height: options.height ?? 100,
                    incognito: options.incognito,
                    userAgent: options.userAgent,
                },
            });
            return await Webview.getByLabel(createdLabel);
        } catch (e) {
            console.error(e);
            return undefined;
        } finally {
            AsyncLock.release();
        }
    })();

    // From here on: lock-free. Reparents, sleeps, URL nav, and event subscriptions
    // do not need to be serialised against other tabs.
    if (w) {
        try {
            const webview = w;
            await empty.reparent(mainWindow)
            console.warn("reparent: empty");
            await sleep(50)
            window.dispatchEvent(new CustomEvent('refresh-webview-order'))

            if (url === "about:blank") {
                setGlobal(`loading-${label}`, false)
                await sleep(50);
                await main.reparent(mainWindow)
            } else {
                await new Promise(resolve => setTimeout(resolve, 250));
                setGlobal(`loading-${label}`, false)
                await invoke("eval_in_webview", {
                    label,
                    script: `window.location.replace("${url}")`
                })
                await sleep(50);
                await main.reparent(mainWindow)
                await new Promise<void>((resolve) => {
                    let unlisten: (() => void) | undefined;
                    let resolved = false;

                    const cleanUp = () => {
                        if (resolved) return;
                        resolved = true;
                        if (unlisten) unlisten();
                        resolve(undefined);
                    };

                    webview.listen('page_loaded', (event: { payload: { target: string } }) => {
                        if (event.payload.target === label) {
                            cleanUp();
                        }
                    }).then((unlistenFn) => {
                        unlisten = unlistenFn;
                        if (resolved) {
                            unlistenFn();
                        }
                    });

                    setTimeout(cleanUp, 5000);
                });
            }

            console.log("Webview : ", webview);
            console.log("createdLabel : ", label);
            await webview.once('tauri://error', (e) => {
                console.error(`Webview "${label}" failed to create:`, e);
            });

            await webview.listen('fullscreen_changed', (event: { payload: { label: string, isFullscreen: boolean; }; }) => {
                window.dispatchEvent(new CustomEvent('fullscreen_changed', { detail: event.payload }));
            });

            await webview.listen('update_location', (event) => {
                window.dispatchEvent(new CustomEvent('update_location', { detail: event.payload }));
            })
            await webview.listen('update_location_title_icon', (event) => {
                window.dispatchEvent(new CustomEvent('update_location_title_icon', { detail: event.payload }));
            })
            await webview.listen('report_audio_state', (event) => {
                window.dispatchEvent(new CustomEvent('report_audio_state', { detail: event.payload }));
            })
            await webview.listen('delete_tab', async (event) => {
                window.dispatchEvent(new CustomEvent('delete_tab', { detail: event.payload }));
            })
            await webview.listen('switch_tab', async (event) => {
                window.dispatchEvent(new CustomEvent('switch_tab', { detail: event.payload }));
            })
            await webview.listen('create_task', async (event) => {
                window.dispatchEvent(new CustomEvent('create_task', { detail: event.payload }));
            })
            await webview.listen('focus', async (event) => {
                window.dispatchEvent(new CustomEvent('focus', { detail: event.payload }));
            })
        } catch (e) {
            console.error(e)
        }
    }

    window.dispatchEvent(new CustomEvent('update_cdp_ports'))
    if (!w) throw new Error(`Webview "${label}" not found after creation`);
    return w;
}
