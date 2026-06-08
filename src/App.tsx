import { ArrowLeft, ArrowRight, RefreshCw, Home, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type AppInfo } from "openchad-react"
import { Webview, getAllWebviews } from '@tauri-apps/api/webview'
import { getCurrentWindow, Window, cursorPosition } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { Button } from 'openchad-react/ui'

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;

export default function App(appInfo: AppInfo) {
  const [url, setUrl] = useState("https://google.com")
  const [inputUrl, setInputUrl] = useState("https://google.com")
  const [history, setHistory] = useState<string[]>(["https://google.com"])
  const [currentIndex, setCurrentIndex] = useState(0)
  const { pyInvoke } = appInfo
  const labelRef = useRef<string>('')
  const containerRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<WebviewWindow | null>(null)

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
  const wantsVisible = useRef(true)

  /** Hides the child webview window so main-view overlays can render on top */
  const hideChildWebview = useCallback(async () => {
    wantsVisible.current = false
    try { await webviewRef.current?.hide() } catch { /* webview may not exist yet */ }
  }, [])

  /** Restores the child webview window after an overlay is dismissed */
  const showChildWebview = useCallback(async () => {
    wantsVisible.current = true
    try { await webviewRef.current?.show() } catch { /* webview may not exist yet */ }
  }, [])

  const handleNavigate = (newUrl: string) => {
    let finalUrl = newUrl.trim()
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
        finalUrl = 'https://' + finalUrl
      } else {
        finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(finalUrl)
      }
    }
    const newHistory = history.slice(0, currentIndex + 1)
    newHistory.push(finalUrl)
    setHistory(newHistory)
    setCurrentIndex(newHistory.length - 1)
    setUrl(finalUrl)
    setInputUrl(finalUrl)
  }

  const handleBack = () => {
    if (currentIndex > 0) {
      const idx = currentIndex - 1
      setCurrentIndex(idx)
      setUrl(history[idx])
      setInputUrl(history[idx])
    }
  }

  const handleForward = () => {
    if (currentIndex < history.length - 1) {
      const idx = currentIndex + 1
      setCurrentIndex(idx)
      setUrl(history[idx])
      setInputUrl(history[idx])
    }
  }

  const handleRefresh = () => {
    const sep = url.includes('?') ? '&' : '?'
    setUrl(url + sep + '_r=' + Date.now())
  }

  const handleHome = () => handleNavigate("https://google.com")

  useEffect(() => {
    if (!isTauri || !containerRef.current) return

    const context = {
      closed: false,
      wvw: null as WebviewWindow | null,
      created: false,
    }

    // Cache main window position so we can compute screen-absolute coords
    const mainWin = getCurrentWindow()
    let mainWinPos = { x: 0, y: 0 }
    let scale = 1

    const initWebview = async () => {
      try {
        const container = containerRef.current
        if (!container) return

        const rect = container.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) {
          console.log("[Webview] Container dimensions are 0. Skipping initialization.")
          return
        }

        if (context.closed) return

        // Fresh unique label per effect run
        const label = `webview-${appInfo.appId}-${Date.now()}`
        labelRef.current = label

        // Get main window position so we can position child in screen coords
        try {
          const pos = await mainWin.innerPosition()
          mainWinPos = pos
          scale = await mainWin.scaleFactor()
        } catch (e) {
          console.error("[Webview] Failed to get main window position:", e)
        }

        // Convert container rect (relative to main window viewport) to
        // screen-absolute logical coordinates for the child window
        const screenX = Math.round(mainWinPos.x / scale + rect.x)
        const screenY = Math.round(mainWinPos.y / scale + rect.y)

        console.log(`[Webview] Creating WebviewWindow: ${label}  url=${url}  pos=(${screenX},${screenY})  size=(${Math.round(rect.width)},${Math.round(rect.height)})`)

        const wvw = new WebviewWindow(label, {
          url,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          x: screenX,
          y: screenY,
          decorations: false,
          skipTaskbar: true,
          visible: false,        // start hidden, show after positioning
          transparent: false,
          alwaysOnTop: true,     // keep browser on top of main window
        })

        context.wvw = wvw

        wvw.once('tauri://created', async () => {
          context.created = true

          if (context.closed) {
            wvw.close().catch(e => console.error("[Webview] Error closing on created:", e))
            return
          }

          try {
            // Re-sync position after creation (in case window moved during init)
            const pos = await mainWin.innerPosition()
            mainWinPos = pos
            scale = await mainWin.scaleFactor()

            const currentRect = containerRef.current?.getBoundingClientRect()
            if (currentRect) {
              const sx = Math.round(mainWinPos.x / scale + currentRect.x)
              const sy = Math.round(mainWinPos.y / scale + currentRect.y)
              await wvw.setPosition(new LogicalPosition(sx, sy))
              await wvw.setSize(new LogicalSize(Math.round(currentRect.width), Math.round(currentRect.height)))
            }

            if (context.closed) {
              wvw.close().catch(e => console.error("[Webview] Error closing after align:", e))
              return
            }

            // Only show if no overlay is currently active
            if (wantsVisible.current) {
              await wvw.show()
            }
            webviewRef.current = wvw
          } catch (e) {
            console.error("[Webview] Error positioning after creation:", e)
          }
        }).catch(e => console.error("[Webview] Error registering tauri://created:", e))

        wvw.once('tauri://error', (e) => {
          console.error(`[Webview] Native creation error on ${label}:`, e)
        }).catch(e => console.error("[Webview] Error registering tauri://error:", e))

      } catch (e) {
        console.error("[Webview] Failed to initialize:", e)
      }
    }

    initWebview()

    // Sync child window position/size when container resizes or main window moves
    const syncSize = async () => {
      const container = containerRef.current
      const wvw = context.wvw
      if (!container || context.closed) return

      const rect = container.getBoundingClientRect()

      if (rect.width === 0 || rect.height === 0) {
        if (wvw && context.created) {
          try { await wvw.hide() } catch (e) { console.error("[Webview] Failed to hide:", e) }
        }
        return
      }

      if (!wvw || !context.created) return

      try {
        // Refresh main window position
        const pos = await mainWin.innerPosition()
        mainWinPos = pos
        scale = await mainWin.scaleFactor()

        const sx = Math.round(mainWinPos.x / scale + rect.x)
        const sy = Math.round(mainWinPos.y / scale + rect.y)
        await wvw.setPosition(new LogicalPosition(sx, sy))
        await wvw.setSize(new LogicalSize(Math.round(rect.width), Math.round(rect.height)))
        // Respect visibility intent
        if (wantsVisible.current) {
          await wvw.show()
        }
      } catch (e) {
        console.error("[Webview] Failed to sync size:", e)
      }
    }

    const observer = new ResizeObserver(syncSize)
    observer.observe(containerRef.current)
    window.addEventListener('resize', syncSize)

    // Also sync when main window moves
    const cleanups: (() => void)[] = []
    mainWin.onMoved(() => syncSize())
      .then(u => cleanups.push(u)).catch(() => { })
    mainWin.onResized(() => syncSize())
      .then(u => cleanups.push(u)).catch(() => { })

    return () => {
      context.closed = true
      observer.disconnect()
      window.removeEventListener('resize', syncSize)
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

      if (webviewRef.current === context.wvw) {
        webviewRef.current = null
      }
    }
  }, [url, isTauri, appInfo.appId])

  return (
    <div className="flex flex-col w-full h-full relative overflow-hidden">

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
      <div>
        <Button onClick={async () => {
          await pyInvoke("eval", {
            label: labelRef.current,
            script: "document.body.style.backgroundColor = 'red';"
          });
        }}>
          Click
        </Button>
      </div>
      <div
        ref={containerRef}
        className="flex-1 w-full relative z-0 bg-transparent"
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