import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "./ui/tooltip"
import { TooltipProvider } from "@radix-ui/react-tooltip"
import clsx from 'clsx'
import { Bot, ChevronDown, Cpu, Drama, Unplug } from 'lucide-react'
import { usePython } from "./usePython";
import { useAvailableAgents, useAvailableModels, useGlobal, type IAgent } from "./../index";
import type { Model } from "../utils/utils";
import { Dropdown } from "./dropdown";
import type { DropdownMenuItemProps } from "./dropdown";
import { Button, Spinner } from "./ui";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SelectionMode } from "./composer";
import { LucideIcons } from "openchad-react/utils/state";


const SLICE_LENGTH = 30;

const SEARCH_DEBOUNCE_MS = 150;

function truncate(name: string | null | undefined): string {
    if (!name) return "No Model Selected";
    return name.length > SLICE_LENGTH ? `${name.slice(0, SLICE_LENGTH)}…` : name;
}

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

const AgentIcon = memo(({ iconVal }: { iconVal: string | undefined | null }) => {
    if (
        typeof iconVal === "string" &&
        (iconVal.startsWith("/") ||
            iconVal.startsWith("http") ||
            iconVal.startsWith("data:") ||
            /\.(png|jpg|jpeg|ico|svg|webp)$/i.test(iconVal))
    ) {
        return <img src={iconVal} className="w-4 h-4 object-contain rounded-sm shrink-0" alt="" />;
    }
    if (typeof iconVal === "string" && iconVal) {
        const Icon = (LucideIcons as any)[iconVal] || LucideIcons.Compass;
        return <Icon className="w-4 h-4 shrink-0" />;
    }
    return <Bot size={14} className="shrink-0 opacity-60" />;
});


export default function ModelSelection({
    layout,
    model,
    setModel,
    selectionMode = 'model',
    agent,
    setAgent,
}: {
    layout: string;
    model: Model;
    setModel: (model: Model) => void;
    selectionMode?: SelectionMode;
    agent?: IAgent | null;
    setAgent?: (agent: IAgent) => void;
}) {
    const { pyInvoke } = usePython();
    const { models: availableModels, isLoading: isScanning } = useAvailableModels();
    const { agents, isLoading: isAgentsLoading } = useAvailableAgents()

    useEffect(() => {
        console.log("[ModelSelection] Model validation check:", {
            isScanning,
            modelId: model?.id,
            modelName: model?.name,
            availableCount: availableModels.length,
            availableModels: availableModels.map(m => m.id)
        });
        if (isScanning) return;
        if (!model?.id) return;
        if (availableModels.length === 0) {
            console.log("[ModelSelection] Available models list is empty, skipping validation.");
            return;
        }
        const foundIndex = availableModels.findIndex(m => m.id === model.id);
        console.log("[ModelSelection] Model validation index check:", { foundIndex });
        if (foundIndex === -1) {
            console.warn("[ModelSelection] Model NOT found in available models! Resetting model to null.");
            setModel({ name: null, id: null });
        }
    }, [availableModels, isScanning, model, setModel]);

    useEffect(() => {
        console.log("[ModelSelection] Agent validation check:", {
            isAgentsLoading,
            agentId: agent?.id,
            agentName: agent?.name,
            agentsCount: agents.length,
            agents: agents.map(a => a.id)
        });
        if (isAgentsLoading) return;
        if (!agent?.id) return;
        if (agents.length === 0) {
            console.log("[ModelSelection] Agents list is empty, skipping validation.");
            return;
        }
        const foundIndex = agents.findIndex(a => a.id === agent.id);
        console.log("[ModelSelection] Agent validation index check:", { foundIndex });
        if (foundIndex === -1) {
            console.warn("[ModelSelection] Agent NOT found in available agents! Resetting agent to null.");
            setAgent?.({ name: null, id: null });
        }
    }, [agents, isAgentsLoading, agent, setAgent]);

    // Model dropdown state
    const [modelOpen, setModelOpen] = useState(false);
    const [modelSearch, setModelSearch] = useState("");
    const debouncedModelSearch = useDebounce(modelSearch, SEARCH_DEBOUNCE_MS);

    // Agent dropdown state
    const [agentOpen, setAgentOpen] = useState(false);
    const [, setOpen] = useGlobal('showAgentsDialog', { initialValue: false });
    const [agentSearch, setAgentSearch] = useState("");
    const debouncedAgentSearch = useDebounce(agentSearch, SEARCH_DEBOUNCE_MS);

    const unloadModel = useCallback(async (id: string) => {
        await pyInvoke("v1/models/unload", { model_id: id });
    }, [pyInvoke]);

    // Filtered model list
    const filteredModels = useMemo(() => {
        const q = debouncedModelSearch.trim().toLowerCase();
        if (!q) return availableModels;
        return availableModels.filter((m) => (m.name ?? "").toLowerCase().includes(q));
    }, [availableModels, debouncedModelSearch]);

    // Filtered agent list
    const filteredAgents = useMemo(() => {
        const q = debouncedAgentSearch.trim().toLowerCase();
        if (!q) return agents;
        return agents.filter((a) => (a.name ?? "").toLowerCase().includes(q));
    }, [agents, debouncedAgentSearch]);

    // Model dropdown content
    const modelDropdownContent: DropdownMenuItemProps[] = useMemo(() => {
        const isFiltering = modelSearch !== debouncedModelSearch;
        if (isFiltering || (filteredModels.length === 0 && debouncedModelSearch.trim().length === 0)) {
            return [{
                content: (
                    (isScanning || isFiltering)
                        ? <div className="flex items-center justify-center gap-3"><Spinner /><span>Searching…</span></div>
                        : <div className="flex items-center justify-center gap-3"><span>No models found.</span></div>
                ),
            }];
        }
        if (filteredModels.length === 0) {
            return [{ content: <div className="flex items-center justify-center gap-3"><span>No models found.</span></div> }];
        }
        return filteredModels.map((m) => ({
            content: <ModelItem key={m.id} model={m} onUnload={unloadModel} />,
            text: m.name ?? undefined,
            shortcut: null,
            children: null,
            separator: false,
            trigger: () => setModel(m),
        }));
    }, [filteredModels, modelSearch, debouncedModelSearch, isScanning, unloadModel, setModel]);

    // Agent dropdown content
    const agentDropdownContent: DropdownMenuItemProps[] = useMemo(() => {
        const isFiltering = agentSearch !== debouncedAgentSearch;
        if (isFiltering || isAgentsLoading) {
            return [{ content: <div className="flex items-center justify-center gap-3"><Spinner /><span>Loading…</span></div> }];
        }
        if (filteredAgents.length === 0) {
            return [{
                content: <div className="w-full flex flex-col items-center justify-center gap-3"><span>No agents found.</span>
                    {agents.length == 0 && <Button size={'sm'} onClick={(e) => { setOpen(true); }}>Open Agents Menu</Button>}</div>
            }];
        }
        return filteredAgents.map((a) => ({
            content: (
                <div className="flex items-center w-full gap-2">
                    <AgentIcon iconVal={a.icon} />
                    <span>{a.name ?? 'Unknown'}</span>
                </div>
            ),
            text: a.name ?? 'Unknown',
            shortcut: null,
            children: null,
            separator: false,
            trigger: () => setAgent?.(a),
        }));
    }, [filteredAgents, agentSearch, debouncedAgentSearch, isAgentsLoading, setAgent]);

    return (
        <TooltipProvider>
            <div className={clsx(
                "absolute top-2 z-10 flex items-center gap-1",
                layout === "leftToRight" ? "left-5" : "right-5"
            )}>
                {/* Model dropdown */}
                {selectionMode === 'model' && (
                    <Dropdown
                        open={modelOpen}
                        onOpenChange={setModelOpen}
                        search={modelSearch}
                        setSearch={setModelSearch}
                        className="max-w-none min-w-70 max-h-[345px] flex flex-col"
                        content={modelDropdownContent}
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
                )}

                {/* Agent dropdown */}
                {selectionMode === 'agent' && (
                    <Dropdown
                        open={agentOpen}
                        onOpenChange={setAgentOpen}
                        search={agentSearch}
                        setSearch={setAgentSearch}
                        className="max-w-none min-w-56 max-h-[345px] flex flex-col"
                        content={agentDropdownContent}
                    >
                        <div className="p-2 rounded-lg cursor-pointer flex items-center gap-1.5">
                            {agent?.icon
                                ? <AgentIcon iconVal={agent.icon} />
                                : <Drama className="h-4 w-4 text-zinc-600 dark:text-zinc-300 shrink-0" />}
                            <div style={{ fontSize: "1.125rem" }}>
                                {agent?.name || "No Agent Selected"}
                            </div>
                            <div className="pl-1">
                                <ChevronDown className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                            </div>
                        </div>
                    </Dropdown>
                )}
            </div>
        </TooltipProvider>
    );
}
