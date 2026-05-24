import { useFolderImplBase } from "./useFolder";
import type { UseFolderReturn, FolderUtils } from "./useFolder";

export function useFolderImpl(
    path: string,
    { baseDir }: { baseDir?: string } = {}
): UseFolderReturn {
    return useFolderImplBase(path, { baseDir });
}

export type { UseFolderReturn, FolderUtils };
