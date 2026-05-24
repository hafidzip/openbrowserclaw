import { useState, useEffect, useCallback, memo, useRef, Fragment } from "react";
import {
    Trash2, Plus, ChevronDown, CheckCircle2, AlertCircle,
    Search, X, Copy, Server, Globe, Terminal, Check,
    ChevronRight, Wifi,  Unplug, Radio,
    RotateCcw,  Upload
} from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";
import { Spinner } from "./ui/spinner";
import clsx from "clsx";
import { useSettings } from "./useSettings";
import { usePython } from "./usePython";
import { Switch } from "./ui/switch";

type McpTransport = "webrtc" | "sse" | "http" | "websocket" | "stdio";
interface IceServer {
    urls: string;
    username?: string;
    credential?: string;
}
interface McpServerConfig {
    id: string;
    name: string;
    type: McpTransport;
    // stdio
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    // sse / http / websocket
    url?: string;
    headers?: Record<string, string>;
    // webrtc
    signalingUrl?: string;
    channelLabel?: string;
    iceServers?: IceServer[];
    // misc
    timeout?: number;
    enabled: boolean;
}
 

const TRANSPORT_META: Record<McpTransport, { label: string; icon: React.ReactNode; color: string }> = {
    stdio: { label: "stdio", icon: <Terminal className="w-3 h-3" />, color: "text-violet-700 dark:text-violet-400" },
    sse: { label: "SSE", icon: <Wifi className="w-3 h-3" />, color: "text-sky-700 dark:text-sky-400" },
    http: { label: "HTTP", icon: <Globe className="w-3 h-3" />, color: "text-emerald-900 dark:text-emerald-400" },
    websocket: { label: "WebSocket", icon: <Unplug className="w-3 h-3" />, color: "text-amber-700 dark:text-amber-400" },
    webrtc: { label: "WebRTC", icon: <Radio className="w-3 h-3" />, color: "text-rose-700 dark:text-rose-400" },
};
 
interface McpTemplate {
    label: string;
    description: string;
    preset: Partial<McpServerConfig>;
}

const MCP_TEMPLATES: McpTemplate[] = [
    {
        label: "Filesystem",
        description: "Local file access via npx",
        preset: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"] },
    },
    {
        label: "Git",
        description: "Git repository operations",
        preset: { type: "stdio", command: "uvx", args: ["mcp-server-git", "--repository", "/path/to/repo"] },
    },
    {
        label: "PostgreSQL",
        description: "Database via connection string",
        preset: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres"], env: { POSTGRES_CONNECTION_STRING: "postgresql://user:pass@localhost:5432/db" } },
    },
    {
        label: "Brave Search",
        description: "Web search via Brave API",
        preset: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-brave-search"], env: { BRAVE_API_KEY: "" } },
    },
    {
        label: "Puppeteer",
        description: "Browser automation",
        preset: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-puppeteer"] },
    },
    {
        label: "Remote SSE",
        description: "Remote server via SSE",
        preset: { type: "sse", url: "https://mcp.example.com/mcp/sse", headers: { Authorization: "Bearer " } },
    },
    {
        label: "Remote HTTP",
        description: "Remote server via Streamable HTTP",
        preset: { type: "http", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer " } },
    },
    {
        label: "WebSocket",
        description: "WebSocket-based MCP server",
        preset: { type: "websocket", url: "ws://localhost:8765" },
    },
    {
        label: "WebRTC",
        description: "Peer-to-peer via WebRTC data channel",
        preset: {
            type: "webrtc",
            signalingUrl: "wss://signal.example.com/",
            channelLabel: "mcp",
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        },
    },
    {
        label: "Custom stdio",
        description: "Run any local binary",
        preset: { type: "stdio", command: "", args: [] },
    },
];


function generateId() {
    return Math.random().toString(36).slice(2, 10);
}

function serverSummary(s: McpServerConfig): string {
    if (s.type === "stdio") return [s.command, ...(s.args ?? [])].filter(Boolean).join(" ") || "";
    if (s.type === "webrtc") return s.signalingUrl ?? "";
    return s.url ?? "";
}

function parseImportedJson(parsed: any): McpServerConfig[] {
    const results: McpServerConfig[] = [];
    const sanitizeConfig = (key: string, val: any): McpServerConfig | null => {
        if (!val || typeof val !== "object") return null;
        const type = val.type;
        const validTransports: McpTransport[] = ["webrtc", "sse", "http", "websocket", "stdio"];
        if (!validTransports.includes(type)) return null;
        const name = (val.name || key || "imported").trim();
        if (!name) return null;
        const config: McpServerConfig = {
            id: generateId(),
            name: name,
            type: type,
            enabled: typeof val.enabled === "boolean" ? val.enabled : true,
        };
        if (type === "stdio") {
            if (typeof val.command === "string") {
                config.command = val.command;
            }
            if (Array.isArray(val.args)) {
                config.args = val.args.map((a: any) => String(a));
            }
            if (typeof val.cwd === "string") {
                config.cwd = val.cwd;
            }
            if (val.env && typeof val.env === "object") {
                config.env = {};
                for (const [ek, ev] of Object.entries(val.env)) {
                    config.env[ek] = String(ev);
                }
            }
        } else if (type === "webrtc") {
            if (typeof val.signalingUrl === "string") {
                config.signalingUrl = val.signalingUrl;
            }
            if (typeof val.channelLabel === "string") {
                config.channelLabel = val.channelLabel;
            }
            if (Array.isArray(val.iceServers)) {
                config.iceServers = val.iceServers.map((ice: any) => {
                    const item: IceServer = { urls: String(ice.urls || "") };
                    if (ice.username) item.username = String(ice.username);
                    if (ice.credential) item.credential = String(ice.credential);
                    return item;
                });
            }
        } else {
            if (typeof val.url === "string") {
                config.url = val.url;
            }
            if (val.headers && typeof val.headers === "object") {
                config.headers = {};
                for (const [hk, hv] of Object.entries(val.headers)) {
                    config.headers[hk] = String(hv);
                }
            }
        }
        if (typeof val.timeout === "number") {
            config.timeout = val.timeout;
        }
        return config;
    };
    let parsedAsDict = false;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, val] of Object.entries(parsed)) {
            if (val && typeof val === "object" && "type" in (val as any)) {
                const config = sanitizeConfig(key, val);
                if (config) {
                    results.push(config);
                    parsedAsDict = true;
                }
            }
        }
    }
    if (!parsedAsDict && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if ("type" in parsed) {
            const config = sanitizeConfig(parsed.name || "imported-server", parsed);
            if (config) {
                results.push(config);
            }
        }
    }
    return results;
}

function KVEditor({
    label,
    value,
    onChange,
}: {
    label: string;
    value: Record<string, string>;
    onChange: (v: Record<string, string>) => void;
}) {
    const entries = Object.entries(value);
    const [newKey, setNewKey] = useState("");
    const [newVal, setNewVal] = useState("");
    const addEntry = () => {
        if (!newKey.trim()) return;
        onChange({ ...value, [newKey.trim()]: newVal });
        setNewKey(""); setNewVal("");
    };
    const remove = (k: string) => {
        const next = { ...value };
        delete next[k];
        onChange(next);
    };
    const updateVal = (k: string, v: string) => onChange({ ...value, [k]: v });
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">{label}</span>
            {entries.map(([k, v]) => (
                <div key={k} className="flex gap-1.5 items-center">
                    <input
                        readOnly
                        value={k}
                        className="w-[38%] px-2 py-1 rounded-md text-[11px] font-mono bg-accent/10 border border-[hsl(var(--chat-border))] text-muted-foreground focus:outline-none"
                    />
                    <input
                        value={v}
                        onChange={e => updateVal(k, e.target.value)}
                        placeholder="value"
                        className="flex-1 px-2 py-1 rounded-md text-[11px] font-mono bg-background border border-[hsl(var(--chat-border))] focus:outline-none focus:ring-1 focus:ring-accent/50"
                    />
                    <button type="button" onClick={() => remove(k)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            ))}
            <div className="flex gap-1.5 items-center">
                <input
                    value={newKey}
                    onChange={e => setNewKey(e.target.value)}
                    placeholder="KEY"
                    onKeyDown={e => e.key === "Enter" && addEntry()}
                    className="w-[38%] px-2 py-1 rounded-md text-[11px] font-mono bg-background border border-dashed border-[hsl(var(--chat-border))] focus:outline-none focus:ring-1 focus:ring-accent/50 placeholder:text-muted-foreground/40"
                />
                <input
                    value={newVal}
                    onChange={e => setNewVal(e.target.value)}
                    placeholder="value"
                    onKeyDown={e => e.key === "Enter" && addEntry()}
                    className="flex-1 px-2 py-1 rounded-md text-[11px] font-mono bg-background border border-dashed border-[hsl(var(--chat-border))] focus:outline-none focus:ring-1 focus:ring-accent/50 placeholder:text-muted-foreground/40"
                />
                <button type="button" onClick={addEntry} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                    <Plus className="w-3 h-3" />
                </button>
            </div>
        </div>
    );
}

function IceServersEditor({
    value,
    onChange,
}: {
    value: IceServer[];
    onChange: (v: IceServer[]) => void;
}) {
    const [draftUrls, setDraftUrls] = useState("");
    const [draftUser, setDraftUser] = useState("");
    const [draftCred, setDraftCred] = useState("");
    const add = () => {
        if (!draftUrls.trim()) return;
        onChange([...value, { urls: draftUrls.trim(), username: draftUser || undefined, credential: draftCred || undefined }]);
        setDraftUrls(""); setDraftUser(""); setDraftCred("");
    };
    const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
    const update = (i: number, patch: Partial<IceServer>) => {
        const next = [...value];
        next[i] = { ...next[i], ...patch };
        onChange(next);
    };
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">ICE servers</span>
            {value.map((ice, i) => (
                <div key={i} className="flex flex-col gap-1 p-2 rounded-md border border-[hsl(var(--chat-border))] bg-accent/5">
                    <div className="flex gap-1.5 items-center">
                        <span className="text-[10px] font-mono text-muted-foreground/40 w-5 text-right shrink-0">{i}</span>
                        <input
                            value={ice.urls}
                            onChange={e => update(i, { urls: e.target.value })}
                            placeholder="stun:stun.l.google.com:19302"
                            className="flex-1 px-2 py-1 rounded-md text-[11px] font-mono bg-background border border-[hsl(var(--chat-border))] focus:outline-none focus:ring-1 focus:ring-accent/50"
                        />
                        <button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                    <div className="flex gap-1.5 pl-7">
                        <input
                            value={ice.username ?? ""}
                            onChange={e => update(i, { username: e.target.value || undefined })}
                            placeholder="username (optional)"
                            className="flex-1 px-2 py-1 rounded-md text-[11px] font-mono bg-background border border-[hsl(var(--chat-border))] focus:outline-none focus:ring-1 focus:ring-accent/50"
                        />
                        <input
                            value={ice.credential ?? ""}
                            onChange={e => update(i, { credential: e.target.value || undefined })}
                            placeholder="credential (optional)"
                            className="flex-1 px-2 py-1 rounded-md text-[11px] font-mono bg-background border border-[hsl(var(--chat-border))] focus:outline-none focus:ring-1 focus:ring-accent/50"
                        />
                    </div>
                </div>
            ))}
            {/* Add row */}
            <div className="flex flex-col gap-1 p-2 rounded-md border border-dashed border-[hsl(var(--chat-border))]">
                <div className="flex gap-1.5 items-center">
                    <span className="text-[10px] font-mono text-muted-foreground/40 w-5 text-right shrink-0">{value.length}</span>
                    <input
                        value={draftUrls}
                        onChange={e => setDraftUrls(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && add()}
                        placeholder="stun:… or turn:…"
                        className="flex-1 px-2 py-1 rounded-md text-[11px] font-mono bg-background border border-dashed border-[hsl(var(--chat-border))] focus:outline-none focus:ring-1 focus:ring-accent/50 placeholder:text-muted-foreground/40"
                    />
                    <button type="button" onClick={add} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                        <Plus className="w-3 h-3" />
                    </button>
                </div>
                <div className="flex gap-1.5 pl-7">
                    <input
                        value={draftUser}
                        onChange={e => setDraftUser(e.target.value)}
                        placeholder="username (optional)"
                        className="flex-1 px-2 py-1 rounded-md text-[11px] font-mono bg-background border border-dashed border-[hsl(var(--chat-border))] focus:outline-none focus:ring-1 focus:ring-accent/50 placeholder:text-muted-foreground/40"
                    />
                    <input
                        value={draftCred}
                        onChange={e => setDraftCred(e.target.value)}
                        placeholder="credential (optional)"
                        className="flex-1 px-2 py-1 rounded-md text-[11px] font-mono bg-background border border-dashed border-[hsl(var(--chat-border))] focus:outline-none focus:ring-1 focus:ring-accent/50 placeholder:text-muted-foreground/40"
                    />
                </div>
            </div>
        </div>
    );
}

function ArgsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
    const [draft, setDraft] = useState("");
    const add = () => {
        if (!draft.trim()) return;
        onChange([...value, draft.trim()]);
        setDraft("");
    };
    const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
    const update = (i: number, v: string) => {
        const next = [...value];
        next[i] = v;
        onChange(next);
    };
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">args</span>
            {value.map((arg, i) => (
                <div key={i} className="flex gap-1.5 items-center">
                    <span className="text-[10px] font-mono text-muted-foreground/40 w-5 text-right shrink-0">{i}</span>
                    <input
                        value={arg}
                        onChange={e => update(i, e.target.value)}
                        className="flex-1 px-2 py-1 rounded-md text-[11px] font-mono bg-background border border-[hsl(var(--chat-border))] focus:outline-none focus:ring-1 focus:ring-accent/50"
                    />
                    <button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            ))}
            <div className="flex gap-1.5 items-center">
                <span className="text-[10px] font-mono text-muted-foreground/40 w-5 text-right shrink-0">{value.length}</span>
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && add()}
                    placeholder="add argument…"
                    className="flex-1 px-2 py-1 rounded-md text-[11px] font-mono bg-background border border-dashed border-[hsl(var(--chat-border))] focus:outline-none focus:ring-1 focus:ring-accent/50 placeholder:text-muted-foreground/40"
                />
                <button type="button" onClick={add} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                    <Plus className="w-3 h-3" />
                </button>
            </div>
        </div>
    );
}
 

function Field({
    label, value, onChange, placeholder, mono = true,
}: {
    label: string; value: string; onChange: (v: string) => void;
    placeholder?: string; mono?: boolean;
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">{label}</span>
            <input
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                className={clsx(
                    "w-full px-2 py-1.5 rounded-md text-[11px] bg-background",
                    "border border-[hsl(var(--chat-border))] focus:outline-none focus:ring-1 focus:ring-accent/50",
                    mono && "font-mono"
                )}
            />
        </div>
    );
}

function WebRtcFields({
    draft,
    upd,
}: {
    draft: McpServerConfig;
    upd: (patch: Partial<McpServerConfig>) => void;
}) {
    return (
        <>
            <Field
                label="WebSocket Signaling URL"
                value={draft.signalingUrl ?? ""}
                onChange={v => upd({ signalingUrl: v })}
                placeholder="wss://server.com/"
            />
            <Field
                label="data channel label"
                value={draft.channelLabel ?? ""}
                onChange={v => upd({ channelLabel: v || undefined })}
                placeholder="mcp"
            />
            <IceServersEditor
                value={draft.iceServers ?? []}
                onChange={v => upd({ iceServers: v })}
            />
        </>
    );
}

function EditPanel({
    server,
    onSave,
    onCancel,
}: {
    server: McpServerConfig;
    onSave: (s: McpServerConfig) => void;
    onCancel: () => void;
}) {
    const [draft, setDraft] = useState<McpServerConfig>({ ...server });
    const upd = (patch: Partial<McpServerConfig>) => setDraft(d => ({ ...d, ...patch }));
    const isRemote = draft.type !== "stdio";
    const isWebRtc = draft.type === "webrtc";
    return (
        <div className="flex flex-col gap-3 px-4 py-3 bg-accent/5 border-t border-[hsl(var(--chat-border))]">
            {/* Name + Transport row */}
            <div className="grid grid-cols-2 gap-2">
                <Field label="name" value={draft.name} onChange={v => upd({ name: v })} placeholder="my-server" />
                {/* Transport selector */}
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">transport</span>
                    <div className="grid grid-cols-5 gap-1">
                        {(Object.keys(TRANSPORT_META) as McpTransport[]).map(t => {
                            const m = TRANSPORT_META[t];
                            return (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => upd({ type: t })}
                                    className={clsx(
                                        "flex items-center justify-center gap-1 py-1 rounded-md text-[10px] border transition-colors",
                                        draft.type === t
                                            ? `border-accent/50 bg-accent/20 ${m.color}`
                                            : "border-[hsl(var(--chat-border))] text-muted-foreground hover:bg-accent/10"
                                    )}
                                >
                                    {m.icon} {m.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
            {/* stdio fields */}
            {!isRemote && (
                <>
                    <Field label="command" value={draft.command ?? ""} onChange={v => upd({ command: v })} placeholder="npx / uvx / python / node" />
                    <ArgsEditor value={draft.args ?? []} onChange={v => upd({ args: v })} />
                    <Field label="cwd (optional)" value={draft.cwd ?? ""} onChange={v => upd({ cwd: v || undefined })} placeholder="/path/to/working/dir" />
                    <KVEditor label="env" value={draft.env ?? {}} onChange={v => upd({ env: v })} />
                </>
            )}
            {/* remote fields (sse / http / websocket) */}
            {isRemote && !isWebRtc && (
                <>
                    <Field label="url" value={draft.url ?? ""} onChange={v => upd({ url: v })} placeholder={draft.type === "websocket" ? "ws://mcp.example.com/mcp/ws" : draft.type === "sse" ? "https://mcp.example.com/mcp/sse" : "https://mcp.example.com/mcp"} />
                    <KVEditor label="headers" value={draft.headers ?? {}} onChange={v => upd({ headers: v })} />
                </>
            )}
            {/* webrtc fields */}
            {isWebRtc && <WebRtcFields draft={draft} upd={upd} />}
            {/* Timeout + disabled */}
            <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">timeout (ms)</span>
                    <input
                        type="number"
                        value={draft.timeout ?? ""}
                        onChange={e => upd({ timeout: e.target.value ? Number(e.target.value) : undefined })}
                        placeholder="30000"
                        className="w-full px-2 py-1.5 rounded-md text-[11px] font-mono bg-background border border-[hsl(var(--chat-border))] focus:outline-none focus:ring-1 focus:ring-accent/50"
                    />
                </div>
            </div>
            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1 border-t border-[hsl(var(--chat-border))]">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-1.5 text-xs rounded-full border border-[hsl(var(--chat-border))] hover:bg-accent/10 transition-colors text-muted-foreground"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={() => onSave(draft)}
                    className="px-4 py-1.5 text-xs rounded-full border border-accent/50 bg-accent/20 hover:bg-accent/30 transition-colors flex items-center gap-1.5"
                >
                    <Check className="w-3 h-3" /> Save
                </button>
            </div>
        </div>
    );
}
 

const ServerRow = memo(({
    enabled, server, isSelected, isExpanded, onToggle, onExpand, onDelete, onToggleEnabled, mcpStatus
}: {
    server: McpServerConfig;
    enabled: boolean;
    isSelected: boolean;
    isExpanded: boolean;
    onToggle: (id: string) => void;
    onExpand: (id: string) => void;
    onDelete: (id: string) => void;
    onToggleEnabled: (id: string, enabled: boolean) => void;
    mcpStatus?: string | undefined;
}) => {
    const { pyInvoke } = usePython()
    return (
        <TableRow
            className={clsx(
                "border-accent/5 transition-colors h-12 group cursor-pointer",
                isExpanded ? "bg-accent/10 hover:bg-accent/10" : "hover:bg-accent/5"
            )}
            onClick={() => onExpand(server.id)}
        >
            {/* Checkbox */}
            <TableCell className="w-10 cursor-default" onClick={e => { e.stopPropagation(); onToggle(server.id); }}>
                <Checkbox checked={isSelected} onCheckedChange={() => onToggle(server.id)} />
            </TableCell>
            {/* Name */}
            <TableCell className="font-mono text-xs font-medium max-w-[120px] truncate">
                <span>
                    {server.name}
                </span>
            </TableCell>
            {/* Summary */}
            <TableCell className="font-mono text-[10px] text-muted-foreground max-w-[200px] truncate select-none">
                {serverSummary(server)}
            </TableCell>
            <TableCell className="w-[150px] select-none">
                <span className={clsx(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium font-mono tracking-wide border",
                    mcpStatus === "connected" && [
                        "bg-green-500/10 text-green-600 border-green-500/20",
                        "dark:bg-green-500/15 dark:text-green-400 dark:border-green-500/25"
                    ],
                    mcpStatus === "connecting" && [
                        "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
                        "dark:bg-yellow-500/15 dark:text-yellow-400 dark:border-yellow-500/25"
                    ],
                    mcpStatus === "error" && [
                        "bg-red-500/10 text-red-600 border-red-500/20",
                        "dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/25"
                    ],
                    (mcpStatus === "disconnected" || mcpStatus === "disconnecting") && [
                        "bg-muted text-muted-foreground border-border",
                    ],
                )}>
                    {/* Dot indicator */}
                    <span className={clsx(
                        "size-1.5 rounded-full shrink-0",
                        mcpStatus === "connected" && "bg-green-500",
                        mcpStatus === "connecting" && "bg-yellow-500 animate-pulse",
                        mcpStatus === "error" && "bg-red-500",
                        (mcpStatus === "disconnected" || mcpStatus === "disconnecting") && "bg-muted-foreground/50",
                    )} />
                    {mcpStatus ?? ""}
                </span>
            </TableCell>
            <TableCell className="w-[50px]">
                <div className="">
                    <Switch
                        checked={enabled}
                        onCheckedChange={(checked) => {
                            onToggleEnabled(server.id, checked);
                        }}
                        onClick={(e) => {
                            e.stopPropagation()
                        }} />
                </div>
            </TableCell>
            <TableCell className="font-mono text-[10px] w-[50px] text-muted-foreground truncate select-none">
                {!isExpanded && <div className="hover:bg-[hsl(var(--hover))] w-fit p-1.5 rounded-full cursor-pointer translate-y-[-2px]"
                    onClick={e => {
                        e.stopPropagation();
                        (async () => {
                            await pyInvoke("mcp/reload", {
                                "server_name": server.name
                            })
                        })()
                    }}
                >
                    <RotateCcw className="w-4 h-4" />
                </div>}
            </TableCell>
            {/* Expand chevron + actions */}
            <TableCell className="w-24 text-right pr-3">
                <span className="inline-flex items-center gap-2">
                    <span className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-2 transition-opacity">
                        <button
                            className="hover:text-destructive text-muted-foreground transition-colors"
                            onClick={e => { e.stopPropagation(); onDelete(server.id); }}
                            title="Delete"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </span>
                    <ChevronRight className={clsx(
                        "w-3.5 h-3.5 text-muted-foreground/40 transition-transform",
                        isExpanded && "rotate-90"
                    )} />
                </span>
            </TableCell>
        </TableRow>
    );
});

function AddServerForm({
    onAdd,
    onCancel,
}: {
    onAdd: (s: McpServerConfig) => void;
    onCancel: () => void;
}) {
    const [selected, setSelected] = useState<McpTemplate | null>(null);
    const [search, setSearch] = useState("");
    const [open, setOpen] = useState(false);
    const [focusedIdx, setFocusedIdx] = useState(-1);
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState<McpServerConfig>({ id: generateId(), name: "", type: "stdio", enabled: true });
    const filtered = MCP_TEMPLATES.filter(t =>
        t.label.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase())
    );
    const handlePick = (t: McpTemplate) => {
        setSelected(t);
        setOpen(false);
        setSearch("");
        setFocusedIdx(-1);
        setDraft(d => ({
            id: d.id,
            name: t.label.toLowerCase().replace(/\s+/g, "-"),
            ...t.preset,
        } as McpServerConfig));
    };
    const handleOpen = () => {
        setOpen(o => {
            if (!o) { setSearch(""); setFocusedIdx(-1); setTimeout(() => searchRef.current?.focus(), 10); }
            return !o;
        });
    };
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setOpen(false); }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);
    useEffect(() => {
        if (focusedIdx < 0 || !listRef.current) return;
        listRef.current.querySelectorAll<HTMLButtonElement>("[data-item]")[focusedIdx]?.scrollIntoView({ block: "nearest" });
    }, [focusedIdx]);
    const upd = (patch: Partial<McpServerConfig>) => setDraft(d => ({ ...d, ...patch }));
    const isRemote = draft.type !== "stdio";
    const isWebRtc = draft.type === "webrtc";
    const isValid = draft.name.trim() && (
        isWebRtc
            ? !!draft.signalingUrl?.trim()
            : isRemote
                ? !!draft.url?.trim()
                : !!draft.command?.trim()
    );
    return (
        <div className="flex flex-col gap-3 p-4 border border-[hsl(var(--chat-border))] rounded-xl bg-accent/5 mx-auto w-[97.5%]">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add MCP Server</p>
            {/* Template picker */}
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
                    <span className={selected ? "text-foreground" : "text-muted-foreground"}>
                        {selected ? selected.label : "Start from template…"}
                    </span>
                    <ChevronDown className={clsx("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-180")} />
                </button>
                {open && (
                    <div className="absolute z-50 w-full rounded-b-lg border border-t-0 border-[hsl(var(--chat-border))] bg-background shadow-lg">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--chat-border))]">
                            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <input
                                ref={searchRef}
                                type="text"
                                value={search}
                                onChange={e => { setSearch(e.target.value); setFocusedIdx(-1); }}
                                onKeyDown={e => {
                                    if (e.key === "ArrowDown") { e.preventDefault(); setFocusedIdx(i => Math.min(i + 1, filtered.length - 1)); }
                                    else if (e.key === "ArrowUp") { e.preventDefault(); setFocusedIdx(i => Math.max(i - 1, 0)); }
                                    else if (e.key === "Enter" && focusedIdx >= 0) { e.preventDefault(); handlePick(filtered[focusedIdx]); }
                                    else if (e.key === "Escape") setOpen(false);
                                }}
                                placeholder="Search templates…"
                                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                            />
                            {search && (
                                <button type="button" onClick={() => { setSearch(""); searchRef.current?.focus(); }} className="text-muted-foreground hover:text-foreground">
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                        <div ref={listRef} className="max-h-52 overflow-y-auto">
                            {filtered.length === 0 ? (
                                <div className="px-3 py-4 text-xs text-muted-foreground text-center">No templates found</div>
                            ) : filtered.map((t, i) => {
                                const meta = TRANSPORT_META[t.preset.type as McpTransport ?? "stdio"];
                                return (
                                    <button
                                        key={t.label}
                                        data-item
                                        type="button"
                                        onClick={() => handlePick(t)}
                                        onMouseEnter={() => setFocusedIdx(i)}
                                        className={clsx(
                                            "w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2",
                                            (selected?.label === t.label || i === focusedIdx) && "bg-accent/20",
                                            selected?.label === t.label && "font-medium"
                                        )}
                                    >
                                        <span className="flex flex-col gap-0.5">
                                            <span>{t.label}</span>
                                            <span className="text-[10px] text-muted-foreground/60">{t.description}</span>
                                        </span>
                                        <span className={clsx("inline-flex items-center gap-1 text-[10px] font-mono shrink-0", meta.color)}>
                                            {meta.icon} {meta.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
            {/* Name + Transport */}
            <div className="grid grid-cols-2 gap-2">
                <Field label="name" value={draft.name} onChange={v => upd({ name: v })} placeholder="my-mcp-server" />
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">transport</span>
                    <div className="grid grid-cols-5 gap-1">
                        {(Object.keys(TRANSPORT_META) as McpTransport[]).map(t => {
                            const m = TRANSPORT_META[t];
                            return (
                                <button key={t} type="button" onClick={() => upd({ type: t })}
                                    className={clsx(
                                        "flex items-center justify-center gap-1 py-1 rounded-md text-[10px] border transition-colors",
                                        draft.type === t
                                            ? `border-accent/50 bg-accent/20 ${m.color}`
                                            : "border-[hsl(var(--chat-border))] text-muted-foreground hover:bg-accent/10"
                                    )}>
                                    {m.icon} {m.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
            {/* stdio */}
            {!isRemote && (
                <>
                    <Field label="command" value={draft.command ?? ""} onChange={v => upd({ command: v })} placeholder="npx / uvx / python / node" />
                    <ArgsEditor value={draft.args ?? []} onChange={v => upd({ args: v })} />
                    <Field label="cwd (optional)" value={draft.cwd ?? ""} onChange={v => upd({ cwd: v || undefined })} placeholder="/working/directory" />
                    <KVEditor label="env" value={draft.env ?? {}} onChange={v => upd({ env: v })} />
                </>
            )}
            {/* remote (sse / http / websocket) */}
            {isRemote && !isWebRtc && (
                <>
                    <Field label="url" value={draft.url ?? ""} onChange={v => upd({ url: v })} placeholder={draft.type === "websocket" ? "ws://mcp.example.com/mcp/ws" : draft.type === "sse" ? "https://mcp.example.com/mcp/sse" : "https://mcp.example.com/mcp"} />
                    <KVEditor label="headers" value={draft.headers ?? {}} onChange={v => upd({ headers: v })} />
                </>
            )}
            {/* webrtc */}
            {isWebRtc && <WebRtcFields draft={draft} upd={upd} />}
            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={onCancel}
                    className="px-4 py-1.5 text-sm rounded-full border border-[hsl(var(--chat-border))] hover:bg-accent/10 transition-colors disabled:opacity-50">
                    Cancel
                </button>
                <button type="button" onClick={() => {
                    if (isValid) {
                        onAdd(draft)
                    }
                }} disabled={!isValid}
                    className={clsx(
                        "px-4 py-1.5 text-sm rounded-full border transition-colors flex items-center gap-1.5",
                        isValid
                            ? "border-accent bg-accent/20 hover:bg-accent/30 text-foreground"
                            : "border-[hsl(var(--chat-border))] opacity-40 cursor-not-allowed"
                    )}>
                    <Plus className="w-3.5 h-3.5" /> Add Server
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
            {type === "success" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {message}
        </div>
    );
}
 

export default function McpServers({ isOpen, mcpStatuses }: { isOpen: boolean, mcpStatuses: Record<string, "connected" | "disconnected" | "disconnecting" | "connecting" | "error"> }) {
    const { settings, updateSetting, loading } = useSettings();
    const { pyInvoke } = usePython();
    const [servers, setServers] = useState<McpServerConfig[]>([]);
    const [adding, setAdding] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
    // Guard so we only parse settings into local state ONCE per panel open.
    // Without this, every optimistic write from saveServersToBackend triggers
    // the useEffect again, overwriting in-progress local edits.
    const initializedRef = useRef(false);
    const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 2500);
    }, []);
    //  Load from settings 
    // Runs when the panel opens. The initializedRef gate prevents re-runs from
    // the optimistic settings updates written by saveServersToBackend.
    useEffect(() => {
        if (!isOpen) {
            // Reset so the next open always gets a fresh read.
            initializedRef.current = false;
            return;
        }
        // Wait until the settings hook has finished its initial fetch.
        if (loading || initializedRef.current) return;
        const raw = settings["Others/app_settings/mcp.servers"]?.value;
        const parsed: McpServerConfig[] = [];
        for (const [name, config] of Object.entries((raw as Record<string, any>) ?? {})) {
            parsed.push({
                id: name,
                name,
                type: "stdio" as McpTransport,
                ...(config as object),
            } as McpServerConfig);
        }
        setServers(parsed);
        initializedRef.current = true;
    }, [isOpen, loading, settings]);
    //  Persist 
    // Build the on-disk dict (keyed by server name, no React `id` field) and
    // push to the backend. Called OUTSIDE setState callbacks to avoid the
    // React anti-pattern of triggering side-effects from inside a state updater.
    const saveServersToBackend = useCallback(async (nextServers: McpServerConfig[]) => {
        const payload: Record<string, any> = {};
        for (const s of nextServers) {
            const { id: _id, name, ...rest } = s;
            payload[name] = rest;
        }
        const ok = await updateSetting("Others/app_settings/mcp.servers", payload);
        if (!ok) showToast("Failed to save  check backend logs", "error");
    }, [updateSetting, showToast]);
    //  CRUD 
    const handleAdd = useCallback((s: McpServerConfig) => {
        const next = [...servers, { ...s, enabled: true }];
        setServers(next);
        saveServersToBackend(next);
        setAdding(false);
        setExpandedId(null);
        showToast(`Added "${s.name}"`);
    }, [servers, saveServersToBackend, showToast]);
    const handleUpdate = useCallback((updated: McpServerConfig) => {
        const next = servers.map(s => s.id === updated.id ? updated : s);
        setServers(next);
        saveServersToBackend(next);
        setExpandedId(null);
        showToast(`Saved "${updated.name}"`);
    }, [servers, saveServersToBackend, showToast]);
    const handleToggleEnabled = useCallback((id: string, enabled: boolean) => {
        const next = servers.map(s => s.id === id ? { ...s, enabled } : s);
        setServers(next);
        saveServersToBackend(next);
    }, [servers, saveServersToBackend]);
    const handleDelete = useCallback((id: string) => {
        const target = servers.find(x => x.id === id);
        const next = servers.filter(x => x.id !== id);
        setServers(next);
        saveServersToBackend(next);
        setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        setExpandedId(p => p === id ? null : p);
        if (target) showToast(`Deleted "${target.name}"`);
    }, [servers, saveServersToBackend, showToast]);
    const handleDeleteSelected = useCallback(() => {
        const ids = Array.from(selectedIds);
        const next = servers.filter(s => !ids.includes(s.id));
        setServers(next);
        saveServersToBackend(next);
        setSelectedIds(new Set());
        showToast(`Deleted ${ids.length} server(s)`);
    }, [servers, selectedIds, saveServersToBackend, showToast]);
    const handleCopySelected = useCallback(() => {
        const selected = servers.filter(s => selectedIds.has(s.id));
        if (selected.length === 0) return;
        const payload: Record<string, any> = {};
        for (const s of selected) {
            const { id: _id, name, ...rest } = s;
            payload[name] = rest;
        }
        navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
        showToast(`Copied ${selected.length} server(s)`);
    }, [servers, selectedIds, showToast]);
    const handleReloadSelected = useCallback(async () => {
        const selected = servers.filter(s => selectedIds.has(s.id));
        if (selected.length === 0) return;
        try {
            await Promise.all(
                selected.map(s =>
                    pyInvoke("mcp/reload", { "server_name": s.name })
                )
            );
            showToast(`Reloaded ${selected.length} server(s)`);
        } catch (err: any) {
            showToast("Failed to reload some servers", "error");
        }
    }, [servers, selectedIds, pyInvoke, showToast]);
    const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const text = event.target?.result;
                if (typeof text !== "string") return;
                let parsed: any;
                try {
                    parsed = JSON.parse(text.trim());
                } catch (firstErr) {
                    try {
                        parsed = JSON.parse(`{ ${text.trim()} }`);
                    } catch (secErr) {
                        throw firstErr;
                    }
                }
                const imported = parseImportedJson(parsed);
                if (imported.length === 0) {
                    alert("No valid MCP server configurations found in the JSON.");
                    return;
                }
                setServers(prev => {
                    const next = [...prev];
                    for (const imp of imported) {
                        const idx = next.findIndex(s => s.name === imp.name);
                        if (idx >= 0) {
                            next[idx] = imp;
                        } else {
                            next.push(imp);
                        }
                    }
                    saveServersToBackend(next);
                    return next;
                });
                showToast(`Successfully imported ${imported.length} server(s)`);
            } catch (err: any) {
                alert("Invalid JSON: " + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = "";
    };
    //  Selection 
    const toggleSelect = useCallback((id: string) => {
        setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    }, []);
    const toggleSelectAll = useCallback(() => {
        setSelectedIds(prev =>
            prev.size === servers.length && servers.length > 0 ? new Set() : new Set(servers.map(s => s.id))
        );
    }, [servers]);
    const allSelected = servers.length > 0 && selectedIds.size === servers.length;
    const isEmpty = servers.length === 0;
    return (
        <div className="flex flex-col gap-2 h-full pt-10">
            {/* Header */}
            <div className="flex justify-center items-center w-[97.5%] mx-auto px-2">
                <div className="w-6">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                </div>
                <div className="flex-1" />
                <button
                    type="button"
                    onClick={() => document.getElementById("import-mcp-file")?.click()}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border border-[hsl(var(--chat-border))] hover:bg-accent/10 text-muted-foreground hover:text-foreground transition-colors mr-2 animate-in fade-in"
                >
                    <Upload className="w-3.5 h-3.5" /> Import JSON
                </button>
                <input
                    type="file"
                    id="import-mcp-file"
                    accept=".json"
                    className="hidden"
                    onChange={handleImportJSON}
                />
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
                    <Plus className="w-3.5 h-3.5" /> Add
                </button>
            </div>
            {/* Add form */}
            {adding && (
                <AddServerForm onAdd={handleAdd} onCancel={() => setAdding(false)} />
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
                                            : <>
                                                <Server className="w-6 h-6 opacity-20" />
                                                <span className="opacity-50">No MCP servers configured</span>
                                            </>}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            servers.map(server => (
                                <Fragment key={server.id}>
                                    <ServerRow
                                        enabled={server.enabled}
                                        server={server}
                                        isSelected={selectedIds.has(server.id)}
                                        isExpanded={expandedId === server.id}
                                        onToggle={toggleSelect}
                                        onExpand={id => setExpandedId(prev => prev === id ? null : id)}
                                        onDelete={handleDelete}
                                        onToggleEnabled={handleToggleEnabled}
                                        mcpStatus={mcpStatuses[server.name]}
                                    />
                                    {expandedId === server.id && (
                                        <TableRow key={`${server.id}-edit`} className="hover:bg-transparent">
                                            <TableCell colSpan={7} className="p-0">
                                                <EditPanel
                                                    server={server}
                                                    onSave={handleUpdate}
                                                    onCancel={() => setExpandedId(null)}
                                                />
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </Fragment>
                            ))
                        )}
                    </TableBody>
                </Table>
                {loading && servers.length > 0 && (
                    <div className="flex justify-center items-center gap-2 py-3 text-xs text-muted-foreground">
                        <Spinner /><span>Refreshing…</span>
                    </div>
                )}
            </ScrollArea>
            {/* Bulk bar */}
            <div className={clsx(
                selectedIds.size > 0 ? "flex justify-center items-center" : "hidden",
                "pt-2 relative transform translate-y-[-6px] px-4 animate-in slide-in-from-bottom-2 duration-200"
            )}>
                <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
                <div className="flex-1 flex justify-end gap-2">
                    <div className="pr-2">
                        <button
                            onClick={handleReloadSelected}
                            className="p-2 bg-accent text-accent-foreground border border-[hsl(var(--chat-border))] rounded-full w-20 text-sm hover:bg-accent/75 transition-colors flex items-center justify-center gap-1"
                        >
                            <RotateCcw className="w-3.5 h-3.5" /> Reload
                        </button>
                    </div>
                    <button
                        onClick={handleCopySelected}
                        className="p-2 border border-[hsl(var(--chat-border))] rounded-full w-20 text-sm hover:bg-accent/10 transition-colors flex items-center justify-center gap-1"
                    >
                        <Copy className="w-3.5 h-3.5" /> Copy
                    </button>
                    <button
                        onClick={handleDeleteSelected}
                        className="p-2 border border-[hsl(var(--chat-border))] rounded-full w-20 text-sm hover:border-destructive/50 hover:text-destructive transition-colors flex items-center justify-center gap-1"
                    >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
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