import { useState, useCallback, useMemo, memo } from "react";
import { Check, Copy, MessageCircleWarning, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";
import { formatTaskTime, LucideIcons, addTab, TabInfo, deleteTabWithGroupSelection } from "../utils/state";
import clsx from "clsx";
import { useGlobal } from "./useGlobal";
import { AsyncLock, usePython, useSnapshot, uuidv4 } from "../index";
import { Button } from "./ui";
import { useDatabaseImpl } from "./useDatabase";
import { getAllWebviews } from "@tauri-apps/api/webview";

const truncate = (text: unknown, length = 50) => {
    if (text === null || text === undefined) return "";
    const str = typeof text === "string" ? text : String(text);
    if (!str) return "";
    if (str.length <= length) return str;
    return str.slice(0, length) + "...";
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

const TabRow = memo(({ tab, isSelected, onToggle, onOpen, onDelete }: {
    tab: ControllableBrowser & { uuid: string };
    isSelected: boolean;
    onToggle: (uuid: string) => void;
    onOpen: (uuid: string) => void;
    onDelete: (uuid: string) => void;
}) => {
    const handleToggle = useCallback(() => onToggle(tab.uuid), [tab.uuid, onToggle]);
    const handleOpen = useCallback(() => onOpen(tab.uuid), [tab.uuid, onOpen]);
    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete(tab.uuid);
    }, [tab.uuid, onDelete]);
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback((e: React.MouseEvent) => {
        e.stopPropagation(); // Prevents triggering any row-level clicks
        navigator.clipboard.writeText(tab.uuid);
        setCopied(true);
        setTimeout(() => setCopied(false), 750);
    }, [tab.uuid]);

    return (
        <TableRow className="border-accent/5 hover:bg-accent/5 transition-colors cursor-pointer h-12 group">
            <TableCell className="w-10 cursor-default" onClick={e => e.stopPropagation()}>
                <Checkbox checked={isSelected} onCheckedChange={handleToggle} />
            </TableCell>
            <TableCell onClick={handleOpen} className="w-8 text-xs text-muted-foreground">
                <TabIcon iconVal={tab.icon} />
            </TableCell>
            <TableCell className="max-w-[50px]" onClick={handleOpen} >
                <div className="flex items-center gap-2">
                    <span className="truncate text-xs text-gray-500">{truncate(tab.uuid) || "-1"}</span>
                    <div onClick={handleCopy}>
                        {copied ? (
                            <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        ) : (
                            <Copy className="w-3.5 h-3.5 shrink-0 text-muted-foreground hover:text-foreground" />
                        )}
                    </div>
                </div>
            </TableCell>
            <TableCell onClick={handleOpen} className="max-w-[200px] truncate font-medium">
                {truncate(tab.name) || "Untitled"}
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

export interface ControllableBrowser {
    name: string;
    url: string;
    icon: string;
    timestamp: number;
}

const inputCls = "w-full px-2 py-1 text-xs rounded border outline-none bg-accent/5 border-accent/20 text-foreground placeholder:text-muted-foreground focus:border-accent/40";

export default function ControllableBrowsers({
    workspace, isOpen, setOpen, query
}: {
    workspace?: string | null;
    isOpen: boolean;
    setOpen: (open: boolean) => void;
    query: string;
}) {
    const { pyInvoke } = usePython();
    const [tabs, setTabs] = useDatabaseImpl<Record<string, ControllableBrowser>>('ControllableBrowser', { initialValue: {} });
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isAdding, setIsAdding] = useState(false);
    const [newBrowserName, setNewBrowserName] = useState("");
    const [newBrowserUrl, setNewBrowserUrl] = useState("");
    const { SetActive } = useSnapshot(TabInfo);

    const filteredTabs = useMemo(() => {
        const tabsArray = Object.entries(tabs || {}).map(([uuid, data]) => ({
            uuid,
            ...data
        })).sort((a, b) => b.timestamp - a.timestamp);

        return query
            ? tabsArray.filter(t => JSON.stringify(t).toLowerCase().includes(query.toLowerCase()))
            : tabsArray;
    }, [tabs, query]);

    const resetAddForm = useCallback(() => {
        setIsAdding(false);
        setNewBrowserName("");
        setNewBrowserUrl("");
    }, []);

    const handleAddBrowser = useCallback(() => {
        const name = newBrowserName.trim();
        if (!name) return;

        const url = newBrowserUrl.trim() || "about:blank";
        const newUuid = `agent-${uuidv4()}`;

        setTabs(prev => ({
            [newUuid]: {
                name,
                url,
                icon: "Earth",
                timestamp: Date.now()
            },
            ...(prev || {})
        }));

        resetAddForm();
    }, [newBrowserName, newBrowserUrl, setTabs, resetAddForm]);

    const handleDelete = useCallback(async (uuid?: string) => {
        const ids = uuid ? [uuid] : Array.from(selectedIds);
        if (ids.length === 0) return;

        ids.forEach(async (label: string) => {
            await AsyncLock.run(async () => {
                const all = await getAllWebviews();
                const w = all.find((wv) => wv.label === `webview-${label}`);
                if (w) {
                    await w.close();
                    setTimeout(async () => {
                        await pyInvoke("delete_browser_data", { label })
                    }, 2000)
                }
            });
            (async () => { await deleteTabWithGroupSelection(label); })();
        });

        setTabs(prev => {
            const next = { ...prev };
            ids.forEach(i => delete next[i]);
            return next;
        });

        setSelectedIds(prev => {
            const next = new Set(prev);
            ids.forEach(i => next.delete(i));
            return next;
        });
    }, [selectedIds, setTabs]);

    const openTab = useCallback((uuid: string) => {
        const tab = (tabs || {})[uuid];
        if (!tab) return;
        addTab({
            uuid,
            title: tab.name,
            iconOverride: tab.icon || "Earth",
            layout: "single",
            childrenProps: {
                [uuid]: {
                    icon: tab.icon || "Earth",
                    title: tab.name,
                    appname: "main-app",
                    data: { url: tab.url || uuid }
                }
            }
        });
        SetActive(uuid);
    }, [tabs, SetActive]);

    const toggleSelect = useCallback((uuid: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.has(uuid) ? next.delete(uuid) : next.add(uuid);
            return next;
        });
    }, []);

    const toggleSelectAll = useCallback(() => {
        setSelectedIds(prev =>
            prev.size === filteredTabs.length && filteredTabs.length > 0
                ? new Set()
                : new Set(filteredTabs.map(t => t.uuid))
        );
    }, [filteredTabs]);

    const handleOpenId = useCallback((uuid: string) => {
        openTab(uuid);
        setOpen(false);
    }, [openTab, setOpen]);

    const handleDeleteRow = useCallback((uuid: string) => handleDelete(uuid), [handleDelete]);
    const handleDeleteSelected = useCallback(() => handleDelete(), [handleDelete]);

    const allSelected = filteredTabs.length > 0 && selectedIds.size === filteredTabs.length;

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleAddBrowser();
        else if (e.key === 'Escape') resetAddForm();
    }, [handleAddBrowser, resetAddForm]);

    return (
        <>
            {/* Toolbar row */}
            <div className="flex justify-center items-center w-[97.5%] mx-auto px-2">
                <div className="w-6 shrink-0">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                </div>
                <div className="flex items-center text-xs opacity-50 gap-1">
                    <MessageCircleWarning size={10} />
                    <span>These browsers can be controlled by an agent{!(window as any).IS_LINUX && <>, each with an isolated browser profile</>}, and remain active in the background.</span>
                </div>
                <div className="flex-1" />
                {!isAdding && (
                    <Button variant="secondary" className="flex items-center justify-center shrink-0" size="sm" onClick={() => setIsAdding(true)}>
                        Add Browser <Plus className="w-6 h-6" />
                    </Button>
                )}
            </div>

            {/* Full-width add form */}
            {isAdding && (
                <div className="w-[97.5%] mx-auto px-2 py-2 flex flex-col gap-2 border-t border-accent/10">
                    <div className="flex flex-col gap-2">
                        <input
                            type="text"
                            placeholder="Browser name..."
                            value={newBrowserName}
                            onChange={e => setNewBrowserName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className={inputCls}
                            autoFocus
                        />
                        <input
                            type="text"
                            placeholder="URL"
                            value={newBrowserUrl}
                            onChange={e => setNewBrowserUrl(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className={inputCls}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={resetAddForm}>Cancel</Button>
                        <Button variant="secondary" size="sm" onClick={handleAddBrowser}>Add</Button>
                    </div>
                </div>
            )}

            <ScrollArea className="flex-1 -mx-6 w-[97.5%] mx-auto border-t border-b border-[hsl(var(--chat-border))]">
                <Table>
                    <TableBody>
                        {filteredTabs.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="h-12 text-center text-muted-foreground text-xs">
                                    No results
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredTabs.map(tab => (
                                <TabRow
                                    key={tab.uuid}
                                    tab={tab}
                                    isSelected={selectedIds.has(tab.uuid)}
                                    onToggle={toggleSelect}
                                    onOpen={handleOpenId}
                                    onDelete={handleDeleteRow}
                                />
                            ))
                        )}
                    </TableBody>
                </Table>
            </ScrollArea>

            <div className={clsx(
                selectedIds.size > 0 ? "flex justify-center items-center" : "hidden",
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