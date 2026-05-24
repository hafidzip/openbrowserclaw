import { useState, useEffect, useCallback, memo } from "react";
import { Trash2,  HardDrive, CheckCircle2, AlertCircle, FolderOpen } from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";
import { usePython } from "./usePython";
import { Spinner } from "./ui/spinner";
import clsx from "clsx";
import { revealItemInDir } from '@tauri-apps/plugin-opener';

interface LocalModel {
    id: string;
    name: string;
    backend: string | null;
    modelPath: string | null;
    fileName: string | null;
    mmproj: string | null;
    isLocal: boolean;
    isLoaded: boolean;
    lastError: string | null;
    multimodal?: boolean;
}

/** Returns true if the model_path starts with "Models\\"  these are bundled/internal and should be hidden. */

function isBundledModel(modelPath: string | null): boolean {
    if (!modelPath) return false;
    return modelPath.startsWith("Models\\") || modelPath.startsWith("Models/");
}

function parseLocalModels(raw: string): LocalModel[] {
    const parsed = JSON.parse(raw);
    const available = parsed.available_models ?? {};
    const loaded = parsed.models ?? {};
    return (Object.entries(available) as [string, Record<string, unknown>][])
        .filter(([, m]) => m.is_local === true)
        .filter(([, m]) => !isBundledModel(m.model_path as string | null))
        .map(([id, m]) => ({
            id,
            name: (m.name as string) ?? "Unknown",
            backend: (m.backend as string) ?? null,
            modelPath: (m.model_path as string) ?? null,
            fileName: (m.filename as string) ?? null,
            mmproj: (m.mmproj_path as string) ?? null,
            isLocal: true,
            isLoaded:
                Object.prototype.hasOwnProperty.call(loaded, id) &&
                !(loaded as Record<string, { last_error?: unknown }>)[id]?.last_error,
            lastError:
                (loaded as Record<string, { last_error?: unknown }>)?.[id]?.last_error
                    ? String((loaded as Record<string, { last_error?: unknown }>)[id].last_error)
                    : null,
            multimodal: (m.multimodal as boolean) ?? false,
        }));
}
/** Returns a human-readable short path  just the filename + parent folder. */

function shortPath(modelPath: string | null, fileName: string | null): string {
    if (!modelPath && !fileName) return "";
    if (!fileName) return modelPath ?? "";
    const full = modelPath ? `${modelPath}${fileName}` : fileName;
    // Show only the last two path segments
    const parts = full.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : parts.join("/");
}

function backendLabel(backend: string | null): string {
    if (!backend) return "";
    return backend.split("/").pop() ?? backend;
}

const ModelRow = memo(({
    model,
    isSelected,
    onToggle,
    onDelete,
}: {
    model: LocalModel;
    isSelected: boolean;
    onToggle: (id: string) => void;
    onDelete: (fullPath: string) => void;
}) => (
    <TableRow className="border-accent/5 hover:bg-accent/5 transition-colors h-12 group">
        {/* Checkbox */}
        <TableCell className="w-10 cursor-default" onClick={e => e.stopPropagation()}>
            <Checkbox checked={isSelected} onCheckedChange={() => onToggle(model.id)} />
        </TableCell>
        {/* Icon */}
        <TableCell className="w-8">
            <HardDrive className="w-3.5 h-3.5 text-muted-foreground/60" />
        </TableCell>
        {/* Name */}
        <TableCell className="font-medium text-xs max-w-[160px] truncate">
            <div className="flex items-center gap-1.5">
                <span className="truncate">{model.name}</span>
                {model.multimodal && (
                    <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-accent/20 text-muted-foreground font-mono">
                        VLM
                    </span>
                )}
            </div>
        </TableCell>
        {/* Path */}
        <TableCell
            className="font-mono text-[10px] text-muted-foreground max-w-[180px] truncate select-none"
            title={[model.modelPath, model.fileName].filter(Boolean).join("")}
        >
            {shortPath(model.modelPath, model.fileName)}
        </TableCell>
        {/* Status + backend */}
        <TableCell className="w-28 text-right pr-3">
            <span className="inline-flex items-center gap-2">
                {/* Backend badge */}
                {model.backend && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/10 text-muted-foreground font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                        {backendLabel(model.backend)}
                    </span>
                )}
                {/* Loaded indicator */}
                {model.isLoaded && !model.lastError && (
                    <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="Loaded" />
                )}
                {model.lastError && (
                    <AlertCircle
                        className="w-3.5 h-3.5 text-destructive shrink-0"
                    />
                )}
                <button
                    className="hover:text-destructive text-muted-foreground transition-colors opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                        e.stopPropagation();
                        // Tauri API:    reveal the file in Explorer / Finder
                        // console.warn();
                        revealItemInDir([model.modelPath, model.fileName].filter(Boolean).join(""));
                    }}
                    title="Open containing folder"
                >
                    <FolderOpen className="w-3.5 h-3.5" />
                </button>
                {/* Delete */}
                <button
                    className="hover:text-destructive text-muted-foreground transition-colors opacity-0 group-hover:opacity-100"
                    onClick={e => { e.stopPropagation(); onDelete([model.modelPath, model.fileName].filter(Boolean).join("")); }}
                    title="Remove model"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </span>
        </TableCell>
    </TableRow>
));


function Toast({ message, type }: { message: string; type: "success" | "error" }) {
    return (
        <div className={clsx(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-xs animate-in fade-in slide-in-from-bottom-2 duration-200",
            type === "success"
                ? "bg-green-500/10 text-green-600 border border-green-500/20"
                : "bg-destructive/10 text-destructive border border-destructive/20"
        )}>
            {type === "success"
                ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
            <span className="truncate">{message}</span>
        </div>
    );
}

export default function LocalModel({
    isOpen,
    selectModel,
    addLocalModel,
    deleteLocalModel,
}: {
    isOpen: boolean;
    /** Opens the native file picker and returns the selected paths. */
    selectModel: () => Promise<string[] | undefined>;
    /** Called after selectModel resolves  persists the new paths to settings. */
    addLocalModel: (paths: string[]) => Promise<void>;
    /** Called when the user removes a model  persists the change to settings. */
    deleteLocalModel: (modelId: string) => Promise<void>;
}) {
    const { pyInvoke } = usePython();
    const [models, setModels] = useState<LocalModel[]>([]);
    const [loading, setLoading] = useState(false);
    const [adding, setAdding] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
    //  Toast helper 
    const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 2500);
    }, []);
    //  Load models from config.json 
    const loadModels = useCallback(async () => {
        if (!isOpen) return;
        setLoading(true);
        try {
            const res  : any = await pyInvoke<{ data?: Record<string, unknown> }>('file', {
                command: "read",
                filename: "config.json",
                base_dir: "python",
            });
            const content = res?.data?.content as string | undefined;
            if (!content) {
                setModels([]);
                return;
            }
            setModels(parseLocalModels(content));
        } catch (e) {
            console.error(e);
            showToast("Failed to load models", "error");
        } finally {
            setLoading(false);
        }
    }, [isOpen, pyInvoke, showToast]);
    useEffect(() => { loadModels(); }, [loadModels]);
    //  Add via file picker 
    const handleAdd = useCallback(async () => {
        setAdding(true);
        try {
            const paths = await selectModel();
            if (!paths || paths.length === 0) return;
            await addLocalModel(paths);
            showToast(`Added ${paths.length} model${paths.length > 1 ? "s" : ""}`);
            await loadModels();
        } catch (e) {
            console.error(e);
            showToast("Failed to add model", "error");
        } finally {
            setAdding(false);
        }
    }, [selectModel, addLocalModel, loadModels, showToast]);
    //  Delete one (receives the reconstructed full path from ModelRow) 
    const handleDelete = useCallback(async (fullPath: string) => {
        try {
            await deleteLocalModel(fullPath);
            setSelectedIds(prev => {
                const n = new Set(prev);
                const match = models.find(
                    m => [m.modelPath, m.fileName].filter(Boolean).join("") === fullPath
                );
                if (match) n.delete(match.id);
                return n;
            });
            showToast("Model removed");
            await loadModels();
        } catch (e) {
            console.error(e);
            showToast("Failed to remove model", "error");
        }
    }, [deleteLocalModel, loadModels, models, showToast]);
    //  Delete selected 
    const handleDeleteSelected = useCallback(async () => {
        if (selectedIds.size === 0) return;
        const selected = models.filter(m => selectedIds.has(m.id));
        const fullPaths = selected.map(m => [m.modelPath, m.fileName].filter(Boolean).join(""));
        try {
            await Promise.all(fullPaths.map(p => deleteLocalModel(p)));
            setSelectedIds(new Set());
            showToast(`Removed ${selected.length} model${selected.length > 1 ? "s" : ""}`);
            await loadModels();
        } catch (e) {
            console.error(e);
            showToast("Failed to remove models", "error");
        }
    }, [selectedIds, models, deleteLocalModel, loadModels, showToast]);
    //  Selection helpers 
    const toggleSelect = useCallback((id: string) => {
        setSelectedIds(prev => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
    }, []);
    const toggleSelectAll = useCallback(() => {
        setSelectedIds(prev =>
            prev.size === models.length && models.length > 0
                ? new Set()
                : new Set(models.map(m => m.id))
        );
    }, [models]);
    const allSelected = models.length > 0 && selectedIds.size === models.length;
    const isEmpty = models.length === 0;
    //  Rende
    return (
        <div className="flex flex-col gap-2 h-full pt-10">
            {/* Header row */}
            <div className="flex justify-center items-center w-[97.5%] mx-auto px-2">
                <div className="w-6">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                </div>
                <div className="flex-1" />
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={adding}
                    className={clsx(
                        "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border transition-colors",
                        adding
                            ? "bg-accent/20 border-accent/50 text-foreground opacity-60 cursor-not-allowed"
                            : "border-[hsl(var(--chat-border))] hover:bg-accent/10 text-muted-foreground hover:text-foreground"
                    )}
                >
                    {adding ? (
                        <><Spinner /><span>Selecting…</span></>
                    ) : (
                        <><FolderOpen className="w-3.5 h-3.5" /><span>Add</span></>
                    )}
                </button>
            </div>
            {/* Table */}
            <ScrollArea className="flex-1 -mx-6 w-[97.5%] mx-auto border-t border-b border-[hsl(var(--chat-border))]">
                <Table>
                    <TableBody>
                        {isEmpty ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground text-xs">
                                    <div className="flex flex-col items-center justify-center gap-2">
                                        {loading ? (
                                            <><Spinner /><span>Loading…</span></>
                                        ) : (
                                            <>
                                                <HardDrive className="w-6 h-6 opacity-20" />
                                                <span className="opacity-50">No local models configured</span>
                                            </>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            models.map(model => (
                                <ModelRow
                                    key={model.id}
                                    model={model}
                                    isSelected={selectedIds.has(model.id)}
                                    onToggle={toggleSelect}
                                    onDelete={handleDelete}
                                />
                            ))
                        )}
                    </TableBody>
                </Table>
                {loading && models.length > 0 && (
                    <div className="flex justify-center items-center gap-2 py-3 text-xs text-muted-foreground">
                        <Spinner />
                        <span>Refreshing…</span>
                    </div>
                )}
            </ScrollArea>
            {/* Bulk action bar */}
            <div className={clsx(
                selectedIds.size > 0 ? "flex justify-center items-center" : "hidden",
                "pt-2 relative transform translate-y-[-6px] px-4"
            )}>
                <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
                <div className="flex-1 flex justify-end gap-2">
                    <button
                        onClick={handleDeleteSelected}
                        className="p-2 border border-[hsl(var(--chat-border))] rounded-full w-20 text-sm hover:border-destructive/50 hover:text-destructive transition-colors"
                    >
                        Remove
                    </button>
                </div>
            </div>
            {/* Toast */}
            {toast && (
                <div className="px-4 pb-1">
                    <Toast message={toast.message} type={toast.type} />
                </div>
            )}
        </div>
    );
}