import { getCurrentWindow } from '@tauri-apps/api/window'
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Columns, Columns2, Columns3, Grid2X2, LayoutPanelTop, Link2, Minus, PanelBottom, PanelsLeftBottom, PanelsRightBottom, RotateCw, Rows2, SlidersHorizontal, Square, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { addTab } from './utils/state';
import { uuidv4 } from './utils';
import { useDatabaseImpl } from './components/useDatabase';

const isTauriEnv = typeof window !== "undefined" && !!(window as any).__TAURI__;


export function BrowserBar({
  appId,
  canGoBack,
  canGoForward
}: {
  appId: string;
  canGoBack: boolean;
  canGoForward: boolean;
}) {
  const [url, , {ready}] = useDatabaseImpl(`${appId}-url`, {initialValue: {url: "about:blank"}});

  const handleNavigateRef = useRef<((url: string) => void) | undefined>(undefined);
  const handleBackRef = useRef<(() => void) | undefined>(undefined);
  const handleForwardRef = useRef<(() => void) | undefined>(undefined);
  const handleRefreshRef = useRef<(() => void) | undefined>(undefined);
  const handleAddressBarClickRef = useRef<(() => void) | undefined>(undefined);

  // Refs are mutated silently — no re-render, so no infinite loop
  const setHandleNavigate = (fn: (url: string) => void) => { handleNavigateRef.current = fn; };
  const setHandleBack = (fn: () => void) => { handleBackRef.current = fn; };
  const setHandleForward = (fn: () => void) => { handleForwardRef.current = fn; };
  const setHandleRefresh = (fn: () => void) => { handleRefreshRef.current = fn; };
  const setHandleAddressBarClick = (fn: () => void) => { handleAddressBarClickRef.current = fn; };


  return {
    element: <>
      {/* Navigation Controls (Left) */}
      <div className={
        clsx(
          "flex items-center gap-1.5 pointer-events-auto",
        )
      }>
        <div
          onClick={() => { if (canGoBack) handleBackRef.current?.(); }}
          className={clsx(
            "flex items-center justify-center rounded-lg w-7 h-7 transition-colors",
            canGoBack
              ? "hover:bg-white/10 dark:hover:bg-white/5 cursor-pointer text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              : "opacity-40 cursor-not-allowed text-zinc-600"
          )}
        >
          <ArrowLeft className="w-4 h-4" />
        </div>
        <div
          onClick={() => { if (canGoForward) handleForwardRef.current?.(); }}
          className={clsx(
            "flex items-center justify-center rounded-lg w-7 h-7 transition-colors",
            canGoForward
              ? "hover:bg-white/10 dark:hover:bg-white/5 cursor-pointer text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              : "opacity-40 cursor-not-allowed text-zinc-600"
          )}
        >
          <ArrowRight className="w-4 h-4" />
        </div>
        <div onClick={() => { handleRefreshRef.current?.(); }} className="flex items-center justify-center rounded-lg w-7 h-7 hover:bg-white/10 dark:hover:bg-white/5 transition-colors cursor-pointer text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200">
          <RotateCw className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* Pill-shaped Address Bar (Middle) */}
      <div className="flex-1 px-4 pointer-events-none">
        { /^https?:\/\//.test(url.url) && <div 
        style={{
          top:'2px'
        }}
        className={clsx(
          "absolute left-0 w-full h-7 rounded-full flex items-center justify-center px-3 gap-2 transition-all pointer-events-none",
        )}>
          <div
            onClick={() => { handleAddressBarClickRef.current?.(); }}
            className={clsx(
              'text-center text-accent/50 hover:text-accent bg-[hsl(var(--bg))] hover:bg-card cursor-pointer w-100 text-xs rounded-lg  px-2 py-1 truncate pointer-events-auto',
            )}
          >
            {url.url}
          </div>
        </div>}
      </div>

      <div className={clsx(
        'flex items-center gap-2 px-4',
      )}>
        <Columns2
          onClick={() => {
            addTab({
              layout: 'horizontal',
              childrenProps: {
                [uuidv4()]: {
                  icon: "default",
                  title: null,
                  appname: "main-app",
                  data: null,
                },
                [uuidv4()]: {
                  icon: "default",
                  title: null,
                  appname: "main-app",
                  data: null,
                }
              }
            })
          }}
          className='text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer' size={14} />
        <Rows2 onClick={() => {
          addTab({
            layout: 'vertical',
            childrenProps: {
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              }
            }
          })
        }} className='text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer' size={14} />
        <Columns3 onClick={() => {
          addTab({
            layout: 'triple',
            childrenProps: {
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              }
            }
          })
        }} className='text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer' size={14} />
        <PanelsLeftBottom onClick={() => {
          addTab({
            layout: 'triple-left',
            childrenProps: {
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              }
            }
          })
        }} className='text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer' size={14} />
        <PanelsRightBottom onClick={() => {
          addTab({
            layout: 'triple-right',
            childrenProps: {
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              }
            }
          })
        }} className='text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer' size={14} />
        <LayoutPanelTop onClick={() => {
          addTab({
            layout: 'triple-top',
            childrenProps: {
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              }
            }
          })
        }} className='text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer' size={14} />
        <LayoutPanelTop onClick={() => {
          addTab({
            layout: 'triple-bottom',
            childrenProps: {
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              }
            }
          })
        }} className='text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer rotate-180' size={14} />
        <Grid2X2 onClick={() => {
          addTab({
            layout: 'grid2x2',
            childrenProps: {
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              },
              [uuidv4()]: {
                icon: "default",
                title: null,
                appname: "main-app",
                data: null,
              }
            }
          })
        }} className='text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer' size={14} />
      </div>
    </>, setHandleNavigate, setHandleBack, setHandleForward, setHandleRefresh, setHandleAddressBarClick
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

      {children ? children : <div className='flex-1'></div>}

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
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/10 dark:hover:bg-white/5 transition-colors cursor-pointer text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
            aria-label="Minimize"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={handleMaximize}
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/10 dark:hover:bg-white/5 transition-colors cursor-pointer text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
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