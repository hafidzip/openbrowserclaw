import { ArrowLeft, ArrowRight, RefreshCw, Home, Search, Globe } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ref, useGlobal, usePython, usePythonEvent, type AppInfo } from "openchad-react"
import { getCurrentWindow, cursorPosition } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { Webview, getCurrentWebview, getAllWebviews } from '@tauri-apps/api/webview';
import { Button } from 'openchad-react/ui'
import clsx from 'clsx'
import { BrowserBar } from 'openchad-react/Bar';
import { MenuBar } from 'openchad-react/utils/state';

import { emitTo } from '@tauri-apps/api/event';
import { uuidv4 } from 'openchad-react/utils';

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;

export function CommandPalette({
  initialUrl,
  pyInvoke,
  workspace,
  onNavigate,
  onDismiss,
}: {
  initialUrl: string;
  pyInvoke: any;
  workspace: string | null;
  onNavigate: (url: string) => void;
  onDismiss: () => void;
}) {
  const isValidHttpUrl = (string: string) => {
    try {
      const url = new URL(string);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) {
      return false;
    }
  }
  const [input, setInput] = useState(initialUrl)
  const inputRef = useRef<HTMLInputElement>(null)
  const [suggestions, setSuggestions] = useState<any[]>([])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    let active = true;
    const fetchSuggestions = async () => {
      const db = workspace ?? "global";
      try {
        const searchClause = input ? "WHERE metadata LIKE ?" : "";
        const res = await pyInvoke("sqlite", {
          db,
          command: "query",
          sql: `SELECT id, metadata FROM site_registry ${searchClause} ORDER BY rowid DESC LIMIT 5`,
          params: input ? [`%${input}%`] : []
        }) as any;
        const rows = res?.data ?? (Array.isArray(res) ? res : []);
        if (!Array.isArray(rows)) return;
        const parsed = rows.map((row: any) => {
          try {
            return { id: row.id, ...JSON.parse(row.metadata) };
          } catch {
            return { id: row.id, title: "Unknown", url: row.id };
          }
        });
        if (active) {
          setSuggestions(parsed);
        }
      } catch (e) {
        console.error(e);
      }
    };
    fetchSuggestions();
    return () => {
      active = false;
    };
  }, [input, pyInvoke, workspace]);

  const handleSearchOrNavigate = (val: string) => {
    let target = val;
    // Check if it's a valid URL format
    const urlPattern = /^(https?:\/\/)?([\w\-]+\.)+[\w\-]+(\/[\w\-./?%&=]*)?$/i;
    if (urlPattern.test(target)) {
      if (!/^https?:\/\//i.test(target)) {
        target = 'https://' + target;
      }
    } else {
      // Treat as search query
      target = `https://google.com/search?q=${encodeURIComponent(target)}`;
    }
    onNavigate(target);
  };

  return (
    <div
      className="w-full h-full absolute left-0 top-0 flex items-center justify-center bg-black/50 p-4 z-50"
      onClick={onDismiss}
    >
      {/* Container matching the card structure in the image */}
      <div
        className="w-full max-w-[640px] rounded-2xl border flex flex-col p-2.5 overflow-hidden gap-1.5"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'hsl(var(--card))',
          borderColor: 'hsl(var(--border))',
          boxShadow: 'var(--kotakshadow)',
        }}
      >
        {/* Search Bar Input Area */}
        <div className="flex items-center gap-3 px-3.5 py-2.5">
          <Search
            size={18}
            style={{ color: 'var(--fgColor-muted)' }}
            className="flex-shrink-0"
          />
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent border-none outline-none text-[15px] p-0 focus:ring-0 placeholder:font-normal"
            style={{ color: 'var(--fgColor-default)' }}
            placeholder="Search or Enter URL..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && input.trim()) {
                handleSearchOrNavigate(input.trim());
              }
            }}
          />
        </div>

        {/* Suggestion List */}
        <div className="flex flex-col gap-0.5">
          {input.trim() && input !== initialUrl && (
            <div
              className="w-full flex items-center justify-between px-3.5 py-2 rounded-xl cursor-pointer transition-colors duration-150"
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'hsl(var(--hover))'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              onClick={() => handleSearchOrNavigate(input.trim())}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                  <Search size={16} style={{ color: 'var(--fgColor-muted)' }} />
                </div>
                <div className="flex items-baseline gap-2 min-w-0 text-[14px]">
                  <span style={{ color: 'var(--fgColor-default)' }} className="font-medium flex-shrink-0">
                    {isValidHttpUrl(input) ? `Open ${input}` : `Search ${input}`}
                  </span>
                </div>
              </div>
            </div>
          )}

          {suggestions.filter((item) => item.id !== initialUrl).map((item) => {
            const hasIcon = typeof item.icon === "string" && (
              item.icon.startsWith("/") ||
              item.icon.startsWith("http") ||
              item.icon.startsWith("data:") ||
              /\.(png|jpg|jpeg|ico|svg|webp)$/i.test(item.icon)
            );
            return (
              <div
                key={item.id}
                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-colors duration-150"
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'hsl(var(--hover))'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                onClick={() => {
                  if (item.url) {
                    onNavigate(item.url);
                  } else {
                    onNavigate(item.id);
                  }
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                    {hasIcon ? (
                      <img src={item.icon} className="w-4 h-4 object-contain rounded-sm" alt="" />
                    ) : (
                      <Globe size={16} style={{ color: 'var(--fgColor-muted)' }} />
                    )}
                  </div>

                  <div className="flex items-baseline gap-2 min-w-0 text-[14px]">
                    <span style={{ color: 'var(--fgColor-default)' }} className="font-medium flex-shrink-0">
                      {item.title}
                    </span>
                    {item.url && (
                      <span
                        style={{ color: 'var(--fgColor-muted)' }}
                        className="text-[13px] font-normal truncate opacity-80"
                      >
                        — {item.url}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const cleanUrl = (u: string) => u.replace(/\/$/, "");

export default function BrowserApp({ useWorkspace, setTitle, pyInvoke, useActiveTabId, useTheme, tabId, appId, useTab }: AppInfo) {

  const tabState = useTab();
  const initialUrl = tabState?.childrenProps?.[appId]?.data?.url || "about:blank";

  const [url, setUrl] = useState(initialUrl)
  const [navState, setNavState] = useState({
    history: [initialUrl],
    currentIndex: 0
  });
  const { history, currentIndex } = navState;
  const { layout } = useTheme()
  const { workspace } = useWorkspace()

  const [focus, setFocus] = useState(false)
  // Mutex ref to prevent concurrent reparent IPC calls
  const isReparenting = useRef(false)

  const [loaded, setLoaded] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const pendingNav = useRef<'back' | 'forward' | null>(null)

  const activeTabId = useActiveTabId();

  const label = `webview-${appId}`
  const containerRef = useRef<HTMLDivElement>(null)

  const getByLabel = async (label: string) => {
    try {
      const all = await getAllWebviews()
      return all.find((wv) => wv.label === label)
    } catch {
      return null

    }
  }

  const contextRef = useRef({
    closed: false,
    wvw: null as Webview | null,
    created: false,
  })

  const wantsVisible = useRef(true)

  /** Hides the child webview window so main-view overlays can render on top */
  const hideChildWebview = useCallback(async () => {
    wantsVisible.current = false
    try { const wv = await getByLabel(label); await wv?.hide() } catch { /* webview may not exist yet */ }
  }, [label])

  /** Restores the child webview window after an overlay is dismissed */
  const showChildWebview = useCallback(async () => {
    wantsVisible.current = true
    try { const wv = await getByLabel(label); await wv?.show() } catch { /* webview may not exist yet */ }
  }, [label])

  const normalizeUrl = (input: string): string => {
    const trimmed = input.trim()
    if (!trimmed) return ''

    // Already has a protocol — use as-is
    if (/^https?:\/\//i.test(trimmed)) return trimmed

    // Looks like a bare domain or domain+path (no spaces, has a dot, valid chars)
    // e.g. "github.com", "github.com/user/repo", "www.example.co.uk"
    const looksLikeDomain =
      !trimmed.includes(' ') &&
      /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+([/?#].*)?$/.test(trimmed)

    if (looksLikeDomain) return `https://${trimmed}`

    // Everything else → Google search
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
  }

  const handleNavigate = async (newUrl: string) => {
    const url = normalizeUrl(newUrl)
    if (!url) return
    // JSON.stringify escapes quotes/special chars — safer than bare template literal
    await pyInvoke('eval', { label, script: `window.location = ${JSON.stringify(url)}` })
  }

  const handleBack = async () => {
    if (currentIndex > 0) {
      pendingNav.current = 'back'
      await pyInvoke('eval', {
        label,
        script: `window.history.back()`
      })
    }
  }

  const handleForward = async () => {
    if (currentIndex < history.length - 1) {
      pendingNav.current = 'forward'
      await pyInvoke('eval', {
        label,
        script: `window.history.forward()`
      })
    }
  }

  const handleRefresh = async () => {
    await pyInvoke('eval', {
      label,
      script: `window.location.reload()`
    })
  }

  const handleHome = () => handleNavigate("https://google.com")

  const [mounted, setMount] = useState(false)

  const {
    element,
    setHandleNavigate,
    setHandleBack,
    setHandleForward,
    setHandleRefresh,
    setUrl: setBarUrl,
    setHandleAddressBarClick
  } = BrowserBar({
    canGoBack: currentIndex > 0,
    canGoForward: currentIndex < history.length - 1
  })

  useEffect(() => {
    if (url === "about:blank") {
      setShowPalette(true)
    }
  }, [url])

  useEffect(() => {
    setHandleNavigate(handleNavigate)
    setHandleBack(handleBack)
    setHandleForward(handleForward)
    setHandleRefresh(handleRefresh)
    setHandleAddressBarClick(() => {
      setShowPalette((prev) => !prev);
    });
  }, [handleNavigate, handleBack, handleForward, handleRefresh, hideChildWebview, showChildWebview])

  useEffect(() => {
    MenuBar.current = MenuBar.current = ref(<>{element}</>) as React.JSX.Element
  }, [element])

  useEffect(() => {
    setMount(true)
    return () => {
      setMount(false)
    }
  }, [])

  // ── Consolidated reparent effect ──────────────────────────────────────────
  // Determines the desired Z-order and calls reparent exactly once, guarded
  // by a mutex to prevent concurrent IPC calls that would deadlock Tauri.
  useEffect(() => {
    if (!isTauri) return
    ;(async () => {
      if (isReparenting.current) return
      isReparenting.current = true
      try {
        const win = await getCurrentWindow()
        const isThisTab = activeTabId === tabId
        const wantsChildOnTop = isThisTab && focus && !showPalette

        if (wantsChildOnTop && contextRef.current.wvw && contextRef.current.created) {
          await contextRef.current.wvw.reparent(win)
        } else {
          const mw = await getCurrentWebview()
          await mw.reparent(win)
        }
      } catch (e) {
        console.error('[Webview] reparent failed:', e)
      } finally {
        isReparenting.current = false
      }
    })()
  }, [focus, activeTabId, showPalette])


  const [showSearchDialog, setShowSearchDialog] = useGlobal('showSearchDialog', { initialValue: false });
  const [showMcpDialog, setShowMcpDialog] = useGlobal('showMcpDialog', { initialValue: false });
  const [showCredentialsDialog, setShowCredentialsDialog] = useGlobal('showCredentialsDialog', { initialValue: false });
  const [showLocalModelDialog, setShowLocalModelDialog] = useGlobal('showLocalModelDialog', { initialValue: false });
  const [showCustomEndpointDialog, setShowCustomEndpointDialog] = useGlobal('showCustomEndpointDialog', { initialValue: false });
  const [showSettingsDialog, setShowSettingsDialog] = useGlobal('showSettingsDialog', { initialValue: false });
  const [showTaskDialog, setShowTaskDialog] = useGlobal('showTaskDialog', { initialValue: false });
  const [setupModel, setSetupModel] = useGlobal('setupModel', { initialValue: false });
  const [settingsDropdown, setSettingsDropdown] = useGlobal('settingsDropdown', { initialValue: false });
  const [mobileSettingsDropdown, setMobileSettingsDropdown] = useGlobal('mobileSettingsDropdown', { initialValue: false });

  // When any overlay dialog opens, bring main webview on top (consolidates with reparent logic)
  useEffect(() => {
    if (!isTauri) return
    if (mobileSettingsDropdown || settingsDropdown || showSearchDialog || showMcpDialog || showCredentialsDialog || showLocalModelDialog || showCustomEndpointDialog || showSettingsDialog || showTaskDialog || setupModel) {
      ;(async () => {
        if (isReparenting.current) return
        isReparenting.current = true
        try {
          const mw = await getCurrentWebview()
          await mw.reparent(await getCurrentWindow())
        } catch (e) {
          console.error('[Webview] dialog reparent failed:', e)
        } finally {
          isReparenting.current = false
        }
      })()
    }
  }, [mobileSettingsDropdown, settingsDropdown, showSearchDialog, showMcpDialog, showCredentialsDialog, showLocalModelDialog, showCustomEndpointDialog, showSettingsDialog, showTaskDialog, setupModel])

  useEffect(() => {
    (async () => {
      const container = containerRef.current
      const wvw = contextRef.current.wvw
      if (!container || contextRef.current.closed || !wvw || !contextRef.current.created) return

      const rect = container.getBoundingClientRect()
      const mainWin = getCurrentWindow()

      try {
        if (rect.width === 0 && rect.height === 0) return;

        // Batch the two independent IPC calls in parallel
        const [pos, sf] = await Promise.all([
          mainWin.innerPosition(),
          mainWin.scaleFactor(),
        ])

        // Batch position + size + show in parallel — all are fire-and-resolve
        await Promise.all([
          wvw.setPosition(new LogicalPosition(rect.x, rect.y)),
          wvw.setSize(new LogicalSize(Math.round(rect.width), Math.round(rect.height))),
        ])
      } catch (e) {
        console.error("[Webview] Failed to sync size:", e)
      }
    })()
  }, [layout])


  useEffect(() => {
    if (!isTauri || !containerRef.current || !mounted) return

    contextRef.current = {
      closed: false,
      wvw: null,
      created: false,
    }
    const context = contextRef.current

    const mainWin = getCurrentWindow()

    // ── Cached IPC values ─────────────────────────────────────────────────────
    // scaleFactor never changes at runtime (barring monitor DPI switch).
    // mainWinPos is updated directly from onMoved payloads to avoid extra round-trips.
    let mainWinPos = { x: 0, y: 0 }
    let scale = 1
    // Track minimized state via a ref so syncSize never needs to call isMinimized()
    let isMinimized = false
    // ─────────────────────────────────────────────────────────────────────────

    // Helper: detect if an error means the window was destroyed
    const isWindowGone = (e: unknown): boolean => {
      const msg = String(e && typeof e === 'object' && 'message' in e ? (e as any).message : e)
      return msg.includes('window not found') || msg.includes('not found')
    }

    // Self-healing: if the window is gone, clear handles so we stop retrying
    const clearDeadWindow = () => {
      context.wvw = null
      context.created = false
    }

    // ── Core sync ─────────────────────────────────────────────────────────────
    // syncSize is the hot-path — keep IPC calls to the minimum.
    // Debounced via requestAnimationFrame to collapse multiple simultaneous
    // calls (resize, onMoved, onResized, onFocusChanged) into one per frame.
    let syncRafId: number | null = null
    let pendingKnownPos: { x: number; y: number } | undefined

    const syncSizeImpl = async (knownPos?: { x: number; y: number }) => {
      const container = containerRef.current
      const wvw = context.wvw
      if (!container || context.closed || !wvw || !context.created) return

      // Minimized is tracked via local state — no IPC needed here
      if (isMinimized) return

      const rect = container.getBoundingClientRect()

      try {
        if (rect.width === 0 && rect.height === 0) return;

        if (knownPos) {
          mainWinPos = knownPos
        } else {
          // Batch the two independent IPC calls in parallel
          const [pos, sf] = await Promise.all([
            mainWin.innerPosition(),
            mainWin.scaleFactor(),
          ])
          mainWinPos = pos
          scale = sf
        }

        // Batch position + size in parallel
        await Promise.all([
          wvw.setPosition(new LogicalPosition(rect.x, rect.y)),
          wvw.setSize(new LogicalSize(Math.round(rect.width), Math.round(rect.height))),
        ])
      } catch (e) {
        if (isWindowGone(e)) { clearDeadWindow(); return }
        console.error("[Webview] Failed to sync size:", e)
      }
    }

    // Debounced wrapper — at most one sync per animation frame
    const syncSize = (knownPos?: { x: number; y: number }) => {
      if (knownPos) pendingKnownPos = knownPos
      if (syncRafId !== null) return // already scheduled
      syncRafId = requestAnimationFrame(() => {
        syncRafId = null
        const pos = pendingKnownPos
        pendingKnownPos = undefined
        syncSizeImpl(pos)
      })
    }

    // ─────────────────────────────────────────────────────────────────────────

    const initWebview = async (attempt = 1): Promise<void> => {
      const MAX_RETRIES = 3
      const RETRY_DELAY_MS = 500
      try {
        const container = containerRef.current
        if (!container) return
        const rect = container.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) {
          return
        }
        if (context.closed) return

        // Fetch position + scale in parallel
        try {
          const [pos, sf] = await Promise.all([
            mainWin.innerPosition(),
            mainWin.scaleFactor(),
          ])
          mainWinPos = pos
          scale = sf
        } catch (e) {
          console.error("[Webview] Failed to get main window position:", e)
        }

        const screenX = Math.round(mainWinPos.x / scale + rect.x)
        const screenY = Math.round(mainWinPos.y / scale + rect.y)

        // ── Graceful label-exists check ────────────────────────────────────────
        // On HMR, the old webview may still exist. Close it first to avoid
        // referencing a stale handle that's about to be destroyed.
        const existing = await getByLabel(label)
        if (existing) {
          try {
            await existing.close()
            // Brief wait for the close to propagate on the Rust side
            await new Promise(r => setTimeout(r, 100))
          } catch { /* already gone — fine */ }
          if (context.closed) return
        }
        // ───────────────────────────────────────────────────────────────────────
        setLoaded(false);
        const wvw = new Webview(await getCurrentWindow(), label, {
          url,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          x: screenX,
          y: screenY
        })
        context.wvw = wvw

        wvw.once('tauri://created', async () => {

          context.created = true
          if (context.closed) {
            const claimed = await getByLabel(wvw.label)
            if (!claimed) {
              wvw.close().catch(e => console.error("[Webview] Error closing on created:", e))
            }
            return
          }
          try {
            // Re-sync position after creation — batch independent calls
            const [pos, sf, minimized] = await Promise.all([
              mainWin.innerPosition(),
              mainWin.scaleFactor(),
              mainWin.isMinimized(),
            ])
            mainWinPos = pos
            scale = sf
            isMinimized = minimized

            const currentRect = containerRef.current?.getBoundingClientRect()
            if (currentRect && currentRect.width > 0 && currentRect.height > 0) {
              await Promise.all([
                wvw.setPosition(new LogicalPosition(currentRect.x, currentRect.y)),
                wvw.setSize(new LogicalSize(Math.round(currentRect.width), Math.round(currentRect.height))),
              ])
              setFocus(false)
            }
            if (context.closed) {
              wvw.close().catch(e => console.error("[Webview] Error closing after align:", e))
              return
            }
            if (minimized) {

            }
          } catch (e) {
            console.error("[Webview] Error positioning after creation:", e)
            context.wvw = null
            context.created = false
          }
          setLoaded(true);
        }).catch(e => console.error("[Webview] Error registering tauri://created:", e))

        await wvw.listen("update_location_title_icon", async (event) => {
          const data = event.payload as any
          if (data.target == label) {
            setTitle(data.title)
            const db = workspace ?? "global";
            const sql = `INSERT OR REPLACE INTO site_registry (id, metadata) VALUES (?, ?)`;

            await pyInvoke("sqlite", {
              db,
              command: "execute",
              sql: `CREATE TABLE IF NOT EXISTS site_registry (
                      id    TEXT PRIMARY KEY,
                      metadata TEXT
                    )`,
              params: []
            });
            await pyInvoke("sqlite", {
              db,
              command: "execute",
              sql,
              params: [
                data.url,
                JSON.stringify({
                  title: data.title ?? data.url ?? 'Untitled',
                  url: data.url ?? 'about:blank',
                  icon: data.icon ?? 'default',
                  timestamp: Date.now(),
                })
              ]
            });
          }
        })

        await wvw.listen("update_location", async (event) => {
          const data = event.payload as any
          if (data.target == label) {
            console.warn(data);
            setBarUrl(data.url)
            setUrl(data.url)

            const currentPending = pendingNav.current;
            pendingNav.current = null;

            setNavState((prev) => {
              let newIndex = prev.currentIndex;
              let newHistory = [...prev.history];
              const normalizedIncoming = cleanUrl(data.url);

              if (currentPending === 'back') {
                newIndex = Math.max(0, prev.currentIndex - 1);
              } else if (currentPending === 'forward') {
                newIndex = Math.min(prev.history.length - 1, prev.currentIndex + 1);
              } else {
                if (cleanUrl(prev.history[prev.currentIndex]) !== normalizedIncoming) {
                  // Fresh navigation — always truncate forward stack
                  newHistory = prev.history.slice(0, prev.currentIndex + 1);
                  newHistory.push(data.url);
                  newIndex = newHistory.length - 1;
                }
                // else: same URL (on_page_load re-emit / same-page reload) — no-op
              }
              return { history: newHistory, currentIndex: newIndex };
            });
          }
        })

        wvw.once('tauri://error', async (e) => {
          console.error(`[Webview] Native creation error on "${label}" (attempt ${attempt}/${MAX_RETRIES}):`, e)
          const fallback = await getByLabel(label)
          if (fallback) {
            context.wvw = fallback
            context.created = true
            try {
              const [pos, sf] = await Promise.all([
                mainWin.innerPosition(),
                mainWin.scaleFactor(),
              ])
              mainWinPos = pos
              scale = sf
              const currentRect = containerRef.current?.getBoundingClientRect()
              if (currentRect) {
                const sx = Math.round(mainWinPos.x / scale + currentRect.x)
                const sy = Math.round(mainWinPos.y / scale + currentRect.y)
                // await Promise.all([
                //   fallback.setPosition(new LogicalPosition(currentRect.x, currentRect.y)),
                //   fallback.setSize(new LogicalSize(Math.round(currentRect.width), Math.round(currentRect.height))),
                // ])
              }
            } catch (err) {
              console.error("[Webview] Failed to recover existing webview:", err)
              context.wvw = null
              context.created = false
              if (attempt < MAX_RETRIES && !context.closed) {
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
                if (!context.closed) await initWebview(attempt + 1)
              } else if (!context.closed) {
                console.error(`[Webview] All ${MAX_RETRIES} attempts exhausted. WebviewWindow could not be created.`)
              }
            }
          } else {
            console.warn(`[Webview] No fallback window found for "${label}". Clearing dead handle.`)
            context.wvw = null
            context.created = false
            if (attempt < MAX_RETRIES && !context.closed) {
              await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
              if (!context.closed) await initWebview(attempt + 1)
            } else {
              console.error(`[Webview] All ${MAX_RETRIES} attempts exhausted. WebviewWindow could not be created.`)
            }
          }
        }).catch(e => console.error("[Webview] Error registering tauri://error:", e))

      } catch (e) {
        console.error("[Webview] Failed to initialize:", e)
      }
    }

    initWebview()

    // Stable wrapper so add/removeEventListener reference the same function
    const onResize = () => syncSize()
    const observer = new ResizeObserver(onResize)
    observer.observe(containerRef.current)
    window.addEventListener('resize', onResize)

    const cleanups: (() => void)[] = []

    let prevMinimized = false
    let prevMaximized = false

    // onMoved: payload already contains the new position — pass it in to skip
    // the innerPosition() IPC call entirely (saves one full round-trip per event)
    mainWin.onMoved((position) => {
      const knownPos = { x: position.payload.x, y: position.payload.y }
      syncSize(knownPos)
      window.dispatchEvent(new CustomEvent('window-moved', {
        detail: { x: position.payload.x, y: position.payload.y }
      }))
    }).then(u => cleanups.push(u)).catch(e => console.error("[Listener] Failed to register onMoved:", e))

    mainWin.onResized(async () => {
      if (activeTabId !== tabId) return;
      // Refresh scale factor here (rare but possible on DPI change)
      try {
        const [minimized, maximized, sf] = await Promise.all([
          mainWin.isMinimized(),
          mainWin.isMaximized(),
          mainWin.scaleFactor(),
        ])
        scale = sf
        isMinimized = minimized

        if (minimized && !prevMinimized) {
          window.dispatchEvent(new CustomEvent('window-minimize'))
        } else if (!minimized && prevMinimized) {
          window.dispatchEvent(new CustomEvent('window-unminimize'))
        }
        if (maximized && !prevMaximized) {
          window.dispatchEvent(new CustomEvent('window-maximize'))
        } else if (!maximized && prevMaximized) {
          window.dispatchEvent(new CustomEvent('window-unmaximize'))
        }
        prevMinimized = minimized
        prevMaximized = maximized
      } catch (e) {
        console.error("[Webview] Failed to check window state for custom events:", e)
      }
      syncSize()
    }).then(u => cleanups.push(u)).catch(e => console.error("[Listener] Failed to register onResized:", e))

    mainWin.onFocusChanged(async ({ payload: focused }) => {
      syncSize()
      if (focused) {
        window.dispatchEvent(new CustomEvent('window-focus-gained'))
        // If cursor is over the browser area, re-show and focus the child
        if (isCursorInside && context.wvw && context.created && wantsVisible.current) {
          try {

          } catch (e) {
            if (isWindowGone(e)) { clearDeadWindow(); return }
            console.error('[Webview] focus restore failed:', e)
          }
        }
      } else {
        window.dispatchEvent(new CustomEvent('window-focus-lost'))
      }
    }).then(u => cleanups.push(u)).catch(e => console.error("[Listener] Failed to register onFocusChanged:", e))

    mainWin.onCloseRequested(async (event) => {
      if (context.wvw) {
        event.preventDefault()
        try {
          await context.wvw.close()
        } catch (e) {
          console.error("[Webview] Error closing child WebviewWindow:", e)
        }
        await mainWin.destroy()
      }
    }).then(u => cleanups.push(u)).catch(() => { })

    // ── Z-order management via hide/show ────────────────────────────────────
    // The child browser is an owned window (parent: mainWin), so the OS
    // keeps it above the main window automatically. To let the user interact
    // with the main window's UI (sidebar, topbar, etc.) we simply hide the
    // child. When the cursor re-enters the browser area we show + focus it.
    //


    // Cursor polling to dispatch custom events when it leaves the containerRef area
    // Throttled to 250ms with in-flight guard to prevent IPC saturation
    let isCursorInside = false
    let isPollInFlight = false
    const pollCursor = async () => {
      if (context.closed || isPollInFlight) return
      const container = containerRef.current
      if (!container) return
      isPollInFlight = true
      try {
        if (isMinimized) {
          if (isCursorInside) {
            isCursorInside = false
            window.dispatchEvent(new CustomEvent('cursor-container-leave'))
            setFocus(false)
          }
          return
        }

        const rect = container.getBoundingClientRect()
        // Only fetch cursor position + window position; scaleFactor is cached from init
        const [pos, cursor] = await Promise.all([
          mainWin.innerPosition(),
          cursorPosition()
        ])

        const minX = pos.x + rect.left * scale
        const maxX = pos.x + rect.right * scale
        const minY = pos.y + rect.top * scale
        const maxY = pos.y + rect.bottom * scale

        const inside = cursor.x >= minX && cursor.x <= maxX && cursor.y >= minY && cursor.y <= maxY
        if (inside && !isCursorInside) {
          isCursorInside = true
          window.dispatchEvent(new CustomEvent('cursor-container-enter', {
            detail: { x: cursor.x, y: cursor.y }
          }))
        } else if (!inside && isCursorInside) {
          isCursorInside = false
          window.dispatchEvent(new CustomEvent('cursor-container-leave', {
            detail: { x: cursor.x, y: cursor.y }
          }))
          setFocus(false)
        }
      } catch (e) {
        console.error("[Webview] Failed to poll cursor position:", e)
      } finally {
        isPollInFlight = false
      }
    }

    const cursorInterval = setInterval(pollCursor, 250)
    cleanups.push(() => clearInterval(cursorInterval))

    return () => {
      context.closed = true
      // Cancel any pending RAF-debounced sync
      if (syncRafId !== null) { cancelAnimationFrame(syncRafId); syncRafId = null }
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      cleanups.forEach(fn => fn())
      if (context.wvw) {
        const wvwToClose = context.wvw
        if (context.created) {
          wvwToClose.close().catch(e => console.error(`[Webview] Error closing ${wvwToClose.label}:`, e))
        }
      }
    }
  }, [mounted, isTauri, appId])


  return (
    <div className={clsx(
      "flex flex-col w-full h-full relative overflow-hidden",
      !loaded && "bg-card"
    )}>

      {/*
        Nav bar — lives entirely above the child webview's y-range.
        `relative` creates its own stacking context; `z-50` keeps any
        dropdown/popover inside this bar above other main-webview content.
      */}


      {/*
        Content area — TRANSPARENT.

        The child WebviewWindow (a separate OS window) is positioned to
        exactly overlay this div. By keeping this div transparent, it acts
        as a placeholder showing where the browser content appears.

        To render a main-view overlay ON TOP of the browser content:
          1. await hideChildWebview()   ← hides the child window
          2. render your overlay here
          3. await showChildWebview()   ← restores the child window

        Example usage in a child component:
          <MyModal onOpen={hideChildWebview} onClose={showChildWebview} />
      */}

      <div
        ref={containerRef}
        id={label}
        onPointerDown={async () => {
          if (!focus) {
            setFocus(true)
          }
        }}
        onMouseOver={async () => {
          if (!focus) {
            setFocus(true)
          }
        }}
        className={clsx(
          "flex-1 w-full relative z-0 bg-transparent",
        )}
      >
        {!isTauri && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
            <div className="p-4 rounded-xl border border-border shadow-lg flex flex-col items-center max-w-sm text-center">
              <Search size={32} className="text-muted-foreground mb-4 opacity-50" />
              <h3 className="font-semibold text-foreground mb-1">Webview Unavailable</h3>
              <p className="text-sm">The browser requires the Tauri application environment to load web content.</p>
            </div>
          </div>
        )}
      </div>
      {(showPalette || url === "about:blank") && (
        <CommandPalette
          initialUrl={url === "about:blank" ? "" : url}
          pyInvoke={pyInvoke}
          workspace={workspace}
          onNavigate={(targetUrl) => {
            setUrl(targetUrl)
            setBarUrl(targetUrl)
            setShowPalette(false);
            showChildWebview();
            handleNavigate(targetUrl);
          }}
          onDismiss={() => {
            setShowPalette(false);
            showChildWebview();
          }}
        />
      )}
    </div>
  )
}