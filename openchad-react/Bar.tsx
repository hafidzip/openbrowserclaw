import { getCurrentWindow } from '@tauri-apps/api/window'
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Columns, Link2, Minus, RotateCw, SlidersHorizontal, Square, X } from 'lucide-react';
import { useRef, useState } from 'react';

const isTauriEnv = typeof window !== "undefined" && !!(window as any).__TAURI__;


export function BrowserBar() {
  const [url, setUrl] = useState("");
  const handleNavigateRef = useRef<((url: string) => void) | undefined>(undefined);
  const handleBackRef    = useRef<(() => void) | undefined>(undefined);
  const handleForwardRef = useRef<(() => void) | undefined>(undefined);
  const handleRefreshRef = useRef<(() => void) | undefined>(undefined);

  // Refs are mutated silently — no re-render, so no infinite loop
  const setHandleNavigate = (fn: (url: string) => void) => { handleNavigateRef.current = fn; };
  const setHandleBack    = (fn: () => void) => { handleBackRef.current    = fn; };
  const setHandleForward = (fn: () => void) => { handleForwardRef.current = fn; };
  const setHandleRefresh = (fn: () => void) => { handleRefreshRef.current = fn; };


  return {
    element: <>
      {/* Navigation Controls (Left) */}
      <div className={
        clsx(
          "flex items-center gap-1.5 pointer-events-auto",
        )
      }>
        <div onClick={() => { handleBackRef.current?.(); }} className="flex items-center justify-center rounded-lg w-7 h-7 hover:bg-white/10 dark:hover:bg-white/5 transition-colors cursor-pointer text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="w-4 h-4" />
        </div>
        <div onClick={() => { handleForwardRef.current?.(); }} className="flex items-center justify-center rounded-lg w-7 h-7 hover:bg-white/10 dark:hover:bg-white/5 transition-colors cursor-pointer text-zinc-400 hover:text-zinc-200">
          <ArrowRight className="w-4 h-4" />
        </div>
        <div onClick={() => { handleRefreshRef.current?.(); }} className="flex items-center justify-center rounded-lg w-7 h-7 hover:bg-white/10 dark:hover:bg-white/5 transition-colors cursor-pointer text-zinc-400 hover:text-zinc-200">
          <RotateCw className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* Pill-shaped Address Bar (Middle) */}
      <div className="flex-1 max-w-[480px] mx-4 pointer-events-auto">
        <div className={clsx(
          "w-full h-7 rounded-full flex items-center px-3 gap-2 transition-all",
        )}>
          <Link2 className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleNavigateRef.current?.(url);
              }
            }}
            type="text"
            placeholder="Search or Enter URL..."
            className={clsx(
              "bg-accent/5 rounded-lg px-4 border-none outline-none text-[11px] w-full h-full flex-1",
            )}
          />
          <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-400 cursor-pointer flex-shrink-0 transition-colors" />
        </div>
      </div>
    </>, setHandleNavigate, setHandleBack, setHandleForward, setHandleRefresh, setUrl
  }
}

export default function Bar({ children, theme, isRightToLeft }: { children?: React.JSX.Element | React.JSX.Element[] | null, theme: string, isRightToLeft: boolean }) {
  const handleMinimize = () => {
    if (isTauriEnv) {
      getCurrentWindow().minimize();
    }
  };
  const handleMaximize = () => {
    if (isTauriEnv) {
      getCurrentWindow().toggleMaximize();
    }
  };
  const handleClose = () => {
    if (isTauriEnv) {
      getCurrentWindow().close();
    }
  };

  return (
    <div
      data-tauri-drag-region
      className={clsx(
        "w-full h-8 flex items-center justify-between select-none flex-shrink-0 z-20 px-2",
        "bg-[hsl(var(--bg))]",
        isRightToLeft ? "flex-row-reverse" : "flex-row"
      )}
    >

      {children ? children : <div className='flex-1'>

      </div>}

      {/* Right Controls */}
      <div className={clsx(
        "flex items-center gap-4 pointer-events-auto",
      )}>
        {/* Tauri Window buttons */}
        <div className={clsx(
          "flex items-center gap-1",
          isRightToLeft ? "flex-row-reverse" : "flex-row"
        )}>
          <button
            onClick={handleMinimize}
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/10 dark:hover:bg-white/5 transition-colors cursor-pointer text-zinc-400 hover:text-zinc-200"
            aria-label="Minimize"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={handleMaximize}
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/10 dark:hover:bg-white/5 transition-colors cursor-pointer text-zinc-400 hover:text-zinc-200"
            aria-label="Maximize"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleClose}
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-colors cursor-pointer text-zinc-400"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}