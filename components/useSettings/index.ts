import { useCallback, useEffect, useRef, useState } from "react";
import { usePython } from "../usePython";

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;
// ============================================================================
// Types
// ============================================================================

export interface SettingItem {
    key: string;
    value: any;
    type: "string" | "int" | "float" | "boolean" | "array";
    source: string;
    section: string;
    default_value: any;
    updated_at: string;
}

export interface UseSettingsReturn {
    settings: Record<string, SettingItem>;
    sources: string[];
    loading: boolean;
    updateSetting: (key: string, value: any) => Promise<boolean>;
    resetSetting: (key: string) => Promise<boolean>;
    refresh: () => Promise<void>;
}
// ============================================================================
// Hook
// ============================================================================
/**
 * Hook for accessing and editing settings from the backend.
 * Returns all settings across all sources for the current workspace.
 *
 * @example
 * ```tsx
 * const { settings, sources, updateSetting, resetSetting } = useSettings();
 * ```
 */

export function useSettings(): UseSettingsReturn {
    const { pyInvoke, isStreamReady } = usePython();
    const [settings, setSettings] = useState<Record<string, SettingItem>>({});
    const [sources, setSources] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const mountedRef = useRef(true);
    const fetchSettings = useCallback(async () => {
        if (!isStreamReady) return;
        setLoading(true);
        try {
            // Fetch all settings
            const res: any = await pyInvoke("settings/get_all");
            if (mountedRef.current && res?.settings) {
                const items = res.settings as SettingItem[];
                const record: Record<string, SettingItem> = {};
                // Backend returns items sorted by source, section, key
                // "First one wins" for short names
                items.forEach(item => {
                    const fullKey = item.key;
                    // 1. Full Key (Primary) - e.g. "Others/app_settings/string.pipeline"
                    record[fullKey] = item;
                });
                setSettings(record);
            }
            // Fetch sources
            const srcRes: any = await pyInvoke("settings/sources");
            if (mountedRef.current && srcRes?.sources) {
                setSources(srcRes.sources);
            }
        } catch (err) {
            console.error("Failed to fetch settings:", err);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [isStreamReady, pyInvoke]);
    useEffect(() => {
        mountedRef.current = true;
        fetchSettings();
        return () => {
            mountedRef.current = false;
        };
    }, [fetchSettings]);
    // Real-time subscription  works in both WebSocket and Tauri modes
    useEffect(() => {
        if (!isStreamReady) return;
        pyInvoke("settings/subscribe").catch(console.error);
        const eventName = "settings_changed";
        let tauriUnlisten: (() => void) | undefined;
        const handleSettingsChange = () => {
            fetchSettings();
        };
        if (isTauri) {
            // Tauri: listen via @tauri-apps/api/event; payload is ignored (we just re-fetch)
            import("@tauri-apps/api/event").then(({ listen }) => {
                listen(eventName, () => fetchSettings())
                    .then((fn) => { tauriUnlisten = fn; })
                    .catch(console.error);
            });
        } else {
            // WebSocket: event arrives as a window CustomEvent
            window.addEventListener(eventName, handleSettingsChange);
        }
        return () => {
            if (isTauri) {
                tauriUnlisten?.();
            } else {
                window.removeEventListener(eventName, handleSettingsChange);
            }
            pyInvoke("settings/unsubscribe").catch(console.error);
        };
    }, [isStreamReady, pyInvoke, fetchSettings]);
    const updateSetting = useCallback(
        async (aliasedKey: string, value: any): Promise<boolean> => {
            const actualKey = settings[aliasedKey]?.key || aliasedKey;
            try {
                const res: any = await pyInvoke("settings/set", { key: actualKey, value });
                if (res?.success) {
                    // Optimistic local update for all aliases pointing to this setting
                    setSettings((prev) => {
                        if (!prev[actualKey]) return prev;
                        const next = { ...prev };
                        const updatedItem = { ...prev[actualKey], value };
                        Object.keys(prev).forEach(k => {
                            if (prev[k].key === actualKey) {
                                next[k] = updatedItem;
                            }
                        });
                        return next;
                    });
                    return true;
                }
                return false;
            } catch (err) {
                console.error("Failed to update setting:", err);
                return false;
            }
        },
        [pyInvoke, settings]
    );
    const resetSetting = useCallback(
        async (aliasedKey: string): Promise<boolean> => {
            const actualKey = settings[aliasedKey]?.key || aliasedKey;
            try {
                const res: any = await pyInvoke("settings/reset", { key: actualKey });
                if (res?.success) {
                    // Refresh to get the default value from backend
                    await fetchSettings();
                    return true;
                }
                return false;
            } catch (err) {
                console.error("Failed to reset setting:", err);
                return false;
            }
        },
        [pyInvoke, fetchSettings, settings]
    );
    return {
        settings,
        sources,
        loading,
        updateSetting,
        resetSetting,
        refresh: fetchSettings,
    };
}