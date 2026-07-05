import { getCurrentWindow } from '@tauri-apps/api/window'
import clsx from 'clsx';
import { ArrowLeft, ArrowLeftRight, ArrowRight, Columns, Columns2, Columns3, Columns3Cog, Grid2X2, LayoutPanelTop, Link2, Minus, PanelBottom, PanelsLeftBottom, PanelsRightBottom, RotateCw, Rows2, SlidersHorizontal, Square, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSnapshot } from 'valtio';
import { addTab, BrowserHandlers, BrowserNavState, TabInfo } from './utils/state';
import { uuidv4 } from './utils';
import { useDatabaseImpl } from './components/useDatabase';
import { useGlobal } from './components/useGlobal';
import { invoke } from '@tauri-apps/api/core';

const isTauriEnv = typeof window !== "undefined" && !!(window as any).__TAURI__;


export function BrowserBar({ appId }: { appId: string }) {
  const [url] = useDatabaseImpl(`${appId}-url`, { initialValue: { url: "about:blank" } });
  const navSnap = useSnapshot(BrowserNavState);
  const nav = navSnap[appId] ?? { canGoBack: false, canGoForward: false, layout: "single" };
  const { canGoBack, canGoForward, layout } = nav;

  return (
    <>
      {/* Navigation Controls (Left) */}
      <div className={
        clsx(
          "flex items-center gap-1.5 pointer-events-auto",
        )
      }>
        <div
          onClick={() => { if (canGoBack) BrowserHandlers[appId]?.back?.(); }}
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
          onClick={() => { if (canGoForward) BrowserHandlers[appId]?.forward?.(); }}
          className={clsx(
            "flex items-center justify-center rounded-lg w-7 h-7 transition-colors",
            canGoForward
              ? "hover:bg-white/10 dark:hover:bg-white/5 cursor-pointer text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              : "opacity-40 cursor-not-allowed text-zinc-600"
          )}
        >
          <ArrowRight className="w-4 h-4" />
        </div>
        <div onClick={() => { BrowserHandlers[appId]?.refresh?.(); }} className="flex items-center justify-center rounded-lg w-7 h-7 hover:bg-white/10 dark:hover:bg-white/5 transition-colors cursor-pointer text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200">
          <RotateCw className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* Pill-shaped Address Bar (Middle) */}
      <div className="flex-1 px-4 pointer-events-none">
        {/^https?:\/\//.test(url.url) && <div
          style={{
            top: '2px'
          }}
          className={clsx(
            "absolute left-0 w-full h-7 rounded-full flex items-center justify-center px-3 gap-2 transition-all pointer-events-none",
          )}>
          <div
            onClick={() => { BrowserHandlers[appId]?.addressBarClick?.(); }}
            className={clsx(
              'text-center text-accent/50 hover:text-accent bg-[hsl(var(--bg))] hover:bg-card cursor-pointer w-100 text-xs rounded-lg  px-2 py-1 truncate pointer-events-auto',
            )}
          >
            {url.url}
          </div>
        </div>}
      </div>

      {/* Layout Controls (Right) */}
      <div className={clsx(
        'flex items-center gap-2 px-4 pointer-events-auto',
      )}>
        {layout !== "single" && <Columns3Cog
          onClick={() => {
            const activeElement = document.activeElement;
            const isInputFocused =
              activeElement instanceof HTMLInputElement ||
              activeElement instanceof HTMLTextAreaElement ||
              (activeElement instanceof HTMLElement && activeElement.isContentEditable);
            if (TabInfo.layout !== "single" && !isInputFocused) {
              TabInfo.switchMode = true;
              window.dispatchEvent(new CustomEvent('switchMode'));
            } else {
              TabInfo.switchMode = false;
              window.dispatchEvent(new CustomEvent('switchMode'));
            }
          }}
          className='text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer' size={14} />}
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
    </>
  );
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

  const [isFullscreen, setIsFullscreen] = useGlobal('isFullscreen', { initialValue: false });

  return (
    <div
      data-tauri-drag-region
      className={clsx(
        isFullscreen ? 'hidden' : 'flex',
        "w-full h-8 items-center justify-between select-none flex-shrink-0 z-20 px-2",
        "bg-[hsl(var(--bg))]",
        isRightToLeft ? "flex-row-reverse" : "flex-row"
      )}
    >

      {children ? children : <div className='flex-1'></div>}
      {/* Right Controls */}
      <div className={clsx(
        "flex items-center pointer-events-auto",
      )}>
        {/* Tauri Window buttons */}
        <div className={clsx(
          "flex items-center",
          isRightToLeft ? "flex-row-reverse" : "flex-row"
        )}>
          <button
            onClick={handleMinimize}
            className="flex items-center justify-center w-6 h-6 rounded-lg hover:bg-white/10 dark:hover:bg-white/5 transition-colors cursor-pointer text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
            aria-label="Minimize"
          >
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </button>
          <button
            onClick={handleMaximize}
            className="flex items-center justify-center w-6 h-6 rounded-lg hover:bg-white/10 dark:hover:bg-white/5 transition-colors cursor-pointer text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
            aria-label="Maximize"
          >
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
          </button>
          <button
            onClick={handleClose}
            className="flex items-center justify-center w-6 h-6 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-colors cursor-pointer text-zinc-400"
            aria-label="Close"
          >
            <div className="w-3 h-3 rounded-full bg-red-500" />
          </button>
        </div>
      </div>
    </div>
  );
}