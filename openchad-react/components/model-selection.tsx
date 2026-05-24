import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "./ui/tooltip"
import { TooltipProvider } from "@radix-ui/react-tooltip"
import clsx from 'clsx'
import { ChevronDown, Unplug } from 'lucide-react'
import { usePython } from "./usePython";
import type { Model } from "../utils/utils";
import { Dropdown } from "./dropdown";
import type { DropdownMenuItemProps } from "./dropdown";
import { Spinner } from "./ui";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";


const SLICE_LENGTH = 30;

const SEARCH_DEBOUNCE_MS = 150;

function truncate(name: string | null | undefined): string {
    if (!name) return "No Model Selected";
    return name.length > SLICE_LENGTH ? `${name.slice(0, SLICE_LENGTH)}…` : name;
}

function isLLMorVLM(m: Model): boolean {
    return (
        (m.modelType?.includes("llm") || m.modelType?.includes("vlm")) === true &&
        m.backend != null
    );
}

// Returns a value that only updates after `delay` ms of no changes.
// The input updates instantly; only the expensive consumers see the debounced value.

function useDebounce<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState<T>(value);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setDebounced(value), delay);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [value, delay]);
    return debounced;
}

interface ModelItemProps {
    model: Model;
    onUnload: (id: string) => void;
}

const ModelItem = memo(function ModelItem({ model, onUnload }: ModelItemProps) {
    const backendLabel = model.backend?.split(":").pop();
    const handleUnload = useCallback(() => {
        if (model.id) onUnload(model.id);
    }, [model.id, onUnload]);
    return (
        <div className="selectmodel flex items-center w-full gap-2">
            <Tooltip disableHoverableContent>
                <TooltipTrigger>
                    <span className="flex items-center">{truncate(model.name)}</span>
                </TooltipTrigger>
                <TooltipContent sideOffset={10}>
                    <p>{model.name}</p>
                </TooltipContent>
            </Tooltip>
            <div className="flex-1" />
            {backendLabel && (
                <Tooltip disableHoverableContent>
                    <TooltipTrigger>
                        <p className="px-1 text-[8pt] rounded-xl bg-accent/10">{backendLabel}</p>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>{backendLabel} will perform the inference.</p>
                    </TooltipContent>
                </Tooltip>
            )}
            {model.isLoaded && (
                <Tooltip disableHoverableContent>
                    <TooltipTrigger>
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Model is loaded.</p>
                    </TooltipContent>
                </Tooltip>
            )}
            {model.isLoaded && model.isLocal && (
                <Tooltip disableHoverableContent>
                    <TooltipTrigger>
                        <div
                            onClick={handleUnload}
                            className="flex items-center opacity-50 hover:opacity-100 cursor-pointer"
                        >
                            <Unplug size={14} />
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Unload model.</p>
                    </TooltipContent>
                </Tooltip>
            )}
        </div>
    );
});


function parseModelsFromConfig(raw: string): Model[] {
    const parsed = JSON.parse(raw);
    if (!parsed.available_models) return [];
    return (Object.entries(parsed.available_models) as [string, Record<string, unknown>][])
        .map(([id, m]) => ({
            id,
            name: (m.name as string) ?? "Unknown",
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
        .filter(isLLMorVLM);
}


export default function ModelSelection({
    layout,
    model,
    setModel,
}: {
    layout: string;
    model: Model;
    setModel: (model: Model) => void;
}) {
    const { pyInvoke } = usePython();
    const [open, setOpen] = useState(false);
    const [availableModels, setAvailableModels] = useState<Model[]>([]);
    // searchQuery drives the input instantly (no lag while typing).
    // debouncedQuery drives the filter  only updates 150 ms after typing stops.
    const [searchQuery, setSearchQuery] = useState("");
    const debouncedQuery = useDebounce(searchQuery, SEARCH_DEBOUNCE_MS);
    const [isScanning, setIsScanning] = useState(false);
    //  Fetch models only when opening 
    useEffect(() => {
        if (!open) return;
        setIsScanning(true);
        setSearchQuery("");
        let cancelled = false;
        (async () => {
            try {
                const res : any= await pyInvoke<{ data?: Record<string, unknown> }>('file', {
                    command: "read",
                    filename: "config.json",
                    base_dir: "python",
                });
                if (cancelled) return;
                const config = res?.data?.content as string | undefined;
                if (!config) return;
                setAvailableModels(parseModelsFromConfig(config));
                setIsScanning(false);
            } catch (e) {
                if (!cancelled) console.error("Failed to load models:", e);
            }
        })();
        return () => { cancelled = true; };
    }, [open, pyInvoke]);
    //  Unload handler  single stable reference shared by all ModelItems 
    const unloadModel = useCallback(async (id: string) => {
        await pyInvoke("v1/models/unload", { model_id: id });
    }, [pyInvoke]);
    //  Filtered list  reacts to debounced query, not raw keystrokes 
    const filtered = useMemo(() => {
        const q = debouncedQuery.trim().toLowerCase();
        if (!q) return availableModels;
        return availableModels.filter((m) =>
            (m.name ?? "").toLowerCase().includes(q)
        );
    }, [availableModels, debouncedQuery]);
    //  Dropdown content 
    const dropdownContent: DropdownMenuItemProps[] = useMemo(() => {
        // While the debounced value hasn't caught up yet, show a loading state.
        const isFiltering = searchQuery !== debouncedQuery;
        if (isFiltering || (filtered.length === 0 && debouncedQuery.trim().length === 0)) {
            return [{
                content: (
                    (isScanning || isFiltering) ? <div className="flex items-center justify-center gap-3">
                        <Spinner /><span>Searching…</span>
                    </div> : <div className="flex items-center justify-center gap-3">
                        <span>No models found.</span>
                    </div>
                ),
            }];
        }
        if (filtered.length === 0) {
            return [{
                content: (
                    <div className="flex items-center justify-center gap-3">
                        <span>No models found.</span>
                    </div>
                ),
            }];
        }
        return filtered.map((m) => ({
            content: (
                <ModelItem
                    key={m.id}
                    model={m}
                    onUnload={unloadModel}
                />
            ),
            text: m.name ?? undefined,
            shortcut: null,
            children: null,
            separator: false,
            trigger: () => setModel(m),
        }));
    }, [filtered, searchQuery, debouncedQuery, unloadModel, setModel]);
    //  Render 
    return (
        <TooltipProvider>
            <div className={clsx(
                "absolute top-2 z-10 flex items-center",
                layout === "leftToRight" ? "left-5" : "right-5"
            )}>
                <Dropdown
                    open={open}
                    onOpenChange={setOpen}
                    search={searchQuery}
                    setSearch={setSearchQuery}
                    className="max-w-none min-w-70 max-h-[345px] flex flex-col"
                    content={dropdownContent}
                >
                    <div className="p-2 rounded-lg cursor-pointer flex items-center">
                        <div style={{ fontSize: "1.125rem" }}>
                            {model?.name || "No Model Selected"}
                        </div>
                        <div className="pl-1">
                            <ChevronDown className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                        </div>
                    </div>
                </Dropdown>
            </div>
        </TooltipProvider>
    );
}
