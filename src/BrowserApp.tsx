import { ArrowLeft, ArrowRight, RefreshCw, Home, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ref, type AppInfo } from "openchad-react"
import { getCurrentWindow, cursorPosition } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { Webview, getCurrentWebview, getAllWebviews } from '@tauri-apps/api/webview';
import { Button } from 'openchad-react/ui'
import clsx from 'clsx'
import { BrowserBar } from 'openchad-react/Bar';
import { MenuBar } from 'openchad-react/utils/state';

import { emitTo } from '@tauri-apps/api/event';

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;

export default function BrowserApp(appInfo: AppInfo) {

  const [url, setUrl] = useState("https://google.com")
  const [inputUrl, setInputUrl] = useState("https://google.com")
  const [history, setHistory] = useState<string[]>(["https://google.com"])
  const [currentIndex, setCurrentIndex] = useState(0)
  const { pyInvoke, useActiveTabId, tabId } = appInfo
  const activeTabId = useActiveTabId();

  const label = `webview-${appInfo.appId}`
  const containerRef = useRef<HTMLDivElement>(null)
  /**
   * TAURI WEBVIEW ARCHITECTURE (WebviewWindow approach)
   *
   * The child browser is created as a `WebviewWindow` — a separate OS window
   * with its own webview. This provides:
   *   1. `Manager.get_webview_window()` can find it → `eval()` works from Python
   *   2. Each window captures its own input natively → no z-order hacking
   *   3. The child window is borderless, skip-taskbar, and positioned to match
   *      the container div in the main window.
   *
   * `wantsVisible` controls whether the child window is shown. Call
   * `hideChildWebview()` before rendering main-view overlays, then
   * `showChildWebview()` when done.
   */

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

  const handleNavigate = async (newUrl: string) => {
    await pyInvoke('eval', {
      label,
      script: `window.location = "${newUrl}"`
    })
  }

  const handleBack = async () => {
    await pyInvoke('eval', {
      label,
      script: `window.history.back()`
    })
  }

  const handleForward = async () => {
    await pyInvoke('eval', {
      label,
      script: `window.history.forward()`
    })
  }

  const handleRefresh = async () => {
    await pyInvoke('eval', {
      label,
      // script: `window.location.reload()`
      script: 'window.__TAURI__.event.emitTo("main", "msg", "hello");'
    })
  }

  const handleHome = () => handleNavigate("https://google.com")

  const [mounted, setMount] = useState(false)

  const { element, setHandleNavigate, setHandleBack, setHandleForward, setHandleRefresh, setUrl: setBarUrl } = BrowserBar()

  useEffect(() => {
    setHandleNavigate(handleNavigate)
    setHandleBack(handleBack)
    setHandleForward(handleForward)
    setHandleRefresh(handleRefresh)
    MenuBar.current = MenuBar.current = ref(<>{element}</>) as React.JSX.Element
  }, [handleNavigate, handleBack, handleForward, handleRefresh, element])

  useEffect(() => {
    setMount(true)
    return () => {
      setMount(false)
    }
  }, [])

  useEffect(() => {
    if (activeTabId == tabId) {
      (async () => {
        try {
          if (contextRef.current.wvw) {
            await contextRef.current.wvw.reparent(await getCurrentWindow())
          }
        } catch (e) {
          console.error('[Webview] onMouseEnter failed:', e)
        }
      })()
    }
  }, [activeTabId]);


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
      console.warn('[Webview] Window is gone. Clearing dead handle to stop retries.')
      context.wvw = null
      context.created = false
    }

    // ── Core sync ─────────────────────────────────────────────────────────────
    // syncSize is the hot-path — keep IPC calls to the minimum.
    // `knownPos` is an optional pre-fetched position (from onMoved payload) to
    // skip the innerPosition() round-trip entirely.
    const syncSize = async (knownPos?: { x: number; y: number }) => {
      // if (activeTabId !== tabId) return;
      const container = containerRef.current
      const wvw = context.wvw
      if (!container || context.closed || !wvw || !context.created) return

      // Minimized is tracked via local state — no IPC needed here
      if (isMinimized) {
        // try { await wvw.minimize() } catch (e) {
        //   if (isWindowGone(e)) { clearDeadWindow(); return }
        //   console.error("[Webview] Failed to minimize:", e)
        // }
        return
      } else {
        // try { await wvw.unminimize() } catch (e) {
        //   if (isWindowGone(e)) { clearDeadWindow() }
        //   // Non-fatal — window might already be unminimized
        // }
      }

      const rect = container.getBoundingClientRect()

      try {
        if (rect.width === 0 && rect.height === 0) return;

        if (knownPos) {
          // onMoved already gave us the new position — use it directly
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

        // Batch position + size + show in parallel — all are fire-and-resolve
        await Promise.all([
          wvw.setPosition(new LogicalPosition(rect.x, rect.y)),
          wvw.setSize(new LogicalSize(Math.round(rect.width), Math.round(rect.height))),
        ])
      } catch (e) {
        if (isWindowGone(e)) { clearDeadWindow(); return }
        console.error("[Webview] Failed to sync size:", e)
      }
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
          console.log("[Webview] Container dimensions are 0. Skipping initialization.")
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
        const existing = await getByLabel(label)
        if (existing) {
          context.wvw = existing
          context.created = true
          return
        }
        // ───────────────────────────────────────────────────────────────────────

        console.log(`[Webview] Creating WebviewWindow (attempt ${attempt}/${MAX_RETRIES}): ${label}  url=${url}  pos=(${screenX},${screenY})  size=(${Math.round(rect.width)},${Math.round(rect.height)})`)
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
            if (claimed) {
              console.log(`[Webview] Deferred close skipped — window claimed by another mount.`)
            } else {
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
        }).catch(e => console.error("[Webview] Error registering tauri://created:", e))

        wvw.once('tauri://error', async (e) => {
          console.error(`[Webview] Native creation error on "${label}" (attempt ${attempt}/${MAX_RETRIES}):`, e)
          const fallback = await getByLabel(label)
          if (fallback) {
            console.log(`[Webview] Recovering from creation error — reusing "${label}".`)
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
                console.log(`[Webview] Recovery failed. Retrying in ${RETRY_DELAY_MS}ms...`)
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
              console.log(`[Webview] Retrying in ${RETRY_DELAY_MS}ms...`)
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
      console.log("[Webview] Main window close requested. Cleaning up child webviews.")
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
    const bringMainToFront = async () => {
      if (!context.wvw || !context.created) return
      try {
        const mw = await getCurrentWebview()
        await mw.reparent(await getCurrentWindow())
      } catch (e) {
        if (isWindowGone(e)) { clearDeadWindow(); return }
        console.error('[Webview] hide failed:', e)
      }
    }


    // Cursor polling to dispatch custom events when it leaves the containerRef area
    let isCursorInside = false
    const pollCursor = async () => {
      if (context.closed) return
      const container = containerRef.current
      if (!container) return
      try {
        if (isMinimized) {
          if (isCursorInside) {
            isCursorInside = false
            window.dispatchEvent(new CustomEvent('cursor-container-leave'))
            await bringMainToFront()
          }
          return
        }

        const rect = container.getBoundingClientRect()
        const [pos, sf, cursor] = await Promise.all([
          mainWin.innerPosition(),
          mainWin.scaleFactor(),
          cursorPosition()
        ])

        const minX = pos.x + rect.left * sf
        const maxX = pos.x + rect.right * sf
        const minY = pos.y + rect.top * sf
        const maxY = pos.y + rect.bottom * sf

        const inside = cursor.x >= minX && cursor.x <= maxX && cursor.y >= minY && cursor.y <= maxY
        if (inside && !isCursorInside) {
          isCursorInside = true
          window.dispatchEvent(new CustomEvent('cursor-container-enter', {
            detail: { x: cursor.x, y: cursor.y }
          }))
        } else if (!inside && isCursorInside) {
          // Cursor left the container area — bring main window on top
          isCursorInside = false
          window.dispatchEvent(new CustomEvent('cursor-container-leave', {
            detail: { x: cursor.x, y: cursor.y }
          }))
          await bringMainToFront()
        }
      } catch (e) {
        console.error("[Webview] Failed to poll cursor position:", e)
      }
    }

    const cursorInterval = setInterval(pollCursor, 100)
    cleanups.push(() => clearInterval(cursorInterval))

    return () => {
      context.closed = true
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      cleanups.forEach(fn => fn())
      if (context.wvw) {
        const wvwToClose = context.wvw
        if (context.created) {
          console.log(`[Webview] Closing: ${wvwToClose.label}`)
          wvwToClose.close().catch(e => console.error(`[Webview] Error closing ${wvwToClose.label}:`, e))
        } else {
          console.log(`[Webview] ${wvwToClose.label} still initializing — close deferred to tauri://created.`)
        }
      }
    }
  }, [mounted, url, isTauri, appInfo.appId])


  return (
    <div className={clsx(
      "flex flex-col w-full h-full relative overflow-hidden",
      // "bg-card"
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
        onMouseEnter={async () => {
          try {
            if (contextRef.current.wvw) {
              await contextRef.current.wvw.reparent(await getCurrentWindow())
            }
          } catch (e) {
            console.error('[Webview] onMouseEnter failed:', e)
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

    </div>
  )
}