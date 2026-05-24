import { useState, useEffect, useCallback, memo, useRef } from "react";
import { Trash2, Plus, Eye, EyeOff, ChevronDown, KeyRound, CheckCircle2, AlertCircle, Search, X, Copy } from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";
import { usePython } from "./usePython";
import { Spinner } from "./ui/spinner";
import clsx from "clsx";

const PROVIDER_KEYS: Record<string, string[]> = {
    "openai": ["OPENAI_API_KEY"],
    "anthropic": ["ANTHROPIC_API_KEY"],
    "gemini": ["GEMINI_API_KEY"],
    "groq": ["GROQ_API_KEY"],
    "mistral": ["MISTRAL_API_KEY"],
    "cohere": ["COHERE_API_KEY"],
    "openrouter": ["OPENROUTER_API_KEY"],
    "xai": ["XAI_API_KEY"],
    "deepseek": ["DEEPSEEK_API_KEY"],
    "perplexity": ["PERPLEXITYAI_API_KEY"],
    "azure": ["AZURE_API_KEY", "AZURE_AD_TOKEN"],
    "vertex_ai": ["GOOGLE_APPLICATION_CREDENTIALS", "VERTEX_AI_PROJECT", "VERTEX_AI_LOCATION"],
    "bedrock": ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
    "aws": ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
    "huggingface": ["HUGGINGFACE_API_KEY"],
    "together_ai": ["TOGETHERAI_API_KEY"],
    "replicate": ["REPLICATE_API_KEY"],
    "fireworks_ai": ["FIREWORKSAI_API_KEY"],
    "cerebras": ["CEREBRAS_API_KEY"],
    "ai21": ["AI21_API_KEY"],
    "aleph_alpha": ["ALEPHALPHA_API_KEY"],
    "anyscale": ["ANYSCALE_API_KEY"],
    "baseten": ["BASETEN_API_KEY"],
    "black_forest_labs": ["BLACK_FOREST_LABS_API_KEY"],
    "bytez": ["BYTEZ_API_KEY"],
    "chutes": ["CHUTES_API_KEY"],
    "clarifai": ["CLARIFAI_API_KEY"],
    "cloudflare": ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID"],
    "codestral": ["CODESTRAL_API_KEY"],
    "cometapi": ["COMETAPI_API_KEY"],
    "compactifai": ["COMPACTIFAI_API_KEY"],
    "dashscope": ["DASHSCOPE_API_KEY"],
    "databricks": ["DATABRICKS_API_KEY"],
    "deepgram": ["DEEPGRAM_API_KEY"],
    "deepinfra": ["DEEPINFRA_API_KEY"],
    "elevenlabs": ["ELEVENLABS_API_KEY"],
    "fal_ai": ["FAL_AI_API_KEY"],
    "featherless_ai": ["FEATHERLESS_AI_API_KEY"],
    "friendliai": ["FRIENDLIAI_API_KEY"],
    "galadriel": ["GALADRIEL_API_KEY"],
    "github": ["GITHUB_API_KEY"],
    "gradient_ai": ["GRADIENT_AI_API_KEY"],
    "helicone": ["HELICONE_API_KEY"],
    "heroku": ["HEROKU_API_KEY"],
    "hyperbolic": ["HYPERBOLIC_API_KEY"],
    "jina_ai": ["JINA_AI_API_KEY"],
    "lambda_ai": ["LAMBDA_API_KEY"],
    "langgraph": ["LANGGRAPH_API_KEY"],
    "lemonade": ["LEMONADE_API_KEY"],
    "llamafile": ["LLAMAFILE_API_KEY"],
    "lm_studio": ["LM_STUDIO_API_KEY"],
    "manus": ["MANUS_API_KEY"],
    "minimax": ["MINIMAX_API_KEY"],
    "moonshot": ["MOONSHOT_API_KEY"],
    "morph": ["MORPH_API_KEY"],
    "nebius": ["NEBIUS_API_KEY"],
    "novita": ["NOVITA_API_KEY"],
    "nscale": ["NSCALE_API_KEY"],
    "nvidia_nim": ["NVIDIA_NIM_API_KEY"],
    "oci": ["OCI_API_KEY"],
    "ovhcloud": ["OVHCLOUD_API_KEY"],
    "poe": ["POE_API_KEY"],
    "predibase": ["PREDIBASE_API_KEY"],
    "publicai": ["PUBLICAI_API_KEY"],
    "ragflow": ["RAGFLOW_API_KEY"],
    "recraft": ["RECRAFT_API_KEY"],
    "runwayml": ["RUNWAYML_API_SECRET"],
    "sambanova": ["SAMBANOVA_API_KEY"],
    "scaleway": ["SCALEWAY_API_KEY"],
    "snowflake": ["SNOWFLAKE_API_KEY", "SNOWFLAKE_ACCOUNT_ID"],
    "stability": ["STABILITY_API_KEY"],
    "synthetic": ["SYNTHETIC_API_KEY"],
    "stima": ["STIMA_API_KEY"],
    "topaz": ["TOPAZ_API_KEY"],
    "v0": ["V0_API_KEY"],
    "volcengine": ["VOLCENGINE_API_KEY"],
    "voyage": ["VOYAGE_API_KEY"],
    "watsonx": ["WATSONX_API_KEY", "WATSONX_TOKEN", "WATSONX_REGION"],
    "xinference": ["XINFERENCE_API_KEY"],
    "zai": ["ZAI_API_KEY"]
};

const PROVIDERS = Object.keys(PROVIDER_KEYS).sort();


function providerLabel(p: string) {
    return p.replace(/_/g, " ");
}
/** Returns true if every key required by this provider is already stored. */

function isProviderFullyAdded(provider: string, storedNames: Set<string>): boolean {
    return (PROVIDER_KEYS[provider] ?? []).every(k => storedNames.has(k));
}
 

const CredentialRow = memo(({
    cred, isSelected, onToggle, onCopy, onDelete
}: {
    cred: { name: string; value: string; length: number };
    isSelected: boolean;
    onToggle: (name: string) => void;
    onCopy: (name: string) => void;
    onDelete: (name: string) => void;
}) => (
    <TableRow className="border-accent/5 hover:bg-accent/5 transition-colors h-12 group">
        {/* Checkbox */}
        <TableCell className="w-10 cursor-default" onClick={e => e.stopPropagation()}>
            <Checkbox checked={isSelected} onCheckedChange={() => onToggle(cred.name)} />
        </TableCell>
        {/* Key icon */}
        <TableCell className="w-8">
            <KeyRound className="w-3.5 h-3.5 text-muted-foreground/60" />
        </TableCell>
        {/* Name */}
        <TableCell className="font-mono text-xs font-medium max-w-[180px] truncate">
            {cred.name}
        </TableCell>
        {/* Value */}
        <TableCell className="font-mono text-xs text-muted-foreground max-w-[160px] truncate select-none">
            ●●●●●●●●●●●●●●●●●●●
        </TableCell>
        {/* Actions */}
        <TableCell className="w-20 text-right pr-3">
            <span className="inline-flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    className="hover:text-foreground text-muted-foreground transition-colors"
                    onClick={e => { e.stopPropagation(); onCopy(cred.name); }}
                >
                    <Copy className="w-3.5 h-3.5"/>
                </button>
                <button
                    className="hover:text-destructive text-muted-foreground transition-colors"
                    onClick={e => { e.stopPropagation(); onDelete(cred.name); }}
                    title="Delete"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </span>
        </TableCell>
    </TableRow>
));
 

function AddCredentialForm({
    onSave,
    onCancel,
    saving,
    storedNames,
}: {
    onSave: (entries: Record<string, string>) => Promise<void>;
    onCancel: () => void;
    saving: boolean;
    /** Set of credential key names already stored  used to hide fully-configured providers. */
    storedNames: Set<string>;
}) {
    const [provider, setProvider] = useState<string>("");
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [focusedIdx, setFocusedIdx] = useState(-1);
    const [values, setValues] = useState<Record<string, string>>({});
    const [showPwd, setShowPwd] = useState<Record<string, boolean>>({});
    const [showAdded, setShowAdded] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const keys = provider ? PROVIDER_KEYS[provider] ?? [] : [];
    // Split providers into available vs already-added
    const { availableProviders, addedProviders } = PROVIDERS.reduce<{
        availableProviders: string[];
        addedProviders: string[];
    }>(
        (acc, p) => {
            if (isProviderFullyAdded(p, storedNames)) {
                acc.addedProviders.push(p);
            } else {
                acc.availableProviders.push(p);
            }
            return acc;
        },
        { availableProviders: [], addedProviders: [] }
    );
    // The visible pool depends on whether the user wants to see already-added ones too
    const providerPool = showAdded ? PROVIDERS : availableProviders;
    // Filter by search query
    const filteredProviders = providerPool.filter(p => {
        const q = search.toLowerCase();
        return (
            p.toLowerCase().includes(q) ||
            providerLabel(p).toLowerCase().includes(q) ||
            (PROVIDER_KEYS[p]?.[0] ?? "").toLowerCase().includes(q)
        );
    });
    // Reset values when provider changes
    const handleProvider = (p: string) => {
        setProvider(p);
        setValues({});
        setShowPwd({});
        setOpen(false);
        setSearch("");
        setFocusedIdx(-1);
    };
    // Open dropdown and focus search
    const handleOpen = () => {
        setOpen(o => {
            if (!o) {
                setSearch("");
                setFocusedIdx(-1);
                setTimeout(() => searchRef.current?.focus(), 10);
            }
            return !o;
        });
    };
    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
                setOpen(false);
                setSearch("");
                setFocusedIdx(-1);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);
    // Scroll focused item into view
    useEffect(() => {
        if (focusedIdx < 0 || !listRef.current) return;
        const items = listRef.current.querySelectorAll<HTMLButtonElement>("[data-item]");
        items[focusedIdx]?.scrollIntoView({ block: "nearest" });
    }, [focusedIdx]);
    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocusedIdx(i => Math.min(i + 1, filteredProviders.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocusedIdx(i => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (focusedIdx >= 0 && filteredProviders[focusedIdx]) {
                handleProvider(filteredProviders[focusedIdx]);
            }
        } else if (e.key === "Escape") {
            setOpen(false);
            setSearch("");
            setFocusedIdx(-1);
        }
    };
    const filled = keys.length > 0 && keys.every(k => (values[k] ?? "").trim().length > 0);
    const handleSubmit = async () => {
        if (!filled) return;
        const filtered = Object.fromEntries(
            Object.entries(values).filter(([, v]) => v.trim().length > 0)
        );
        await onSave(filtered);
    };
    return (
        <div className="flex flex-col gap-3 p-4 border border-[hsl(var(--chat-border))] rounded-xl bg-accent/5 mx-auto w-[97.5%]">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Add Credentials
            </p>
            {/* Provider dropdown */}
            <div ref={wrapRef} className="relative">
                <button
                    type="button"
                    onClick={handleOpen}
                    className={clsx(
                        "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm",
                        "border border-[hsl(var(--chat-border))] bg-background hover:bg-accent/10 transition-colors",
                        open && "rounded-b-none border-b-0"
                    )}
                >
                    <span className={provider ? "text-foreground" : "text-muted-foreground"}>
                        {provider ? providerLabel(provider) : "Select provider…"}
                    </span>
                    <ChevronDown className={clsx("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-180")} />
                </button>
                {open && (
                    <div className="absolute z-50 w-full rounded-b-lg border border-t-0 border-[hsl(var(--chat-border))] bg-background shadow-lg">
                        {/* Search input */}
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--chat-border))]">
                            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <input
                                ref={searchRef}
                                type="text"
                                value={search}
                                onChange={e => { setSearch(e.target.value); setFocusedIdx(-1); }}
                                onKeyDown={handleSearchKeyDown}
                                placeholder="Search providers…"
                                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                            />
                            {search && (
                                <button
                                    type="button"
                                    onClick={() => { setSearch(""); setFocusedIdx(-1); searchRef.current?.focus(); }}
                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                    aria-label="Clear search"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                        {/* Results count + toggle for already-added */}
                        <div className="flex items-center justify-between px-3 py-1">
                            <span className="text-[10px] text-muted-foreground/60">
                                {filteredProviders.length} provider{filteredProviders.length !== 1 ? "s" : ""}
                                {search ? ` for "${search}"` : ""}
                            </span>
                            {addedProviders.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => { setShowAdded(v => !v); setFocusedIdx(-1); }}
                                    className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors flex items-center gap-1"
                                >
                                    {showAdded
                                        ? <EyeOff className="w-2.5 h-2.5" />
                                        : <Eye className="w-2.5 h-2.5" />}
                                    {showAdded
                                        ? `Hide ${addedProviders.length} added`
                                        : `Show ${addedProviders.length} already added`}
                                </button>
                            )}
                        </div>
                        {/* List */}
                        <div ref={listRef} className="max-h-52 overflow-y-auto">
                            {filteredProviders.length === 0 ? (
                                <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                                    {!showAdded && addedProviders.length > 0
                                        ? "All matching providers are already added"
                                        : "No providers found"}
                                </div>
                            ) : (
                                filteredProviders.map((p, i) => {
                                    const alreadyAdded = isProviderFullyAdded(p, storedNames);
                                    return (
                                        <button
                                            key={p}
                                            data-item
                                            type="button"
                                            onClick={() => handleProvider(p)}
                                            onMouseEnter={() => setFocusedIdx(i)}
                                            className={clsx(
                                                "w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2",
                                                (provider === p || i === focusedIdx) && "bg-accent/20",
                                                provider === p && "font-medium",
                                                alreadyAdded && "opacity-50"
                                            )}
                                        >
                                            <span className="flex items-center gap-1.5">
                                                {providerLabel(p)}
                                                {alreadyAdded && (
                                                    <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                                                )}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground font-mono truncate shrink-0 max-w-[140px]">
                                                {PROVIDER_KEYS[p]?.[0]}
                                            </span>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}
            </div>
            {/* Key inputs */}
            {keys.map(key => (
                <div key={key} className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-muted-foreground">{key}</label>
                    <div className="relative">
                        <input
                            type={showPwd[key] ? "text" : "password"}
                            placeholder={`Enter ${key}`}
                            value={values[key] ?? ""}
                            onChange={e => setValues(prev => ({ ...prev, [key]: e.target.value }))}
                            className={clsx(
                                "w-full px-3 py-2 pr-8 rounded-lg text-sm font-mono",
                                "border border-[hsl(var(--chat-border))] bg-background",
                                "focus:outline-none focus:ring-1 focus:ring-accent/50 transition"
                            )}
                        />
                        <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => setShowPwd(prev => ({ ...prev, [key]: !prev[key] }))}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {showPwd[key]
                                ? <EyeOff className="w-3.5 h-3.5" />
                                : <Eye className="w-3.5 h-3.5" />}
                        </button>
                    </div>
                </div>
            ))}
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
                    disabled={!filled || saving}
                    className={clsx(
                        "px-4 py-1.5 text-sm rounded-full border transition-colors flex items-center gap-1.5",
                        filled && !saving
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
            type === "success" ? "bg-green-500/10 text-green-600 border border-green-500/20"
                : "bg-destructive/10 text-destructive border border-destructive/20"
        )}>
            {type === "success"
                ? <CheckCircle2 className="w-3.5 h-3.5" />
                : <AlertCircle className="w-3.5 h-3.5" />}
            {message}
        </div>
    );
}
 

export default function Credentials({
    isOpen,
}: {
    isOpen: boolean;
}) {
    const { pyInvoke } = usePython();
    const [creds, setCreds] = useState<{ name: string; value: string; length: number }[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [adding, setAdding] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
    //  Toast helper 
    const showToast = (message: string, type: "success" | "error" = "success") => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 2500);
    };
    //  Load credentials 
    const loadCredentials = useCallback(async () => {
        if (!isOpen) return;
        setLoading(true);
        try {
            const res = await pyInvoke("credentials", { command: "list" });
            const list = res?.data?.credentials ?? res?.credentials ?? [];
            // Get unmasked values for display
            const withValues = await Promise.all(
                list.map(async (c: { name: string }) => {
                    const r = await pyInvoke("credentials", { command: "get", name: c.name, unmask: true });
                    return { name: c.name, value: r?.data?.value ?? "••••••••", length: r?.data?.value?.length ?? 0 };
                })
            );
            setCreds(withValues);
        } catch (e) {
            console.error(e);
            showToast("Failed to load credentials", "error");
        } finally {
            setLoading(false);
        }
    }, [isOpen, pyInvoke]);
    useEffect(() => { loadCredentials(); }, [loadCredentials]);
    //  Save new credentials 
    const handleSave = useCallback(async (entries: Record<string, string>) => {
        setSaving(true);
        try {
            await Promise.all(
                Object.entries(entries).map(([name, value]) =>
                    pyInvoke("credentials", { command: "set", name, value })
                )
            );
            showToast(`Saved ${Object.keys(entries).length} key(s)`);
            setAdding(false);
            await loadCredentials();
        } catch (e) {
            console.error(e);
            showToast("Failed to save credentials", "error");
        } finally {
            setSaving(false);
        }
    }, [pyInvoke, loadCredentials]);
    //  Delete one 
    const handleDelete = useCallback(async (name: string) => {
        try {
            await pyInvoke("credentials", { command: "delete", name });
            setSelectedIds(prev => { const n = new Set(prev); n.delete(name); return n; });
            showToast(`Deleted ${name}`);
            await loadCredentials();
        } catch (e) {
            console.error(e);
            showToast("Failed to delete credential", "error");
        }
    }, [pyInvoke, loadCredentials]);
    //  Delete selected 
    const handleDeleteSelected = useCallback(async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        try {
            await Promise.all(ids.map(name => pyInvoke("credentials", { command: "delete", name })));
            setSelectedIds(new Set());
            showToast(`Deleted ${ids.length} credential(s)`);
            await loadCredentials();
        } catch (e) {
            console.error(e);
            showToast("Failed to delete credentials", "error");
        }
    }, [selectedIds, pyInvoke, loadCredentials]);
    //  Selection helpers 
    const toggleSelect = useCallback((name: string) => {
        setSelectedIds(prev => {
            const n = new Set(prev);
            n.has(name) ? n.delete(name) : n.add(name);
            return n;
        });
    }, []);
    const toggleSelectAll = useCallback(() => {
        setSelectedIds(prev =>
            prev.size === creds.length && creds.length > 0
                ? new Set()
                : new Set(creds.map(c => c.name))
        );
    }, [creds]);
    // Derive the set of stored credential names for the form to use
    const storedNames = new Set(creds.map(c => c.name));
    //  Render 
    const allSelected = creds.length > 0 && selectedIds.size === creds.length;
    const isEmpty = creds.length === 0;
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
                    onClick={() => { setAdding(a => !a); }}
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
                <AddCredentialForm
                    onSave={handleSave}
                    onCancel={() => setAdding(false)}
                    saving={saving}
                    storedNames={storedNames}
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
                                        {loading
                                            ? <><Spinner /><span>Loading…</span></>
                                            : (
                                                <>
                                                    <KeyRound className="w-6 h-6 opacity-20" />
                                                    <span className="opacity-50">No credentials stored</span>
                                                </>
                                            )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            creds.map(cred => (
                                <CredentialRow
                                    key={cred.name}
                                    cred={cred}
                                    isSelected={selectedIds.has(cred.name)}
                                    onToggle={toggleSelect}
                                    onCopy={async() => {
                                        await navigator.clipboard.writeText(cred.value);
                                    }}
                                    onDelete={handleDelete}
                                />
                            ))
                        )}
                    </TableBody>
                </Table>
                {loading && creds.length > 0 && (
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
                        Delete
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