import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";
import { Plus, Trash2, Edit2, Check, X, ChevronDown, Clock, Repeat, Calendar } from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";
import { usePython } from "./usePython";
import { formatTaskTime, LucideIcons, addTab, TabInfo } from "../utils/state";
import { Spinner } from "./ui/spinner";
import clsx from "clsx";
import { useGlobal } from "./useGlobal";
import { useDatabaseImpl } from "./useDatabase";
import { generateIdFromString, useSnapshot } from "../index";
import { Button } from "./ui";
import type { Model } from "../utils/utils";
import { parseModelsFromConfig, INTERVAL_OPTIONS, ScheduleInterval } from "./composer";
import { Dropdown } from "./dropdown";


const truncate = (text: string, length = 50) => {
    if (!text) return "";
    if (text.length <= length) return text;
    return text.slice(0, length) + "...";
};

const TabIcon = memo(({ iconVal }: { iconVal: string | undefined }) => {
    if (
        typeof iconVal === "string" &&
        (iconVal.startsWith("/") ||
            iconVal.startsWith("http") ||
            iconVal.startsWith("data:") ||
            /\.(png|jpg|jpeg|ico|svg|webp)$/i.test(iconVal))
    ) {
        return <img src={iconVal} className="w-5 h-5 object-contain rounded-sm" alt="" />;
    }
    const Icon = (LucideIcons as any)[iconVal as string] || LucideIcons.Compass;
    return <Icon className="w-4 h-4" />;
});

const IntervalBadge = memo(({ value }: { value: string | undefined }) => {
    const val = value || "once";
    let label = "Run Once";
    let Icon = Clock;
    let colorClasses = "border-blue-500/20 bg-blue-500/10 text-blue-500 dark:text-blue-400";
    
    if (val === "infinite") {
        label = "Infinite";
        Icon = Repeat;
        colorClasses = "border-emerald-500/20 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400";
    } else if (val === "1h") {
        label = "Hourly";
        Icon = Clock;
        colorClasses = "border-amber-500/20 bg-amber-500/10 text-amber-500 dark:text-amber-400";
    } else if (val === "1d") {
        label = "Daily";
        Icon = Calendar;
        colorClasses = "border-purple-500/20 bg-purple-500/10 text-purple-500 dark:text-purple-400";
    } else if (val === "1w") {
        label = "Weekly";
        Icon = Calendar;
        colorClasses = "border-indigo-500/20 bg-indigo-500/10 text-indigo-500 dark:text-indigo-400";
    } else if (val === "1m") {
        label = "Monthly";
        Icon = Calendar;
        colorClasses = "border-rose-500/20 bg-rose-500/10 text-rose-500 dark:text-rose-400";
    }

    return (
        <span className={clsx(
            "border px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 text-[11px] font-semibold transition-all hover:brightness-110 shadow-sm",
            colorClasses
        )}>
            <Icon className="w-3 h-3 shrink-0" />
            <span>{label}</span>
            <ChevronDown className="w-3 h-3 shrink-0"/>
        </span>
    );
});


const TabRow = memo((
    { tab, isSelected, onToggle, onOpen, onDelete, availableModels, onUpdateTab }: {
        tab: any;
        isSelected: boolean;
        onToggle: (id: string) => void;
        onOpen: (id: string) => void;
        onDelete: (id: string) => void;
        availableModels: Model[];
        onUpdateTab: (id: string, updatedFields: Partial<any>) => void;
    }
) => {
    const handleToggle = useCallback(() => onToggle(tab.id), [tab.id, onToggle]);
    const handleOpen = useCallback(() => onOpen(tab.id), [tab.id, onOpen]);
    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete(tab.id);
    }, [tab.id, onDelete]);

    const tbName = generateIdFromString(tab.id + "/" + "message_state");
    const [messageState] = useDatabaseImpl<any>(tbName, {
        initialValue: {
            title: null,
            activeId: "",
            errorMsg: "",
            initialized: false,
            isStreaming: false,
            context: "",
        },
    });
    const [isEditingQuery, setIsEditingQuery] = useState(false);
    const [editQuery, setEditQuery] = useState(tab.query || "");
    const editContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        setEditQuery(tab.query || "");
    }, [tab.query]);

    useEffect(() => {
        if (!isEditingQuery) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (editContainerRef.current && !editContainerRef.current.contains(event.target as Node)) {
                setIsEditingQuery(false);
                setEditQuery(tab.query || "");
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isEditingQuery, tab.query]);

    const adjustHeight = useCallback(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = "auto";
            textarea.style.height = `${Math.max(64, textarea.scrollHeight)}px`;
        }
    }, []);

    useEffect(() => {
        if (isEditingQuery) {
            adjustHeight();
        }
    }, [editQuery, isEditingQuery, adjustHeight]);

    const handleSaveQuery = useCallback(() => {
        if (editQuery !== tab.query) {
            onUpdateTab(tab.id, { query: editQuery });
        }
        setIsEditingQuery(false);
    }, [editQuery, tab.query, tab.id, onUpdateTab]);

    const handleSaveAgent = useCallback((newAgent: string) => {
        if (newAgent !== tab.agent) {
            onUpdateTab(tab.id, { agent: newAgent });
        }
    }, [tab.agent, tab.id, onUpdateTab]);

    const handleSaveInterval = useCallback((newInterval: ScheduleInterval) => {
        if (newInterval !== tab.interval) {
            onUpdateTab(tab.id, { interval: newInterval });
        }
    }, [tab.interval, tab.id, onUpdateTab]);

    const modelDropdownContent = useMemo(() => {
        return availableModels.map(m => ({
            content: <span className="text-xs">{m.name}</span>,
            text: m.name ?? undefined,
            shortcut: null,
            children: null,
            separator: false,
            trigger: () => handleSaveAgent(m.id ?? ""),
        }));
    }, [availableModels, handleSaveAgent]);

    return (
        <TableRow className="border-accent/5 hover:bg-accent/5 transition-colors cursor-pointer h-12 group">
            <TableCell className="w-10 cursor-default" onClick={e => e.stopPropagation()}>
                <Checkbox checked={isSelected} onCheckedChange={handleToggle} />
            </TableCell>
            <TableCell onClick={handleOpen} className="w-8 text-xs text-muted-foreground">
                <TabIcon iconVal={tab.icon} />
            </TableCell>
            <TableCell onClick={handleOpen} className="w-8 text-xs text-muted-foreground">
                {messageState.isStreaming ? <Spinner /> : <div></div>}
            </TableCell>
            {/* Query Cell */}
            {isEditingQuery ? (
                <TableCell colSpan={4} onClick={e => e.stopPropagation()} className="py-2.5 align-top">
                    <div ref={editContainerRef} className="flex flex-col gap-2 w-full">
                        <textarea
                            ref={textareaRef}
                            value={editQuery}
                            onChange={e => setEditQuery(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSaveQuery();
                                } else if (e.key === 'Escape') {
                                    setIsEditingQuery(false);
                                    setEditQuery(tab.query || "");
                                }
                            }}
                            autoFocus
                            onFocus={e => {
                                e.target.select();
                                adjustHeight();
                            }}
                            className="w-full bg-accent/5 border border-accent/20 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none overflow-hidden transition-all font-sans min-h-[64px] max-h-[300px]"
                            placeholder="Enter task query prompt..."
                        />
                        <div className="flex justify-between items-center gap-3 mt-1">
                            {/* Inner Model & Interval Selectors */}
                            <div className="flex items-center gap-2">
                                {/* Agent Selector */}
                                <Dropdown
                                    content={modelDropdownContent}
                                    align="start"
                                    className="max-w-none min-w-44"
                                >
                                    <button className="flex items-center gap-1 hover:bg-accent/5 px-2 py-1 rounded text-[11px] truncate font-medium border border-accent/10 hover:border-accent/25 transition-all text-left bg-background/50 bg-accent/5">
                                        <span className="truncate max-w-[120px]">{availableModels.find(m => m.id === tab.agent)?.name || tab.agent || "Select Agent"}</span>
                                        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                                    </button>
                                </Dropdown>

                                {/* Interval Selector */}
                                <Dropdown
                                    content={INTERVAL_OPTIONS.map(opt => ({
                                        content: (
                                            <div className="flex items-center gap-1.5 text-xs py-0.5">
                                                <span>{opt.label}</span>
                                            </div>
                                        ),
                                        trigger: () => handleSaveInterval(opt.value)
                                    }))}
                                    align="start"
                                    className="max-w-none min-w-44"
                                >
                                    <button className="cursor-pointer">
                                        <IntervalBadge value={tab.interval} />
                                    </button>
                                </Dropdown>
                            </div>

                            {/* Help Text / Actions */}
                            <div className="flex items-center gap-2 text-[11px]">
                                <span className="text-[10px] opacity-60 hidden sm:inline">Press Enter to save, Shift+Enter for newline</span>
                                <button 
                                    onClick={() => { setIsEditingQuery(false); setEditQuery(tab.query || ""); }} 
                                    className="px-2 py-1 rounded hover:bg-accent/10 hover:text-foreground transition-all cursor-pointer font-medium"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={handleSaveQuery} 
                                    className="px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-semibold shadow-sm cursor-pointer"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                </TableCell>
            ) : (
                <>
                    {/* Normal Query Cell */}
                    <TableCell className="w-full font-medium group/query cursor-pointer h-12 min-w-[200px]" onClick={handleOpen}>
                        <div className="flex items-center gap-1.5 justify-between w-full">
                            <span className="truncate max-w-[400px]" title={tab.query}>{tab.query || "-"}</span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsEditingQuery(true);
                                }}
                                className="opacity-0 group-hover/query:opacity-100 hover:text-primary transition-opacity p-1 shrink-0"
                            >
                                <Edit2 className="w-3 h-3 text-muted-foreground" />
                            </button>
                        </div>
                    </TableCell>

                    {/* Agent Cell */}
                    <TableCell align="right" onClick={e => e.stopPropagation()} className="h-12">
                        <Dropdown
                            content={modelDropdownContent}
                            align="start"
                            className="max-w-none min-w-44"
                        >
                            <button className="flex items-center gap-1 hover:bg-accent/5 px-2 py-1 rounded text-xs truncate max-w-full font-medium border border-accent/10 hover:border-accent/25 transition-all text-left">
                                <span className="truncate flex-1">{availableModels.find(m => m.id === tab.agent)?.name || tab.agent || "Select Agent"}</span>
                                <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                            </button>
                        </Dropdown>
                    </TableCell>

                    {/* Interval Cell */}
                    <TableCell onClick={e => e.stopPropagation()} className="w-full h-12">
                        <Dropdown
                            content={INTERVAL_OPTIONS.map(opt => ({
                                content: (
                                    <div className="flex items-center gap-1.5 text-xs py-0.5">
                                        <span>{opt.label}</span>
                                    </div>
                                ),
                                trigger: () => handleSaveInterval(opt.value)
                            }))}
                            align="start"
                            className="max-w-none min-w-44"
                        >
                            <button className="cursor-pointer">
                                <IntervalBadge value={tab.interval} />
                            </button>
                        </Dropdown>
                    </TableCell>

                    {/* Timestamp & Actions Cell */}
                    <TableCell onClick={handleOpen} className="w-[70px] h-12 text-[11px] text-muted-foreground whitespace-nowrap pr-4">
                        <div className="flex justify-end items-center gap-2 h-full">
                            <span className="opacity-60">{formatTaskTime(tab.timestamp)}</span>
                            <Trash2
                                className="w-4 h-4 hover:text-destructive cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={handleDelete}
                            />
                        </div>
                    </TableCell>
                </>
            )}
        </TableRow>
    );
});

export default function Tasks({
    workspace, isOpen, setOpen, query, openInTab
}: {
    workspace?: string | null;
    isOpen: boolean;
    setOpen: (open: boolean) => void;
    query: string;
    openInTab?: boolean;
}) {
    const { SetActive } = useSnapshot(TabInfo);
    const [, setChatId] = useGlobal<string | null>('chatId', { initialValue: null })
    const { pyInvoke } = usePython();
    const [availableModels, setAvailableModels] = useState<Model[]>([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res: any = await pyInvoke('file', {
                    command: 'read',
                    filename: 'config.json',
                    base_dir: 'python',
                });
                if (cancelled) return;
                const config = res?.data?.content as string | undefined;
                if (config) {
                    setAvailableModels(parseModelsFromConfig(config));
                }
            } catch (e) {
                if (!cancelled) console.error('Failed to load models in Tasks:', e);
            }
        })();
        return () => { cancelled = true; };
    }, [pyInvoke]);

    const handleUpdateTab = useCallback(async (id: string, updatedFields: Partial<any>) => {
        try {
            const db = workspace ?? "global";
            const tab = tabsRef.current.find(t => t.id === id);
            if (!tab) return;
            const newMetadata = {
                icon: tab.icon || 'AlarmClockCheck',
                query: tab.query,
                interval: tab.interval,
                agent: tab.agent,
                timestamp: tab.timestamp || Date.now(),
                ...updatedFields
            };
            await pyInvoke("sqlite", {
                db,
                command: "execute",
                sql: "UPDATE tasks SET metadata = ? WHERE id = ?",
                params: [JSON.stringify(newMetadata), id]
            });
            setTabs(prev => prev.map(t => t.id === id ? { ...t, ...newMetadata } : t));
        } catch (e) {
            console.error("Failed to update task", id, e);
        }
    }, [workspace, pyInvoke]);

    const [tabs, setTabs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    // Refs  live values readable from async callbacks without stale closures
    const pageRef = useRef(0);
    const hasMoreRef = useRef(true);
    const loadingRef = useRef(false);
    const tabsRef = useRef<any[]>([]);
    const queryRef = useRef(query);
    const sentinelRef = useRef<HTMLDivElement>(null);
    // Prevents the IntersectionObserver from firing before the first page is loaded
    const initializedRef = useRef(false);
    // Keep refs in sync with latest render values
    tabsRef.current = tabs;
    queryRef.current = query;
    const setLoadingBoth = (val: boolean) => {
        loadingRef.current = val;
        setLoading(val);
    };
    //  Core fetch (no stale-closure risk; reads from refs) 
    const loadTabs = useCallback(async (pageNum: number, reset: boolean) => {
        if (loadingRef.current) return;
        setLoadingBoth(true);
        // Lock the observer out during a reset so it can't race the initial fetch
        if (reset) initializedRef.current = false;
        try {
            const db = workspace ?? "global";
            const limit = 50;
            const offset = pageNum * limit;
            const q = queryRef.current;
            const searchClause = q ? "WHERE metadata LIKE ?" : "";
            const res = await pyInvoke("sqlite", {
                db,
                command: "query",
                sql: `SELECT id, metadata FROM tasks ${searchClause} ORDER BY rowid DESC LIMIT ${limit} OFFSET ${offset}`,
                params: q ? [`%${q}%`] : []
            });
            console.warn(res);
            const rows: any[] = res?.data ?? (Array.isArray(res) ? res : []);
            if (!Array.isArray(rows)) return;
            hasMoreRef.current = rows.length === limit;
            const parsed = rows.map((row: any) => {
                try { return { id: row.id, ...JSON.parse(row.metadata) }; }
                catch { return { id: row.id, title: "Unknown" }; }
            });
            setTabs(prev => reset ? parsed : [...prev, ...parsed]);
            // Unlock the observer only after the first page has settled
            if (reset) initializedRef.current = true;
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingBoth(false);
        }
    }, [workspace, pyInvoke]);
    //  Debounced reset on query / open change 
    useEffect(() => {
        if (!isOpen) return;
        const timer = setTimeout(() => {
            pageRef.current = 0;
            hasMoreRef.current = true;
            loadTabs(0, true);
        }, 300);
        return () => clearTimeout(timer);
    }, [isOpen, query, loadTabs]);
    //  IntersectionObserver sentinel  fires the instant the bottom div enters view
    // Far more reliable than scroll events: works inside any overflow container,
    // no stale closures, no throttle hacks needed.
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !loadingRef.current && hasMoreRef.current && initializedRef.current) {
                    pageRef.current += 1;
                    loadTabs(pageRef.current, false);
                }
            },
            { threshold: 0 }
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [loadTabs]);
    //  Selection helpers 
    const toggleSelect = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }, []);
    const toggleSelectAll = useCallback(() => {
        setSelectedIds(prev =>
            prev.size === tabsRef.current.length && tabsRef.current.length > 0
                ? new Set()
                : new Set(tabsRef.current.map((t: any) => t.id))
        );
    }, []);
    //  Delete 
    const handleDelete = useCallback(async (id?: string) => {
        const ids = id ? [id] : Array.from(selectedIds);
        if (ids.length === 0) return;
        try {
            const db = workspace ?? "global";
            const placeholders = ids.map(() => "?").join(",");
            for (const i of ids) {
                try {
                    const initTb = generateIdFromString(i + "/" + "message_state");
                    const res = await pyInvoke("sqlite", {
                        db: db,
                        table: initTb,
                        command: "query",
                        sql: `SELECT id, _v FROM ${initTb} WHERE id IN ('isStreaming', 'activeId')`
                    });
                    const rows = res?.data ?? (Array.isArray(res) ? res : []);
                    if (Array.isArray(rows)) {
                        let isStreaming = false;
                        let activeId = "";
                        rows.forEach((row: any) => {
                            let val = row._v;
                            if (typeof val === 'string') {
                                try {
                                    val = JSON.parse(val);
                                } catch { }
                            }
                            if (row.id === 'isStreaming') {
                                isStreaming = !!val;
                            } else if (row.id === 'activeId') {
                                activeId = String(val || "");
                            }
                        });
                        if (isStreaming && activeId) {
                            await pyInvoke("v1/chat/stop", { id: activeId });
                        }
                    }
                } catch (e) {
                    console.error("Failed to check/stop task", i, e);
                }
            }

            await pyInvoke("sqlite", {
                db,
                command: "execute",
                sql: `DELETE FROM tasks WHERE id IN (${placeholders})`,
                params: ids
            });
            setSelectedIds(prev => {
                const next = new Set(prev);
                ids.forEach(i => next.delete(i));
                return next;
            });
            pageRef.current = 0;
            hasMoreRef.current = true;
            loadTabs(0, true);
            setChatId(null)
        } catch (e) {
            console.error(e);
        }
    }, [selectedIds, workspace, pyInvoke, loadTabs, setChatId]);
    //  Open selected / open single 
    const openTab = (id: string) => {
        const tab = tabsRef.current.find((t: any) => t.id === id);
        if (tab) {
            if (openInTab) {
                addTab({
                    uuid: id,
                    title: tab.name,
                    iconOverride: tab.icon || "AlarmClockCheck",
                    layout: "single",
                    childrenProps: {
                        [id]: {
                            icon: tab.icon || "AlarmClockCheck",
                            title: tab.name,
                            appname: "default",
                            data: {}
                        }
                    }
                });
                SetActive(id);
            } else {
                setChatId(tab.id)
            }
        }
    };
    const handleOpenId = useCallback((id: string) => {
        openTab(id);
        setOpen(false);
    }, [setOpen]);
    const handleDeleteRow = useCallback((id: string) => handleDelete(id), [handleDelete]);
    const handleDeleteSelected = useCallback(() => handleDelete(), [handleDelete]);
    //  Render 
    const allSelected = tabs.length > 0 && selectedIds.size === tabs.length;
    const isEmpty = tabs.length === 0;
    const [, setIsEditing] = useGlobal('overlay-editing', { initialValue: false });
    const [, setIsCreateTask] = useGlobal('overlay-create-task', { initialValue: false });
    const [, setShowTaskDialog] = useGlobal('showTaskDialog', { initialValue: false })
    const [, setShowMcpDialog] = useGlobal('showMcpDialog', { initialValue: false })
    const [, setShowCredentialsDialog] = useGlobal('showCredentialsDialog', { initialValue: false })
    const [, setShowLocalModelDialog] = useGlobal('showLocalModelDialog', { initialValue: false })
    const [, setShowCustomEndpointDialog] = useGlobal('showCustomEndpointDialog', { initialValue: false })

    return (
        <>
            <div className="flex justify-center items-center w-[97.5%] mx-auto px-2">
                <div className="w-6">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                </div>
                <div className="flex-1" />
                <Button variant="secondary" className="flex items-center justify-center" size="sm" onClick={() => {
                    setIsCreateTask(true);
                    setIsEditing(false);
                    setShowTaskDialog(false);
                    setShowMcpDialog(false);
                    setShowCredentialsDialog(false);
                    setShowCustomEndpointDialog(false);
                    setShowLocalModelDialog(false);
                }}>
                    New Task <Plus className="w-6 h-6" />
                </Button>
            </div>
            <ScrollArea
                className="flex-1 -mx-6 w-[97.5%] mx-auto border-t border-b border-[hsl(var(--chat-border))]"
            >
                <Table>
                    <TableBody>
                        {isEmpty ? (
                            <TableRow>
                                <TableCell colSpan={4} className="h-12 text-center text-muted-foreground text-xs">
                                    <div className="flex items-center justify-center gap-2">
                                        {loading
                                            ? <><Spinner /><span>Searching...</span></>
                                            : <>No results</>}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            tabs.map(tab => (
                                <TabRow
                                    key={tab.id}
                                    tab={tab}
                                    isSelected={selectedIds.has(tab.id)}
                                    onToggle={toggleSelect}
                                    onOpen={handleOpenId}
                                    onDelete={handleDeleteRow}
                                    availableModels={availableModels}
                                    onUpdateTab={handleUpdateTab}
                                />
                            ))
                        )}
                    </TableBody>
                </Table>
                {/* Sentinel: IntersectionObserver watches this  triggers next-page load */}
                <div ref={sentinelRef} className="h-px" />
                {/* Bottom loading indicator for subsequent pages */}
                {loading && tabs.length > 0 && (
                    <div className="flex justify-center items-center gap-2 py-3 text-xs text-muted-foreground">
                        <Spinner />
                        <span>Loading more...</span>
                    </div>
                )}
            </ScrollArea>
            <div className={clsx(
                selectedIds.size > 0 ? "flex justify-center items-center " : "hidden",
                "relative transform translate-y-[-6px] px-4"
            )}>
                <span>{selectedIds.size} Selected</span>
                <div className="flex-1 flex justify-end gap-2">
                    <button onClick={handleDeleteSelected} className="p-2 border border-[hsl(var(--chat-border))] rounded-full w-20">Delete</button>
                </div>
            </div>
        </>
    );
}