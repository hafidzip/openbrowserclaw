import { useState, useEffect, useCallback, memo } from "react";
import { FolderOpen, Trash2, Package, HardDrive, RefreshCw, AlertCircle, Wrench, Plus, Link2, Search } from "lucide-react";
import { usePython } from "./usePython";
import { Spinner } from "./ui/spinner";
import clsx from "clsx";
import { openPath } from "@tauri-apps/plugin-opener";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { addTab } from "openchad-react/utils/state";
import { uuidv4 } from "openchad-react/utils";
import { useGlobal } from "./useGlobal";

interface ToolEntry {
  name: string;
  description: string;
  source: "local" | "venv";
  pkg_name: string | null;
  folder_path: string | null;
  allowed_callers: string[];
  fields: Array<Record<string, any>>;
}

const SourceBadge = memo(({ source }: { source: "local" | "venv" }) => (
  <span
    className={clsx(
      "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full",
      source === "venv"
        ? "bg-purple-500/15 text-purple-400 ring-1 ring-purple-500/30"
        : "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
    )}
  >
    {source === "venv" ? <Package className="w-2.5 h-2.5" /> : <HardDrive className="w-2.5 h-2.5" />}
    {source === "venv" ? "PyPi" : "local"}
  </span>
));

const CallerBadge = memo(({ caller }: { caller: string }) => (
  <span className="inline-flex items-center text-[9px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent/70 ring-1 ring-accent/15">
    {caller}
  </span>
));

const ToolRow = memo(({
  tool,
  onReveal,
  onDelete,
  onUpgrade,
  isDeleting,
  isUpgrading,
  isConfirming,
  onConfirm,
  onCancel,
  onCloseDialog,
}: {
  tool: ToolEntry;
  onReveal: (path: string) => void;
  onDelete: (tool: ToolEntry) => void;
  onUpgrade: (tool: ToolEntry) => void;
  isDeleting: boolean;
  isUpgrading: boolean;
  isConfirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onCloseDialog: () => void;
}) => {
  if (isConfirming) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        className="flex items-center justify-between gap-4 rounded-xl border border-destructive/20 dark:border-red-400/40 bg-destructive/5 dark:bg-red-400/5 px-4 py-3.5 h-[110px]"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
            <AlertCircle className="h-4 w-4 text-destructive dark:text-red-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">Uninstall {tool.name}?</p>
            <p className="text-[10px] text-muted-foreground truncate">
              Runs <code className="font-mono bg-destructive/10 dark:bg-red-400/10 px-1 py-0.5 rounded text-destructive dark:text-red-400">uv remove {tool.pkg_name}</code>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onCancel}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium bg-[hsl(var(--hover))] hover:bg-[hsl(var(--hoverfloat))] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium bg-destructive text-white hover:bg-destructive/90 transition-colors"
          >
            Uninstall
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={clsx(
        "group relative flex items-start gap-4 rounded-xl border px-4 py-3.5 transition-all h-[110px]",
        "border-[hsl(var(--chat-border))] bg-[hsl(var(--float))]/40",
        "hover:border-accent/20 hover:bg-[hsl(var(--float))]",
        (isDeleting || isUpgrading) && "opacity-50 pointer-events-none"
      )}
    >
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 ring-1 ring-accent/15">
        <Wrench className="h-4 w-4 text-accent" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-foreground truncate">{tool.name}</span>
          <SourceBadge source={tool.source} />
          {tool.source === "venv" && tool.pkg_name && (
            <span className="text-[10px] text-muted-foreground font-mono truncate">
              {tool.pkg_name}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {tool.description || "No description provided."}
        </p>
        {tool.allowed_callers.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {tool.allowed_callers.map((c) => (
              <CallerBadge key={c} caller={c} />
            ))}
          </div>
        )}
      </div>

      <div className={clsx(
        "flex items-center gap-2 shrink-0 self-center transition-opacity",
        (isDeleting || isUpgrading) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )}>
        {isDeleting || isUpgrading ? (
          <Spinner />
        ) : tool.source === "local" && tool.folder_path ? (
          <button
            onClick={() => onReveal(tool.folder_path!)}
            title="Reveal in folder"
            className={clsx(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
              "bg-accent/10 text-accent hover:bg-accent/20 ring-1 ring-accent/20"
            )}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open Folder
          </button>
        ) : tool.source === "venv" && tool.pkg_name ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                addTab({
                  childrenProps: {
                    [uuidv4()]: {
                      icon: "Compass",
                      title: null,
                      appname: "main-app",
                      data: { url: `https://pypi.org/project/${tool.pkg_name}/` }
                    }
                  }
                });
                onCloseDialog()
              }}
              title="Open PyPI Page"
              className={clsx(
                "flex items-center justify-center rounded-lg p-2 transition-all",
                "bg-accent/10 text-accent hover:bg-accent/20 ring-1 ring-accent/20"
              )}
            >
              <Link2 className="h-3 w-3" />
            </button>
            <button
              onClick={() => onUpgrade(tool)}
              title="Update Package"
              className={clsx(
                "flex items-center justify-center rounded-lg p-2 transition-all",
                "bg-accent/10 text-accent hover:bg-accent/20 ring-1 ring-accent/20"
              )}
            >
              <RefreshCw className="h-3 w-3" />
            </button>
            <button
              onClick={() => onDelete(tool)}
              title="Uninstall via uv"
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                "bg-destructive/10 text-destructive dark:text-red-400 dark:bg-red-500/10 hover:bg-destructive/20 dark:hover:bg-red-500/20 ring-1 ring-destructive/20 dark:ring-red-400/30"
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Uninstall
            </button>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
});

export default function Tools({ isOpen }: { isOpen: boolean }) {
  const { pyInvoke } = usePython();
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingTool, setDeletingTool] = useState<ToolEntry | null>(null);
  const [confirmTool, setConfirmTool] = useState<ToolEntry | null>(null);
  const [upgradingTool, setUpgradingTool] = useState<ToolEntry | null>(null);
  const [search, setSearch] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [installPkg, setInstallPkg] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const fetchTools = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pyInvoke<{ tools: ToolEntry[] }>("tools/list_extended") as { tools: ToolEntry[] };
      setTools(res?.tools ?? []);
    } catch {
      toast.error("Failed to load tools");
    } finally {
      setLoading(false);
    }
  }, [pyInvoke]);

  const handleUpgrade = useCallback(async (tool: ToolEntry) => {
    if (!tool.pkg_name) return;
    setUpgradingTool(tool);
    try {
      const res = await pyInvoke<{ success: boolean; error?: string }>("tools/upgrade", {
        pkg_name: tool.pkg_name,
        tool: tool.name,
      }) as { success: boolean; error?: string };
      if (res?.success) {
        toast.success(`Successfully updated ${tool.pkg_name}`);
        await fetchTools();
      } else {
        toast.error(res?.error ?? "Upgrade failed");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Upgrade failed");
    } finally {
      setUpgradingTool(null);
    }
  }, [pyInvoke, fetchTools]);

  const resetInstallForm = useCallback(() => {
    setIsAdding(false);
    setInstallPkg("");
    setInstallError(null);
  }, []);

  const handleInstall = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const pkg = installPkg.trim();
    if (!pkg) return;
    setInstalling(true);
    setInstallError(null);
    try {
      const res = await pyInvoke<{ success: boolean; error?: string; tools?: ToolEntry[] }>("tools/install", {
        pkg_name: pkg,
      }) as { success: boolean; error?: string; tools?: ToolEntry[] };
      if (res?.success) {
        toast.success(`Installed ${pkg}`);
        resetInstallForm();
        // Prepend newly loaded tools and refresh full list
        if (res.tools && res.tools.length > 0) {
          setTools((prev) => [
            ...res.tools!.filter((n) => !prev.some((p) => p.name === n.name)),
            ...prev,
          ]);
        } else {
          await fetchTools();
        }
      } else {
        setInstallError(res?.error ?? "Install failed");
      }
    } catch (err: any) {
      setInstallError(err?.message ?? "Install failed");
    } finally {
      setInstalling(false);
    }
  }, [installPkg, pyInvoke, fetchTools, resetInstallForm]);

  const handleInstallKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') resetInstallForm();
  }, [resetInstallForm]);

  useEffect(() => {
    if (isOpen) fetchTools();
  }, [isOpen, fetchTools]);

  const handleReveal = useCallback(async (path: string) => {
    try {
      await openPath(path);
    } catch {
      toast.error("Could not reveal folder");
    }
  }, []);

  const handleDelete = useCallback((tool: ToolEntry) => {
    setConfirmTool(tool);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmTool) return;
    const target = confirmTool;
    setConfirmTool(null);
    setDeletingTool(target);
    try {
      const res = await pyInvoke<{ success: boolean; error?: string }>("tools/uninstall", {
        pkg_name: target.pkg_name,
        tool: target.name,
      }) as { success: boolean; error?: string };
      if (res?.success) {
        toast.success(`Uninstalled ${target.pkg_name}`);
        setTools((prev) => prev.filter((t) => t.name !== target.name));
      } else {
        toast.error(res?.error ?? "Uninstall failed");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Uninstall failed");
    } finally {
      setDeletingTool(null);
    }
  }, [confirmTool, pyInvoke]);

  const filtered = search.trim()
    ? tools.filter(
      (t) =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.description?.toLowerCase().includes(search.toLowerCase()) ||
        t.pkg_name?.toLowerCase().includes(search.toLowerCase())
    )
    : tools;

  const localTools = filtered.filter((t) => t.source === "local");
  const venvTools = filtered.filter((t) => t.source === "venv");
  const [showToolsDialog, setShowToolsDialog] = useGlobal('showToolsDialog', { initialValue: false });
  return (
    <>
      {/* Search */}
      <div className="w-[97.5%] mx-auto px-2 pt-10">
        <div className="relative flex items-center border border-[hsl(var(--chat-border))] rounded-lg bg-[hsl(var(--float))] px-3 gap-2 focus-within:ring-1 focus-within:ring-accent/30 transition-all">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            className="flex-1 bg-transparent py-2 text-xs outline-none placeholder:text-muted-foreground"
            placeholder="Search tools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {loading && <RefreshCw className="h-3 w-3 text-muted-foreground animate-spin shrink-0" />}
        </div>
      </div>

      {/* Top bar: select-all placeholder + Install button (moved under search) */}
      <div className="flex justify-center items-center w-[97.5%] mx-auto px-2">
        <div className="flex-1" />
        {!isAdding && (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[hsl(var(--hover))] hover:bg-[hsl(var(--hoverfloat))] transition-colors"
            onClick={() => setIsAdding(true)}
          >
            Install Package <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Inline install form — mirrors Agents add form */}
      {isAdding && (
        <form onSubmit={handleInstall} className="w-[97.5%] mx-auto px-2 py-2 flex flex-col gap-2 border-t border-accent/10">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Package name</label>
            <input
              type="text"
              placeholder="PyPi Tool's Package Name (e.g. greetingtool)"
              value={installPkg}
              onChange={(e) => { setInstallPkg(e.target.value); setInstallError(null); }}
              onKeyDown={handleInstallKeyDown}
              disabled={installing}
              className={clsx(
                "w-full px-2 py-1 text-xs rounded border outline-none bg-accent/5 text-foreground placeholder:text-muted-foreground focus:border-accent/40",
                installError ? "border-destructive/50" : "border-accent/20"
              )}
              autoFocus
            />
            <AnimatePresence>
              {installError && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="flex items-start gap-1 text-[11px] text-destructive leading-snug"
                >
                  <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                  {installError}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-3 py-1 text-xs rounded border border-accent/20 bg-transparent hover:bg-accent/5 transition-colors"
              onClick={resetInstallForm}
              disabled={installing}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-accent text-accent-foreground hover:bg-accent/90 transition-colors disabled:opacity-50"
              disabled={installing || !installPkg.trim()}
            >
              {installing ? <Spinner /> : null}
              {installing ? "Installing…" : "Install"}
            </button>
          </div>
        </form>
      )}

      {/* Tool list */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 border-t border-[hsl(var(--chat-border))]">
        {loading && tools.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <Wrench className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm">{search ? "No tools match your search" : "No tools loaded"}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 pt-4">
            {venvTools.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Package className="h-3.5 w-3.5 text-accent" />
                  <span className="text-xs font-semibold text-accent uppercase tracking-wider">
                    Installed Packages ({venvTools.length})
                  </span>
                </div>
                <AnimatePresence mode="popLayout">
                  <div className="flex flex-col gap-2">
                    {venvTools.map((tool) => (
                      <ToolRow
                        key={tool.name}
                        tool={tool}
                        onReveal={handleReveal}
                        onDelete={handleDelete}
                        onUpgrade={handleUpgrade}
                        isDeleting={deletingTool?.name === tool.name}
                        isUpgrading={upgradingTool?.name === tool.name}
                        isConfirming={confirmTool?.name === tool.name}
                        onConfirm={handleConfirmDelete}
                        onCancel={() => setConfirmTool(null)}
                        onCloseDialog={() => {
                          setShowToolsDialog(false);
                        }}
                      />
                    ))}
                  </div>
                </AnimatePresence>
              </section>
            )}

            {localTools.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <HardDrive className="h-3.5 w-3.5 text-accent" />
                  <span className="text-xs font-semibold text-accent uppercase tracking-wider">
                    Local Tools ({localTools.length})
                  </span>
                </div>
                <AnimatePresence mode="popLayout">
                  <div className="flex flex-col gap-2">
                    {localTools.map((tool) => (
                      <ToolRow
                        key={tool.name}
                        tool={tool}
                        onReveal={handleReveal}
                        onDelete={handleDelete}
                        onUpgrade={handleUpgrade}
                        isDeleting={deletingTool?.name === tool.name}
                        isUpgrading={upgradingTool?.name === tool.name}
                        isConfirming={confirmTool?.name === tool.name}
                        onConfirm={handleConfirmDelete}
                        onCancel={() => setConfirmTool(null)}
                        onCloseDialog={() => {
                          setShowToolsDialog(false);
                        }}
                      />
                    ))}
                  </div>
                </AnimatePresence>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}

