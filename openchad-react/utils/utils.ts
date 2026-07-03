import type { UseDatabaseReturn } from "../components/useDatabase/useDatabase";
import type { ITab } from "./state";
import type { UseFileReturn } from "../components/useFile";
import type { UseFolderReturn } from "../components/useFolder";
import type { UseGlobalReturn } from "../components/useGlobal/useGlobal";
import type { SettingItem } from "../components/useSettings";
import type { IAgent } from "openchad-react";
import { Webview } from "@tauri-apps/api/webview";
import { Window as TauriWindow } from "@tauri-apps/api/window";

export interface Model {
    id?: string | null;
    name?: string | null;
    backend?: string;
    modelType?: string[];
    modelPath?: string;
    mmproj?: string | null;
    fileName?: string | null;
    apiBase?: string | null;
    isLoaded?: boolean;
    isLocal?: boolean;
    lastError?: string | null;
}

export function sanitizeTauriEvent(event: string): string {
    return event
        .replace(/\\/g, '/')           // backslash → forward slash (allowed)
        .replace(/[^a-zA-Z0-9\-/:_]/g, '_'); // everything else illegal → underscore
}

export interface AppInfo {
    mainWindowRef: React.RefObject<TauriWindow | null>;
    mainWebviewRef: React.RefObject<Webview | null>;
    allRef: React.RefObject<Webview[] | null>;
    emptyRef: React.RefObject<Webview | null>;
    appname: string;
    useWorkspace: () => {
        workspace: string;
        setWorkspace: (workspace: string) => void;
    };
    tabId: string;
    appId: string;
    useActiveTabId: () => string;
    useTitle: () => string | null;
    setTitle: (title: string) => void;
    setIcon: (icon: string) => void;
    settings: Record<string, SettingItem>;
    useNotchVisible: () => boolean;
    useTheme: () => {
        theme: string,
        layout: string,
    };
    useTab: () => ITab;
    addTab: (tabs: { app: string; data?: Record<string, any> }[] | { app: string; data?: Record<string, any> }, layout?: string) => string[];
    closeTab: () => void;
    detachTab: () => void;
    useTool: () => (tool: string, parameters: Record<string, any>) => Promise<any>;
    useTabDatabase: <T>(tb: string, options?: {
        initialValue?: T | undefined;
    }) => UseDatabaseReturn<T>;
    useModel: () => UseDatabaseReturn<Model>;
    useAgent: () => UseDatabaseReturn<IAgent>;
    getAvailableModels: () => Promise<Model[]>;
    useGlobal: <T>(name: string, options?: { initialValue?: T }) => UseGlobalReturn<T>;
    useFile: (filename: string, options?: {
        initialValue?: string;
        baseDir?: string;
        width?: number;
        height?: number;
        quality?: number;
        bitrate?: string;
        resolution?: string;
        fps?: number;
        thumbnail?: boolean;
        thumb_time?: string;
        format?: string;
        download?: boolean;
    }) => UseFileReturn;
    useFolder: (path: string, options?: { baseDir?: string }) => UseFolderReturn;
    pyInvoke: <T = any>(
        label: string,
        data?: Record<string, unknown> | ArrayBufferLike | Blob | ArrayBufferView,
        timeout?: number
    ) => Promise<T | void | AsyncGenerator<T, void, unknown>>
}
