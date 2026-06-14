import Container, { type Project } from "./Container"
import type { AppInfo, Model } from "./utils/utils"
import { usePython, usePythonEvent } from "./components/usePython"
import { sha256 } from 'js-sha256';
import { useDatabaseImplBase } from "./components/useDatabase/useDatabase"
import { useFileImpl } from "./components/useFile";
import { useFolderImpl } from "./components/useFolder";
import useElementSize from "./components/hooks/useElementSize";
import { useGlobal as useGlobalImpl } from "./components/useGlobal";
import type { MessageState } from "./components/default-page";
import { OpenChadIcon } from "./components/open-chad-icon";
import ContainerSingleApp from "./ContainerSingleApp";
import ContainerOverlayApp from "./ContainerOverlayApp";
import { proxy, ref, useSnapshot } from "valtio";
import { MenuBar, Theme, Workspace } from "./utils/state";
import { useEffect, useState } from "react";
import { uuidv4 } from "./utils";
import { AsyncMutex } from "./components/Mutex/mutex";
import { Dropdown, type DropdownMenuItemProps } from "./components/dropdown";

function generateIdFromString(input: string): string {
    /**
     * Generate consistent 32-character hex ID from string.
     * Uses SHA-256 hash truncated to 128 bits (32 hex chars).
     */
    return "tb" + "_" + sha256(input).slice(0, 32);
}

const useTool = <T,>() => {
    const { pyInvoke } = usePython()
    const { workspace } = useSnapshot(Workspace);
    const tabId = "global";
    return (tool: string, parameters: Record<string, any>) => {
        return pyInvoke<T>("tools/execute", { tool, workspace: workspace ?? "global", tabId, ...parameters });
    }
}

const useDatabase = <T,>(tb: string, options?: { initialValue?: T }) => {
    const { workspace } = useSnapshot(Workspace);
    const hashed = generateIdFromString(`${workspace ?? "global"}/${tb}`);
    return (options?.initialValue !== undefined)
        ? useDatabaseImplBase<T>(workspace ?? "global", hashed, options.initialValue)
        : useDatabaseImplBase<T>(workspace ?? "global", hashed);
}

const useFile = (filename: string, options?: {
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
}) => {
    return useFileImpl(filename, options);
}

const useFolder = (path: string, options?: { baseDir?: string }) => {
    return useFolderImpl(path, options);
}

const useGlobal = <T = Record<string, unknown>>(
    tb: string,
    options?: { initialValue?: T }
) => {
    return useGlobalImpl<T>(tb, options);
};

const useTheme = () => {
    return useSnapshot(Theme)
}

const useEvent = <T,>(event: string, callback: (data: T) => void) => {
    useEffect(() => {
        const wrappedCallback = (e: Event) => callback(e as T)
        window.addEventListener(event, wrappedCallback)
        return () => {
            window.removeEventListener(event, wrappedCallback)
        }
    }, [event, callback])
}

const useMenuBar = () => {
    const snap = useSnapshot(MenuBar)
    return [snap.current, MenuBar] as const;
}


const AsyncLock = new AsyncMutex();

function useAvailableModels() {
    const { pyInvoke } = usePython()
    const [models, setModels] = useState<Model[]>([])
    const [isLoading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
            ; (async () => {
                try {
                    const res: any = await pyInvoke('file', {
                        command: 'read',
                        filename: 'config.json',
                        base_dir: 'python',
                    })
                    if (cancelled) return
                    const raw = res?.data?.content as string | undefined
                    if (!raw) return

                    const parsed = JSON.parse(raw)
                    if (!parsed.available_models) return

                    const list: Model[] = (
                        Object.entries(parsed.available_models) as [string, Record<string, unknown>][]
                    )
                        .map(([id, m]) => ({
                            id,
                            name: (m.name as string) ?? 'Unknown',
                            backend: (m.backend as string) ?? null,
                            modelType: (m.model_type as string[]) ?? null,
                            modelPath: (m.model_path as string) ?? null,
                            mmproj: (m.mmproj as string) ?? null,
                            fileName: (m.filename as string) ?? null,
                            apiBase: (m.api_base as string) ?? null,
                            isLocal: (m.is_local as boolean) ?? false,
                            isLoaded: false,
                            lastError: null,
                        } satisfies Model))
                        .filter(m =>
                            (m.modelType?.includes('llm') || m.modelType?.includes('vlm')) === true &&
                            m.backend != null
                        )

                    if (!cancelled) setModels(list)
                } catch (e) {
                    if (!cancelled) console.error('Failed to load models:', e)
                } finally {
                    if (!cancelled) setLoading(false)
                }
            })()
        return () => { cancelled = true }
    }, [pyInvoke])

    return { models, isLoading }
}


export {
    useAvailableModels,
    AsyncLock,
    proxy,
    ref,
    useSnapshot,
    useMenuBar,
    ContainerOverlayApp,
    ContainerSingleApp,
    Container,
    Dropdown,
    type DropdownMenuItemProps,
    useDatabase,
    useTool,
    useFile,
    useFolder,
    useElementSize,
    useGlobal,
    generateIdFromString,
    usePython,
    usePythonEvent,
    OpenChadIcon,
    useTheme,
    useEvent,
    uuidv4,
    type AppInfo,
    type Project,
    type MessageState
} 