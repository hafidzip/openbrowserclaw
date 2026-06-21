import { ArrowLeft, ArrowRight, RefreshCw, Home, Search, Globe } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AsyncLock, ref, useGlobal, usePython, usePythonEvent, useSnapshot, type AppInfo } from "openchad-react"
import { getCurrentWindow, cursorPosition } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { Webview, getCurrentWebview, getAllWebviews } from '@tauri-apps/api/webview';
import { Button } from 'openchad-react/ui'
import clsx from 'clsx'
import { BrowserBar } from 'openchad-react/Bar';
import { deleteActiveTabWithGroupSelection, MenuBar, TabInfo, TabState } from 'openchad-react/utils/state';

import { emitTo } from '@tauri-apps/api/event';
import { createWebview, uuidv4 } from 'openchad-react/utils';
import { useDatabaseImpl } from 'openchad-react/components/useDatabase';
import type { ControllableBrowser } from 'openchad-react/components/ControllableBrowsers';

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;

export function CommandPalette({
  appId,
  pyInvoke,
  workspace,
  onNavigate,
  onDismiss,
}: {
  appId: string;
  pyInvoke: any;
  workspace: string | null;
  onNavigate: (url: string) => void;
  onDismiss: () => void;
}) {
  const isValidHttpUrl = (string: string): boolean => {
    if (!string) return false;
    if (string.startsWith("https")) return true;
    if (string.startsWith("http")) return true;
    const urlRegex = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}/;
    return urlRegex.test(string);
  };
  const [url, setUrl] = useDatabaseImpl(`${appId}-url`, { initialValue: { url: "about:blank" } })
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
        const searchClause = url.url ? "WHERE metadata LIKE ?" : "";
        const res = await pyInvoke("sqlite", {
          db,
          command: "query",
          sql: `SELECT id, metadata FROM site_registry ${searchClause} ORDER BY rowid DESC LIMIT 5`,
          params: url.url ? [`%${url.url}%`] : []
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
  }, [url.url, pyInvoke, workspace]);

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
      className="w-full h-full absolute left-0 top-0 flex items-center justify-center bg-black/50 p-4"
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
            value={url.url}
            onChange={(e) => setUrl({ url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && url.url.trim()) {
                handleSearchOrNavigate(url.url.trim());
              }
            }}
          />
        </div>

        {/* Suggestion List */}
        <div className="flex flex-col gap-0.5">
          {url.url.trim() && url.url !== "about:blank" && (
            <div
              className="w-full flex items-center justify-between px-3.5 py-2 rounded-xl cursor-pointer transition-colors duration-150"
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'hsl(var(--hover))'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              onClick={() => handleSearchOrNavigate(url.url.trim())}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                  <Search size={16} style={{ color: 'var(--fgColor-muted)' }} />
                </div>
                <div className="flex items-baseline gap-2 min-w-0 text-[14px]">
                  <span style={{ color: 'var(--fgColor-default)' }} className="font-medium flex-shrink-0">
                    {isValidHttpUrl(url.url) ? `Open ${url.url}` : `Search ${url.url}`}
                  </span>
                </div>
              </div>
            </div>
          )}

          {suggestions.filter((item) => item.id !== url.url).map((item) => {
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

const cleanUrl = (u?: string | null) => {
  if (!u) return "";
  return u.replace(/\/$/, "");
};

export default function BrowserApp({ useWorkspace, setTitle, setIcon, pyInvoke, useActiveTabId, useTheme, tabId, appId, useTab }: AppInfo) {
  const { childrenProps, layout: tabLayout } = useTab() ?? {};
  const initialUrl = childrenProps?.[appId]?.data?.url || "";
  const [browsers, setBrowsers, { ready: browsersReady }] = useDatabaseImpl<Record<string, ControllableBrowser>>('ControllableBrowser', { initialValue: {} });


  const [url, setUrl, { ready }] = useDatabaseImpl(`${appId}-url`, { initialValue: { url: initialUrl } })
  const [navState, setNavState] = useState({
    history: url.url === "" ? [] : [url.url],
    currentIndex: url.url === "" ? -1 : 0
  });
  const { history, currentIndex } = navState;
  const { layout } = useTheme()
  const { workspace } = useWorkspace()
  const { appId: activeAppId } = useSnapshot(MenuBar)

  const [focus, setFocus] = useState(false)
  const [refresh, setRefresh] = useState(0)

  const [showPalette, setShowPalette] = useState(false)
  const [initialized, setInitialized] = useState(false)

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
    AsyncLock.run(async () => {
      await pyInvoke('eval', { label, script: `window.location = ${JSON.stringify(url)}` })
    })
  }

  const handleBack = async () => {
    if (currentIndex > 0) {
      pendingNav.current = 'back'
      AsyncLock.run(async () => {
        await pyInvoke('eval', {
          label,
          script: `window.history.back()`
        })
      })
    }
  }

  const handleForward = async () => {
    if (currentIndex < history.length - 1) {
      pendingNav.current = 'forward'
      AsyncLock.run(async () => {
        await pyInvoke('eval', {
          label,
          script: `window.history.forward()`
        })
      })
    }
  }

  const handleRefresh = async () => {
    AsyncLock.run(async () => {
      await pyInvoke('eval', {
        label,
        script: `window.location.reload()`
      })
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
    setHandleAddressBarClick
  } = BrowserBar({
    appId,
    canGoBack: currentIndex > 0,
    canGoForward: currentIndex < history.length - 1
  })

  const layoutRef = useRef(tabLayout)
  layoutRef.current = tabLayout

  const elementRef = useRef(element)
  elementRef.current = element

  const workspaceRef = useRef(workspace)
  workspaceRef.current = workspace

  const browserReadyRef = useRef(browsersReady)
  browserReadyRef.current = browsersReady

  const [lastUrl, setLastUrl] = useState("")

  useEffect(() => {
    if (!ready) return
    if (/^https?:\/\//.test(url.url)) {
      // DB has a real URL saved — mark as initialized, no palette needed
      setInitialized(true)
    } else {
      // DB is still at the default "about:blank" — show the palette
      setShowPalette(true)
    }
  }, [ready])


  useEffect(() => {
    setHandleNavigate(handleNavigate)
    setHandleBack(handleBack)
    setHandleForward(handleForward)
    setHandleRefresh(handleRefresh)
    setHandleAddressBarClick(() => {
      setShowPalette((prev) => {
        if (!prev) {
          setLastUrl(url.url)
          setFocus(false)
          setRefresh(prev => (prev + 1) % 2)
        } else {
          setLastUrl(url.url)
          setFocus(true)
          setRefresh(prev => (prev + 1) % 2)
        }
        return !prev;
      });
    });
  }, [handleNavigate, handleBack, handleForward, handleRefresh])

  useEffect(() => {
    if (activeTabId == tabId) {
      MenuBar.appId = appId
      MenuBar.tabId = tabId
      MenuBar.current = ref(<>{element}</>) as React.JSX.Element
    }
  }, [activeTabId])

  useEffect(() => {
    if (activeTabId == tabId && activeAppId == appId) {
      MenuBar.appId = appId
      MenuBar.tabId = tabId
      MenuBar.current = ref(<>{element}</>) as React.JSX.Element
    }
  }, [activeTabId, activeAppId, url, element])

  useEffect(() => {
    if (!mounted) setMount(activeTabId == tabId)
  }, [activeTabId])

  useEffect(() => {
    (async () => {
      await AsyncLock.run(async () => {
        const existing = await getByLabel(label)
        if (existing) {
          if (activeTabId == tabId) {
            await existing.show()
          } else {
            await existing.hide()
          }
        }
      })
    })()
  }, [activeTabId]);

  useEffect(() => {
    (async () => {
      await AsyncLock.run(async () => {
        if (focus) {
          const existing = await getByLabel(label)
          if (existing) {
            await existing.reparent(await getCurrentWindow())
          }
        } else {
          const mw = await getCurrentWebview()
          await mw.reparent(await getCurrentWindow())
        }
      })
    })()
  }, [focus, refresh])

  const [isCreateTask, setIsCreateTask] = useGlobal('overlay-create-task', { initialValue: true });
  const [showSearchDialog] = useGlobal('showSearchDialog', { initialValue: false });
  const [showMcpDialog] = useGlobal('showMcpDialog', { initialValue: false });
  const [showCredentialsDialog] = useGlobal('showCredentialsDialog', { initialValue: false });
  const [showLocalModelDialog] = useGlobal('showLocalModelDialog', { initialValue: false });
  const [showCustomEndpointDialog] = useGlobal('showCustomEndpointDialog', { initialValue: false });
  const [showSettingsDialog] = useGlobal('showSettingsDialog', { initialValue: false });
  const [showTaskDialog] = useGlobal('showTaskDialog', { initialValue: false });
  const [setupModel] = useGlobal('setupModel', { initialValue: false });
  const [settingsDropdown] = useGlobal('settingsDropdown', { initialValue: false });
  const [mobileSettingsDropdown] = useGlobal('mobileSettingsDropdown', { initialValue: false });
  const [showControllableBrowsersDialog] = useGlobal('showControllableBrowsersDialog', { initialValue: false });
  const [showSkillsDialog] = useGlobal('showSkillsDialog', { initialValue: false });
  const [showAgentsDialog] = useGlobal('showAgentsDialog', { initialValue: false });
  const [isMobileSearching, setIsMobileSearching] = useGlobal('isMobileSearching', { initialValue: false });

  useEffect(() => {
    if (focus && (isCreateTask || isMobileSearching || showAgentsDialog || showSkillsDialog || showControllableBrowsersDialog || mobileSettingsDropdown || settingsDropdown || showSearchDialog || showMcpDialog || showCredentialsDialog || showLocalModelDialog || showCustomEndpointDialog || showSettingsDialog || showTaskDialog || setupModel)) {
      setFocus(false)
      setRefresh(prev => (prev + 1) % 2)
    }
  }, [focus, isCreateTask, isMobileSearching, showAgentsDialog, showSkillsDialog, showControllableBrowsersDialog, mobileSettingsDropdown, settingsDropdown, showSearchDialog, showMcpDialog, showCredentialsDialog, showLocalModelDialog, showCustomEndpointDialog, showSettingsDialog, showTaskDialog, setupModel])

  const syncSize = async () => {
    const container = containerRef.current
    const webviews = await getAllWebviews()
    const wvw = webviews.find(webview => webview.label === label)
    if (!container || !wvw) return

    const rect = container.getBoundingClientRect()

    try {
      if (rect.width === 0 && rect.height === 0) return;
      // Batch position + size + show in parallel — all are fire-and-resolve
      await Promise.all([
        wvw.setPosition(new LogicalPosition(rect.x, rect.y)),
        wvw.setSize(new LogicalSize(Math.round(rect.width), Math.round(rect.height))),
      ])
    } catch (e) {
      console.error("[Webview] Failed to sync size:", e)
    }
  }

  useEffect(() => {
    (async () => {
      await AsyncLock.run(async () => {
        await syncSize();
      })
    })()
  }, [layout, activeTabId, refresh])

  useEffect(() => {
    if (!showPalette) {
      setFocus(true)
      setRefresh(prev => (prev + 1) % 2)
    }
  }, [showPalette])

  useEffect(() => {
    if (!ready || !containerRef.current) return

    (async () => {
      const existing = await getByLabel(label)
      if (existing) {
        setFocus(false)
        setRefresh(prev => (prev + 1) % 2)
        await existing.show()
      } else {
        console.log('init webview')
        const initWebview = async (): Promise<void> => {
          const container = containerRef.current
          if (!container) return
          const rect = container.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) return

          // await AsyncLock.acquire();
          const wvw = await createWebview(label, {
            url: /^https?:\/\//.test(url.url) ? url.url : "about:blank",
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            x: screenX,
            y: screenY
          })
          // AsyncLock.release();
          setFocus(false)
          setRefresh(prev => (prev + 1) % 2)

          if (wvw) {
            wvw.listen('page_loaded', (event) => {
              window.dispatchEvent(new CustomEvent('page_loaded', { detail: event.payload }));
            });

            wvw.listen('update_location', (event) => {
              window.dispatchEvent(new CustomEvent('update_location', { detail: event.payload }));
            })
            wvw.listen('update_location_title_icon', (event) => {
              window.dispatchEvent(new CustomEvent('update_location_title_icon', { detail: event.payload }));
            })
            wvw.listen('delete_tab', async (event) => {
              window.dispatchEvent(new CustomEvent('delete_tab', { detail: event.payload }));
            })

            wvw.listen('switch_tab', async (event) => {
              window.dispatchEvent(new CustomEvent('switch_tab', { detail: event.payload }));
            })

            wvw.listen('create_task', async (event) => {
              window.dispatchEvent(new CustomEvent('create_task', { detail: event.payload }));
            })

            wvw.listen('focus', async (event) => {
              window.dispatchEvent(new CustomEvent('focus', { detail: event.payload }));
            })
          }
        }
        await initWebview()
      }
    })()

    const cleanups: (() => void)[] = []

    const onFocus = () => { setFocus(false); setRefresh(prev => (prev + 1) % 2) }
    const onAppFocus = (event: any) => {
      if (event.detail?.target === label) {
        MenuBar.appId = appId
        MenuBar.tabId = tabId
        MenuBar.current = ref(<>{elementRef.current}</>) as React.JSX.Element
      }
    }
    const onHidePopup = () => {
      setFocus(false);
    }
    const onUpdateTitle = async (event: any) => {
      await AsyncLock.run(async () => {
        const data = event.detail as any
        console.log("[Browsers data]:", browsers);
        if (data.target == label) {
          setTitle(data.title)
          const db = workspaceRef.current ?? "global"
          const sql = `INSERT OR REPLACE INTO site_registry (id, metadata) VALUES (?, ?)`

          if (browserReadyRef.current && appId.startsWith("agent")) {
            console.log(browsers);
            setBrowsers((prev) => {
              const newBrowsers = { ...prev }
              newBrowsers[appId] = {
                name: data.title ?? data.url ?? 'Untitled',
                url: data.url ?? 'about:blank',
                icon: data.icon ?? 'default',
                timestamp: Date.now(),
              }
              return newBrowsers
            })
          }

          await pyInvoke("sqlite", {
            db,
            command: "execute",
            sql: `CREATE TABLE IF NOT EXISTS site_registry (
                      id    TEXT PRIMARY KEY,
                      metadata TEXT
                    )`,
            params: []
          })

          if (data.icon && layoutRef.current === "single") {
            setIcon(data.icon)
          }

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
          })
        }
      })
    }
    const onLocationChange = async (event: any) => {
      await AsyncLock.run(async () => {
        const data = event.detail as any
        if (data.target == label) {
          setUrl({ url: data.url })

          const currentPending = pendingNav.current
          pendingNav.current = null

          setNavState((prev) => {
            let newIndex = prev.currentIndex
            let newHistory = [...prev.history]

            const normalizedIncoming = cleanUrl(data.url)

            if (currentPending === 'back') {
              newIndex = Math.max(0, prev.currentIndex - 1)
            } else if (currentPending === 'forward') {
              newIndex = Math.min(prev.history.length - 1, prev.currentIndex + 1)
            } else {
              if (data.url && data.url !== "about:blank") {
                const currentUrl = (prev.currentIndex >= 0 && prev.currentIndex < prev.history.length)
                  ? prev.history[prev.currentIndex]
                  : "";
                if (cleanUrl(currentUrl) !== normalizedIncoming) {
                  // Fresh navigation — always truncate forward stack
                  newHistory = prev.history.slice(0, prev.currentIndex + 1)
                  newHistory.push(data.url)
                  newIndex = newHistory.length - 1
                }
              }
            }

            // Ensure newIndex is within valid bounds for newHistory
            if (newHistory.length === 0) {
              newIndex = -1
            } else {
              newIndex = Math.max(0, Math.min(newHistory.length - 1, newIndex))
            }

            return { history: newHistory, currentIndex: newIndex }
          })
        }
      })
    }

    const Sync = async () => {
      await AsyncLock.run(async () => {
        await syncSize();
      })
    }

    const onTabDelete = async () => {
      await deleteActiveTabWithGroupSelection()
    }

    const onTabSwitch = async (event: any) => {
      // TODO
    }

    const onCreateTask = () => {
      setIsCreateTask(true);
    }

    const observer = new ResizeObserver(Sync)
    observer.observe(containerRef.current)
    window.addEventListener('update_location', onLocationChange)
    window.addEventListener('focus', onAppFocus)
    window.addEventListener('update_location_title_icon', onUpdateTitle)
    window.addEventListener('delete_tab', onTabDelete)
    window.addEventListener('switch_tab', onTabSwitch)
    window.addEventListener('create_task', onCreateTask)
    window.addEventListener('resize', Sync)
    window.addEventListener('mainFocusChanged', Sync)
    window.addEventListener('mainOnMove', Sync)
    window.addEventListener('mainOnResize', Sync)
    window.addEventListener('mainMove', Sync)
    window.addEventListener('mainCursorLeave', onFocus)
    window.addEventListener('hide-popup', onHidePopup);

    return () => {
      observer.disconnect()
      window.removeEventListener('update_location', onLocationChange)
      window.removeEventListener('focus', onAppFocus)
      window.removeEventListener('update_location_title_icon', onUpdateTitle)
      window.removeEventListener('delete_tab', onTabDelete)
      window.removeEventListener('switch_tab', onTabSwitch)
      window.removeEventListener('create_task', onCreateTask)
      window.removeEventListener('resize', Sync)
      window.removeEventListener('mainFocusChanged', Sync)
      window.removeEventListener('mainOnMove', Sync)
      window.removeEventListener('mainOnResize', Sync)
      window.removeEventListener('mainMove', Sync)
      window.removeEventListener('mainCursorLeave', onFocus)
      window.removeEventListener('hide-popup', onHidePopup);
      cleanups.forEach(fn => fn())
    }
  }, [ready])


  return (
    <div
      style={{
        padding: '0.25px'
      }}
      className={clsx(
        "flex flex-col w-full h-full relative overflow-hidden",
        !initialized && "bg-card"
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
          setFocus(true)
          setRefresh(prev => (prev + 1) % 2)
        }}
        onMouseMove={async () => {
          setFocus(true)
          setRefresh(prev => (prev + 1) % 2)
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
      {(showPalette) && (
        <CommandPalette
          appId={appId}
          pyInvoke={pyInvoke}
          workspace={workspace}
          onNavigate={(targetUrl) => {
            setInitialized(true);
            setUrl({ url: targetUrl })
            setShowPalette(false);
            handleNavigate(targetUrl);
          }}
          onDismiss={() => {
            if (initialized || /^https?:\/\//.test(url.url)) setShowPalette(false);
            setUrl({ url: lastUrl })
          }}
        />
      )}
    </div>
  )
}