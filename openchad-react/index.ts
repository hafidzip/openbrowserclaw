import Container, { type Project } from "./Container"
import type { AppInfo, Model } from "./utils/utils"
import { usePython, usePythonEvent } from "./components/usePython"
import { sha256 } from 'js-sha256';
import { useDatabaseImplBase } from "./components/useDatabase/useDatabase"
import { useFileImpl } from "./components/useFile";
import { useFolderImpl } from "./components/useFolder";
import useElementSize from "./components/hooks/useElementSize";
import { useGlobal as useGlobalImpl, setGlobal } from "./components/useGlobal";
import type { MessageState } from "./components/default-page";
import { OpenChadIcon } from "./components/open-chad-icon";
import { proxy, ref, useSnapshot } from "valtio";
import { MenuBar, Theme, Workspace } from "./utils/state";
import { useEffect, useState, useCallback, useRef } from "react";
import { uuidv4 } from "./utils";
import { AsyncMutex } from "./components/Mutex/mutex";
import { Dropdown, type DropdownMenuItemProps } from "./components/dropdown";
import { type AgentNode, AgentNodeEditor } from "./AgentNodeEditor";

function generateIdFromString(input: string): string {
    return "tb" + "_" + sha256(input).slice(0, 32);
}

const useTool = <T,>() => {
    const { pyInvoke } = usePython()
    const tabId = "global";
    return (tool: string, parameters: Record<string, any>) => {
        return pyInvoke<T>("tools/execute", { tool, workspace: "global", tabId, ...parameters });
    }
}

const useDatabase = <T,>(tb: string, options?: { initialValue?: T }) => {
    const hashed = generateIdFromString(`global/${tb}`);
    return (options?.initialValue !== undefined)
        ? useDatabaseImplBase<T>("global", hashed, options.initialValue)
        : useDatabaseImplBase<T>("global", hashed);
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
    return snap;
}

if (import.meta.hot) {
    import.meta.hot.dispose((data: any) => {
        // Drain all parked waiters so nothing hangs after the module is replaced
        data.asyncLock?.reset();
        data.asyncLock = (globalThis as any).__AsyncLock__;
        data.webCreationLock?.reset();
        data.webCreationLock = (globalThis as any).__WebCreationLock__;
    });
}
function _getOrCreateLock(): AsyncMutex {
    if (import.meta.hot) {
        const prev = (import.meta.hot.data as any)?.asyncLock;
        if (prev instanceof AsyncMutex) return prev;
    }
    if (!(globalThis as any).__AsyncLock__) {
        (globalThis as any).__AsyncLock__ = new AsyncMutex();
    }
    return (globalThis as any).__AsyncLock__;
}

const AsyncLock = _getOrCreateLock();

function useAvailableModels() {
    const { pyInvoke } = usePython()
    const [models, setModels] = useState<Model[]>([])
    const [isLoading, setLoading] = useState(true)

    const fetchModels = useCallback(async (cancelledRef?: { current: boolean }) => {
        try {
            const res: any = await pyInvoke('file', {
                command: 'read',
                filename: 'config.json',
                base_dir: 'python',
            })
            if (cancelledRef?.current) return
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
                    isLoaded:
                        parsed.models &&
                        Object.prototype.hasOwnProperty.call(parsed.models, id) &&
                        !(parsed.models as Record<string, { last_error?: unknown }>)[id].last_error,
                    lastError:
                        (parsed.models as Record<string, { last_error?: unknown }>)?.[id]?.last_error
                            ? String((parsed.models as Record<string, { last_error?: unknown }>)[id].last_error)
                            : null,
                } satisfies Model))
                .filter(m =>
                    (m.modelType?.includes('llm') || m.modelType?.includes('vlm')) === true &&
                    m.backend != null
                )

            if (!cancelledRef || !cancelledRef.current) setModels(list)
        } catch (e) {
            if (!cancelledRef || !cancelledRef.current) console.error('Failed to load models:', e)
        } finally {
            if (!cancelledRef || !cancelledRef.current) setLoading(false)
        }
    }, [pyInvoke])

    usePythonEvent('model-update', () => {
        fetchModels()
    })

    useEffect(() => {
        const cancelled = { current: false }
        fetchModels(cancelled)
        return () => { cancelled.current = true }
    }, [fetchModels])

    return { models, isLoading }
}


interface IAgent {
    id?: string | null,
    name?: string | null,
    icon?: string | null,
    timestamp?: number | null,
}

function useAvailableAgents() {
    const { pyInvoke } = usePython()
    const [agents, setAgents] = useState<IAgent[]>([])
    const [isLoading, setLoading] = useState(true)

    const fetchAgents = useCallback(async (cancelledRef?: { current: boolean }) => {
        try {
            const db = "global"
            const res: any = await pyInvoke('sqlite', {
                db,
                command: 'query',
                sql: 'SELECT id, metadata FROM agents',
                params: []
            })
            if (cancelledRef?.current) return

            const rows: any[] = res?.data ?? (Array.isArray(res) ? res : [])
            if (!Array.isArray(rows)) return

            const list: IAgent[] = rows.map((row: any) => {
                try {
                    const m = JSON.parse(row.metadata)
                    return {
                        id: row.id,
                        name: (m.name as string) ?? 'Unknown',
                        icon: (m.icon as string) ?? null,
                        timestamp: (m.timestamp as number) ?? 0
                    }
                } catch {
                    return {
                        id: row.id,
                        name: 'Unknown',
                        icon: null,
                        timestamp: 0
                    }
                }
            })

            if (!cancelledRef || !cancelledRef.current) setAgents(list)
        } catch (e) {
            if (!cancelledRef || !cancelledRef.current) console.error('Failed to load agents:', e)
        } finally {
            if (!cancelledRef || !cancelledRef.current) setLoading(false)
        }
    }, [pyInvoke])  // stable — workspace read via ref, not as dep

    usePythonEvent('agents-update', () => {
        fetchAgents()
    })

    // Initial fetch on mount
    useEffect(() => {
        const cancelled = { current: false }
        fetchAgents(cancelled)
        return () => { cancelled.current = true }
    }, [fetchAgents])

    return { agents, isLoading, fetchAgents }
}


export {
    AgentNodeEditor,
    useAvailableModels,
    useAvailableAgents,
    AsyncLock,
    proxy,
    ref,
    useSnapshot,
    useMenuBar,
    Container,
    Dropdown,
    type DropdownMenuItemProps,
    useDatabase,
    useTool,
    useFile,
    useFolder,
    useElementSize,
    useGlobal,
    setGlobal,
    generateIdFromString,
    usePython,
    usePythonEvent,
    OpenChadIcon,
    useTheme,
    useEvent,
    uuidv4,
    type AgentNode,
    type AppInfo,
    type Project,
    type MessageState,
    type IAgent
} 