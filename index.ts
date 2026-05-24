import Container, { type Project } from "./Container"
import type { AppInfo } from "./utils/utils"
import { usePython } from "./components/usePython"
import { sha256 } from 'js-sha256';
import { useDatabaseImplBase } from "./components/useDatabase/useDatabase"
import { useFileImpl } from "./components/useFile";
import { useFolderImpl } from "./components/useFolder";
import useElementSize from "./components/hooks/useElementSize";
import { useGlobal as useGlobalImpl } from "./components/useGlobal";
import { MessageState } from "./components/default-page";
import { OpenChadIcon } from "./components/open-chad-icon";

function generateIdFromString(input: string): string {
    /**
     * Generate consistent 32-character hex ID from string.
     * Uses SHA-256 hash truncated to 128 bits (32 hex chars).
     */
    return "tb" + "_" + sha256(input).slice(0, 32);
}

const useTool = <T,>() => {
    const { pyInvoke } = usePython()
    const workspace = "global";
    const tabId = "global";
    return (tool: string, parameters: Record<string, any>) => {
        return pyInvoke<T>("tools/execute", { tool, workspace, tabId, ...parameters });
    }
}

const useDatabase = <T,>(tb: string, options?: { initialValue?: T }) => {
    const hashed = generateIdFromString("global/" + tb);
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


export {
    Container,
    useDatabase,
    useTool,
    useFile,
    useFolder,
    useElementSize,
    useGlobal,
    generateIdFromString,
    usePython,
    OpenChadIcon,
    type AppInfo,
    type Project,
    type MessageState
} 