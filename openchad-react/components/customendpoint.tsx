import { useState, useCallback, memo } from "react";
import { Trash2, Plus, Link2, CheckCircle2, AlertCircle, Globe } from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";
import { Spinner } from "./ui/spinner";
import clsx from "clsx";


function isValidUrl(value: string): boolean {
    try {
        const url = new URL(value.trim());
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}
/** Shortens a URL for display  keeps host + first path segment. */

function shortUrl(url: string): string {
    try {
        const u = new URL(url);
        const segments = u.pathname.split("/").filter(Boolean);
        const short = segments.length > 0
            ? `${u.host}/${segments[0]}${segments.length > 1 ? "/…" : ""}`
            : u.host;
        return `${u.protocol}//${short}`;
    } catch {
        return url;
    }
}
 

const EndpointRow = memo(({
    url,
    isSelected,
    onToggle,
    onDelete,
}: {
    url: string;
    isSelected: boolean;
    onToggle: (url: string) => void;
    onDelete: (url: string) => void;
}) => (
    <TableRow className="border-accent/5 hover:bg-accent/5 transition-colors h-12 group">
        {/* Checkbox */}
        <TableCell className="w-10 cursor-default" onClick={e => e.stopPropagation()}>
            <Checkbox checked={isSelected} onCheckedChange={() => onToggle(url)} />
        </TableCell>
        {/* Icon */}
        <TableCell className="w-8">
            <Link2 className="w-3.5 h-3.5 text-muted-foreground/60" />
        </TableCell>
        {/* Shortened URL */}
        <TableCell className="font-mono text-xs font-medium max-w-[200px] truncate">
            <span title={url}>{shortUrl(url)}</span>
        </TableCell>
        {/* Full URL (faded, shown on hover) */}
        <TableCell className="font-mono text-[10px] text-muted-foreground max-w-[180px] truncate select-none opacity-0 group-hover:opacity-60 transition-opacity">
            {url}
        </TableCell>
        {/* Delete */}
        <TableCell className="w-12 text-right pr-3">
            <button
                className="hover:text-destructive text-muted-foreground transition-colors opacity-0 group-hover:opacity-100"
                onClick={e => { e.stopPropagation(); onDelete(url); }}
                title="Remove endpoint"
            >
                <Trash2 className="w-3.5 h-3.5" />
            </button>
        </TableCell>
    </TableRow>
));
 

function AddEndpointForm({
    onSave,
    onCancel,
    saving,
    existing,
}: {
    onSave: (url: string) => Promise<void>;
    onCancel: () => void;
    saving: boolean;
    existing: string[];
}) {
    const [value, setValue] = useState("");
    const trimmed = value.trim();
    const valid = isValidUrl(trimmed);
    const duplicate = existing.includes(trimmed);
    const canSave = valid && !duplicate && !saving;
    const handleSubmit = async () => {
        if (!canSave) return;
        await onSave(trimmed);
        setValue("");
    };
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") handleSubmit();
        if (e.key === "Escape") onCancel();
    };
    return (
        <div className="flex flex-col gap-3 p-4 border border-[hsl(var(--chat-border))] rounded-xl bg-accent/5 mx-auto w-[97.5%]">
            {/* Header + description */}
            <div className="flex flex-col gap-0.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Add Endpoint
                </p>
                <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    Point to any OpenAI-compatible base URL  ideal for self-hosted inference servers or corporate proxies.
                </p>
            </div>
            {/* URL input */}
            <div className="flex flex-col gap-1">
                <label className="text-[11px] font-mono text-muted-foreground">Base URL</label>
                <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
                    <input
                        type="url"
                        autoFocus
                        placeholder="https://my-server.local/v1"
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className={clsx(
                            "w-full pl-9 pr-3 py-2 rounded-lg text-sm font-mono",
                            "border bg-background",
                            "focus:outline-none focus:ring-1 transition",
                            duplicate
                                ? "border-destructive/50 focus:ring-destructive/30"
                                : trimmed && !valid
                                    ? "border-destructive/50 focus:ring-destructive/30"
                                    : "border-[hsl(var(--chat-border))] focus:ring-accent/50"
                        )}
                    />
                </div>
                {/* Inline validation hint */}
                {duplicate && (
                    <p className="text-[10px] text-destructive flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> This endpoint is already saved.
                    </p>
                )}
                {trimmed && !valid && !duplicate && (
                    <p className="text-[10px] text-destructive flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Enter a valid http:// or https:// URL.
                    </p>
                )}
            </div>
            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={saving}
                    className="px-4 py-1.5 text-sm rounded-full border border-[hsl(var(--chat-border))] hover:bg-accent/10 transition-colors disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSave}
                    className={clsx(
                        "px-4 py-1.5 text-sm rounded-full border transition-colors flex items-center gap-1.5",
                        canSave
                            ? "border-accent bg-accent/20 hover:bg-accent/30 text-foreground"
                            : "border-[hsl(var(--chat-border))] opacity-40 cursor-not-allowed"
                    )}
                >
                    {saving ? <><Spinner /><span>Saving…</span></> : "Save"}
                </button>
            </div>
        </div>
    );
}


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
 

export default function CustomEndpoint({
    endpoints,
    addEndpoint,
    deleteEndpoint,
}: {
    /** Current list of saved base URLs  read from settings by the parent. */
    endpoints: string[];
    /** Persists a new URL into settings. */
    addEndpoint: (url: string) => Promise<void>;
    /** Removes a URL from settings. */
    deleteEndpoint: (url: string) => Promise<void>;
}) {
    const [adding, setAdding] = useState(false);
    const [saving, setSaving] = useState(false);
    const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
    const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
    //  Toast helper 
    const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 2500);
    }, []);
    //  Save new endpoint 
    const handleSave = useCallback(async (url: string) => {
        setSaving(true);
        try {
            await addEndpoint(url);
            setAdding(false);
            showToast("Endpoint saved");
        } catch (e) {
            console.error(e);
            showToast("Failed to save endpoint", "error");
        } finally {
            setSaving(false);
        }
    }, [addEndpoint, showToast]);
    //  Delete one 
    const handleDelete = useCallback(async (url: string) => {
        try {
            await deleteEndpoint(url);
            setSelectedUrls(prev => { const n = new Set(prev); n.delete(url); return n; });
            showToast("Endpoint removed");
        } catch (e) {
            console.error(e);
            showToast("Failed to remove endpoint", "error");
        }
    }, [deleteEndpoint, showToast]);
    //  Delete selected 
    const handleDeleteSelected = useCallback(async () => {
        if (selectedUrls.size === 0) return;
        const urls = Array.from(selectedUrls);
        try {
            await Promise.all(urls.map(url => deleteEndpoint(url)));
            setSelectedUrls(new Set());
            showToast(`Removed ${urls.length} endpoint${urls.length > 1 ? "s" : ""}`);
        } catch (e) {
            console.error(e);
            showToast("Failed to remove endpoints", "error");
        }
    }, [selectedUrls, deleteEndpoint, showToast]);
    //  Selection helpers 
    const toggleSelect = useCallback((url: string) => {
        setSelectedUrls(prev => {
            const n = new Set(prev);
            n.has(url) ? n.delete(url) : n.add(url);
            return n;
        });
    }, []);
    const toggleSelectAll = useCallback(() => {
        setSelectedUrls(prev =>
            prev.size === endpoints.length && endpoints.length > 0
                ? new Set()
                : new Set(endpoints)
        );
    }, [endpoints]);
    const allSelected = endpoints.length > 0 && selectedUrls.size === endpoints.length;
    const isEmpty = endpoints.length === 0;
    //  Render 
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
                    onClick={() => setAdding(a => !a)}
                    className={clsx(
                        "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border transition-colors",
                        adding
                            ? "bg-accent/20 border-accent/50 text-foreground"
                            : "border-[hsl(var(--chat-border))] hover:bg-accent/10 text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                </button>
            </div>
            {/* Add form */}
            {adding && (
                <AddEndpointForm
                    onSave={handleSave}
                    onCancel={() => setAdding(false)}
                    saving={saving}
                    existing={endpoints}
                />
            )}
            {/* Table */}
            <ScrollArea className="flex-1 -mx-6 w-[97.5%] mx-auto border-t border-b border-[hsl(var(--chat-border))]">
                <Table>
                    <TableBody>
                        {isEmpty ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground text-xs">
                                    <div className="flex flex-col items-center justify-center gap-2">
                                        <Link2 className="w-6 h-6 opacity-20" />
                                        <span className="opacity-50">No custom endpoints configured</span>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            endpoints.map(url => (
                                <EndpointRow
                                    key={url}
                                    url={url}
                                    isSelected={selectedUrls.has(url)}
                                    onToggle={toggleSelect}
                                    onDelete={handleDelete}
                                />
                            ))
                        )}
                    </TableBody>
                </Table>
            </ScrollArea>
            {/* Bulk action bar */}
            <div className={clsx(
                selectedUrls.size > 0 ? "flex justify-center items-center" : "hidden",
                "pt-2 relative transform translate-y-[-6px] px-4"
            )}>
                <span className="text-xs text-muted-foreground">{selectedUrls.size} selected</span>
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