import { useState, useEffect, useCallback, useRef, memo } from "react";
import { Trash2 } from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";
import { usePython } from "./usePython";
import { formatTaskTime, LucideIcons, addTab } from "../utils/state";
import { Spinner } from "./ui/spinner";
import clsx from "clsx";


const TabIcon = memo(({ iconVal }: { iconVal: string | undefined }) => {
    if (
        typeof iconVal === "string" &&
        (iconVal.startsWith("/") ||
            iconVal.startsWith("http") ||
            /\.(png|jpg|jpeg|ico|svg|webp)$/i.test(iconVal))
    ) {
        return <img src={iconVal} className="w-8 h-8 object-contain rounded-sm" alt="" />;
    }
    const Icon = (LucideIcons as any)[iconVal as string] || LucideIcons.Compass;
    return <Icon className="w-4 h-4" />;
});

const TabRow = memo((
    { tab, isSelected, onToggle, onOpen, onDelete }: {
        tab: any;
        isSelected: boolean;
        onToggle: (id: string) => void;
        onOpen: (id: string) => void;
        onDelete: (id: string) => void;
    }
) => {
    const handleToggle = useCallback(() => onToggle(tab.id), [tab.id, onToggle]);
    const handleOpen   = useCallback(() => onOpen(tab.id),   [tab.id, onOpen]);
    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete(tab.id);
    }, [tab.id, onDelete]);
    return (
        <TableRow className="border-accent/5 hover:bg-accent/5 transition-colors cursor-pointer h-12 group">
            <TableCell className="w-10 cursor-default" onClick={e => e.stopPropagation()}>
                <Checkbox checked={isSelected} onCheckedChange={handleToggle} />
            </TableCell>
            <TableCell onClick={handleOpen} className="w-8 text-xs text-muted-foreground">
                <TabIcon iconVal={tab.iconOverride} />
            </TableCell>
            <TableCell onClick={handleOpen} className="max-w-[200px] truncate font-medium">
                {tab.title || "Untitled Tab"}
            </TableCell>
            <TableCell onClick={handleOpen} className="text-[11px] text-muted-foreground whitespace-nowrap flex justify-end items-center gap-2 pr-4 h-12">
                <span className="opacity-60">{formatTaskTime(tab.timestamp)}</span>
                <Trash2
                    className="w-4 h-4 hover:text-destructive cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={handleDelete}
                />
            </TableCell>
        </TableRow>
    );
});
 

export default function SearchTab({
    workspace, isOpen, setOpen, query
}: {
    workspace?: string | null;
    isOpen: boolean;
    setOpen: (open: boolean) => void;
    query: string;
}) {
    const { pyInvoke } = usePython();
    const [tabs, setTabs]           = useState<any[]>([]);
    const [loading, setLoading]     = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    // Refs  live values readable from async callbacks without stale closures
    const pageRef       = useRef(0);
    const hasMoreRef    = useRef(true);
    const loadingRef    = useRef(false);
    const tabsRef       = useRef<any[]>([]);
    const queryRef      = useRef(query);
    const sentinelRef   = useRef<HTMLDivElement>(null);
    // Prevents the IntersectionObserver from firing before the first page is loaded
    const initializedRef = useRef(false);
    // Keep refs in sync with latest render values
    tabsRef.current  = tabs;
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
            const db     = workspace ?? "global";
            const limit  = 50;
            const offset = pageNum * limit;
            const q      = queryRef.current;
            const searchClause = q ? "WHERE metadata LIKE ?" : "";
            const res = await pyInvoke("sqlite", {
                db,
                command: "query",
                sql: `SELECT id, metadata FROM tab_metadata ${searchClause} ORDER BY rowid DESC LIMIT ${limit} OFFSET ${offset}`,
                params: q ? [`%${q}%`] : []
            });
            const rows: any[] = res?.data ?? (Array.isArray(res) ? res : []);
            if (!Array.isArray(rows)) return;
            hasMoreRef.current = rows.length === limit;
            const parsed = rows.map((row: any) => {
                try   { return { id: row.id, ...JSON.parse(row.metadata) }; }
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
            pageRef.current    = 0;
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
            const db           = workspace ?? "global";
            const placeholders = ids.map(() => "?").join(",");
            await pyInvoke("sqlite", {
                db,
                command: "execute",
                sql: `DELETE FROM tab_metadata WHERE id IN (${placeholders})`,
                params: ids
            });
            setSelectedIds(prev => {
                const next = new Set(prev);
                ids.forEach(i => next.delete(i));
                return next;
            });
            pageRef.current    = 0;
            hasMoreRef.current = true;
            loadTabs(0, true);
        } catch (e) {
            console.error(e);
        }
    }, [selectedIds, workspace, pyInvoke, loadTabs]);
    //  Open selected / open single 
    const openTab = (id: string) => {
        const tab = tabsRef.current.find((t: any) => t.id === id);
        if (tab) addTab({ uuid: id, title: tab.title, layout: tab.layout, iconOverride: tab.iconOverride, group: tab.group, childrenProps: tab.childrenProps, size: tab.size });
    };
    const handleOpen = useCallback(() => {
        if (selectedIds.size === 0) return;
        selectedIds.forEach(id => openTab(id));
        setOpen(false);
    }, [selectedIds, setOpen]);
    const handleOpenId = useCallback((id: string) => {
        openTab(id);
        setOpen(false);
    }, [setOpen]);
    const handleDeleteRow = useCallback((id: string) => handleDelete(id), [handleDelete]);
    const handleDeleteSelected = useCallback(() => handleDelete(), [handleDelete]);
    //  Render 
    const allSelected = tabs.length > 0 && selectedIds.size === tabs.length;
    const isEmpty     = tabs.length === 0;
    return (
        <>
            <div className="flex justify-center items-center w-[97.5%] mx-auto px-2">
                <div className="w-6">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                </div>
                <div className="flex-1" />
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
                    <button onClick={handleOpen}          className="p-2 border border-[hsl(var(--chat-border))] rounded-full w-20">Open</button>
                    <button onClick={handleDeleteSelected} className="p-2 border border-[hsl(var(--chat-border))] rounded-full w-20">Delete</button>
                </div>
            </div>
        </>
    );
}