import { Suspense, useEffect, useRef, useState, memo } from 'react'
import Sidebar from './components/sidebar'
import Topbar from './components/topbar'
import clsx from 'clsx'
import { AnimatePresence, motion, type Variants } from "motion/react"
import { useFileImpl } from './components/useFile'
import { ArrowLeftRight, Check, Copy, GitBranch, Globe, HardDrive, Key, Minus, Plus, Search, Settings, X, type LucideIcon } from 'lucide-react'
import useElementSize from './components/hooks/useElementSize'
import { Button } from './components/ui/button'
import uuidv4 from './utils/uuid'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  KeyState,
  TabInfo,
  TabState,
  Viewport,
  Workspace,
  Theme,
  MenuBar,
  addTab,
  closeTab,
  detachTab,
  type ITab,
  deleteTabWithGroupSelection
} from './utils/state'
import { proxy, useSnapshot } from 'valtio'
import MultiView, { type LayoutType } from './components/multiview'
import { Spinner } from './components/ui/spinner'
import React from 'react'
import ReactDOM from 'react-dom'
import DefaultPage from './components/default-page'
import { usePython, usePythonEvent } from './components/usePython'
import { useDatabaseImpl } from './components/useDatabase'
import useKeyEffect from './components/useKeyEffect'
// import { SelectWorkspace } from './components/select-workspace'
import AppLoading from './components/app-loading'
import { useFolderImpl } from './components/useFolder'
import type { AppInfo, Model } from './utils/utils'
import { sha256 } from 'js-sha256';
import { setGlobal, useGlobal } from './components/useGlobal'
import { useSettings } from './components/useSettings'
import { Dropdown } from './components/dropdown'
import { invoke } from '@tauri-apps/api/core';
import { Dialog as DialogUI, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog"
import { Editor, type OnMount } from "monaco";
import type * as Monaco from 'monaco-editor';
import { Toaster } from "./components/ui/sonner"

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;
// Enable iframe mirror debugging in development
if (typeof window !== 'undefined') {
  (window as any).React = React;
  (window as any).ReactDOM = ReactDOM;
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isDev) {
    import('./utils/iframe-mirror-debug').then(({ enableIframeMirrorDebugMode }) => {
      enableIframeMirrorDebugMode();
    }).catch(() => {
      // Silently fail if debug utils not available
    });
  }
}


// Component that uses the promise

const TabItem = React.memo(({ children, isOpened }: { children: React.ReactNode, isOpened: boolean }) => {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isOpened && !loaded) {
      setLoaded(true);
    }
  }, [isOpened])


  return <div className={clsx(
    "w-full h-full",
    !loaded && "bg-card"
  )}>
    {
      loaded ?
        children
        :
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"><Spinner /></div>
    }
  </div>;
});

export interface Tab {
  appname: string;
  data: any;
  App: React.ComponentType<AppInfo>
}

export interface DefaultTab {
  layout: LayoutType;
  icon: string;
  tabs: Tab[];
}

export interface Project {
  defaultTab: DefaultTab;
  appRegistry?: Record<string, React.ComponentType<AppInfo>>;
  iconRegistry?: Record<string, LucideIcon>;
  projectName: string;
  projectIcon: React.ComponentType;
  size?: number[];
  repository?: string;
}
import { hideSplashScreen } from "vite-plugin-splash-screen/runtime"

const composerVariants: Variants = {
  initial: { opacity: 0, y: 0, scale: 0.95 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: (custom: boolean) => custom
    ? { opacity: [1, 1, 0], scale: 0.85, transition: { duration: 0.3, ease: 'easeOut' } }
    : { opacity: 0, transition: { duration: 0 } }
};
import { AsyncLock, generateIdFromString, type IAgent, useMenuBar } from './index'
import { BrowserBar } from './Bar'
import { cursorPosition, getCurrentWindow, PhysicalPosition, PhysicalSize, Window as TauriWindow } from '@tauri-apps/api/window'
import Bar from './Bar'
import { getAllWebviews, getCurrentWebview, Webview } from '@tauri-apps/api/webview'
import type { ControllableBrowser } from './components/ControllableBrowsers'
import { isRegistered, register, unregister } from '@tauri-apps/plugin-global-shortcut'
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow'
import Chat from './components/chat'
import Composer, { type ScheduleInterval } from './components/composer'
import { toast } from 'sonner'
import { createWebview, sleep } from './utils'


export default function Container({ Apps }: { Apps: Project }) {
  if (Apps.defaultTab.tabs.length === 0) {
    throw new Error("Apps.defaultTab.tabs is empty");
  }

  (window as any).defaultLayout = Apps.defaultTab.layout;
  (window as any).defaultIcon = Apps.defaultTab.icon;
  (window as any).defaultTabs = Apps.defaultTab.tabs;
  (window as any).defaultIconRegistry = Apps.iconRegistry;
  (window as any).defaultSize = Apps.size || [50, 50, 50, 50, 50];
  const { pyInvoke, isStreamReady } = usePython();
  const pyInvokeRef = useRef(pyInvoke);
  pyInvokeRef.current = pyInvoke
  const { settings } = useSettings();
  const [startupStatus] = useState<any>(null);
  const workspace = "global";

  const appRegistry = proxy<Record<string, React.ComponentType<AppInfo>>>({
    ...(Apps.appRegistry || {}),
    ...Apps.defaultTab.tabs.reduce((acc: Record<string, React.ComponentType<AppInfo>>, t: any) => {
      acc[t.appname] = t.App;
      return acc;
    }, {})
  });
  const [mounted, setMounted] = useState(false);
  const [, setAnimateExit] = useState(false);
  const [selectedAgent, setSelectedAgent] = useDatabaseImpl<IAgent>("selected-agent", { initialValue: { name: null, id: null } });
  const [taskInterval, setTaskInterval] = useDatabaseImpl<ScheduleInterval>("taskInterval", { initialValue: 'once' });
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [, setShowSearchDialog] = useGlobal('showSearchDialog', { initialValue: false });
  const [, setShowMcpDialog] = useGlobal('showMcpDialog', { initialValue: false });
  const [isCreateTask, setIsCreateTask] = useGlobal('overlay-create-task', { initialValue: false });
  const [showCredentialsDialog, setShowCredentialsDialog] = useGlobal('showCredentialsDialog', { initialValue: false });
  const [showLocalModelDialog, setShowLocalModelDialog] = useGlobal('showLocalModelDialog', { initialValue: false });
  const [showCustomEndpointDialog, setShowCustomEndpointDialog] = useGlobal('showCustomEndpointDialog', { initialValue: false });
  const [showCodeDialog, setShowCodeDialog] = useGlobal('showCodeDialog', { initialValue: false });
  const [codeLanguage, setCodeLanguage] = useGlobal('codeLanguage', { initialValue: "text" });
  const [prevCode, setPrevCode] = useGlobal('prevCode', { initialValue: "" });
  const [code, setCode] = useGlobal('code', { initialValue: "" });
  const [codeId] = useGlobal('codeId', { initialValue: "" });
  const [isSaved, setIsSaved] = useState(false);
  const [isFullscreen, setIsFullscreen] = useGlobal('isFullscreen', { initialValue: false });
  const [isPlayingRegistry, setIsPlayingRegistry] = useGlobal<Record<string, boolean>>('isPlayingRegistry', { initialValue: {} });
  const [focus, setFocus] = useGlobal('focusOnApp', { initialValue: false })
  const focusRef = useRef(focus)
  focusRef.current = focus
  const codeIdRef = useRef(codeId);
  codeIdRef.current = codeId;

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const lastCodeUpdateRef = useRef<number>(0);
  const codeUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reparentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
  };


  const [, setMobileSettingsDropdown] = useGlobal('mobileSettingsDropdown', { initialValue: false });
  const [setupModel, setSetupModel] = useGlobal('setupModel', { initialValue: false });
  const [llamaCppOrMlxIsInstalled, setLlamaCppOrMlxIsInstalled] = useGlobal('llamaCppOrMlxIsInstalled', { initialValue: false });
  const [isInstalling, setIsInstalling] = useGlobal('isInstalling', { initialValue: false });
  const [isMobileSearching, setIsMobileSearching] = useGlobal('isMobileSearching', { initialValue: false });

  const handleMobileSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setIsMobileSearching(false); setMobileSearchText(''); }
  };

  const [browsers, , { ready }] = useDatabaseImpl<Record<string, ControllableBrowser>>('ControllableBrowser', { initialValue: {} });
  const snaptheme = useSnapshot(Theme);
  const currentLayout = snaptheme.layout;
  const [intializeTheme, setInitializeTheme] = useState(false);
  const [intializeBrowser, setInitializeBrowser] = useState(false);
  const isFirstSave = useRef(true);
  const { appId: activeBarAppId } = useMenuBar();

  const emptyRef = useRef<Webview | null>(null)
  const allRef = useRef<Webview[] | null>(null)
  const mainWindowRef = useRef<TauriWindow | null>(null)
  const mainWebviewRef = useRef<Webview | null>(null)
  // Tracks which browser UUIDs have already had their webview created + listeners attached.
  // Using a ref (not state) so updates don't trigger re-renders.
  const initializedBrowsersRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    (async () => {
      const r = await pyInvoke('check_backend')
      console.warn(r);
      setLlamaCppOrMlxIsInstalled(r.is_installed)
      setIsInstalling(r.is_installing)
    })()
  }, [])



  usePythonEvent('browser:open-new-tab', (data) => {
    if (typeof data === 'string' && /^https?:\/\//.test(data)) {
      addTab({
        uuid: uuidv4(),
        iconOverride: "Compass",
        layout: "single",
        childrenProps: {
          [uuidv4()]: {
            icon: "Compass",
            title: null,
            appname: "main-app",
            data: { url: data }
          }
        }
      });
    }
  })

  useEffect(() => {
    if (!ready) return;
    if (!intializeTheme) return;

    (async () => {
      if (!allRef.current) allRef.current = await getAllWebviews();
      if (!mainWindowRef.current) mainWindowRef.current = await getCurrentWindow();
      if (!mainWebviewRef.current) mainWebviewRef.current = await getCurrentWebview();

      await new Promise<void>((resolve) => {
        const check = () => {
          if (emptyRef.current) {
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      if (!emptyRef.current) return;


      const browserEntries = Object.entries(browsers);

      // Find only the UUIDs that haven't been initialized yet.
      // This handles both the initial load and browsers added at runtime.
      const newEntries = browserEntries.filter(([uuid]) => !initializedBrowsersRef.current.has(uuid));

      if (browserEntries.length === 0 || newEntries.length === 0) {
        // Nothing new to set up — mark as initialized if not already done.
        if (!intializeBrowser) setInitializeBrowser(true);
        return;
      }
      const size = await mainWebviewRef.current?.size();
      const position = await mainWebviewRef.current?.position();

      for (const [uuid, browser] of newEntries) {
        const label = `webview-${uuid}`;

        // Mark as initialized immediately so concurrent effect runs don't duplicate work.
        initializedBrowsersRef.current.add(uuid);

        if (!allRef.current?.find((wv) => wv.label === label)) {
          await createWebview(
            label,
            mainWindowRef.current,
            mainWebviewRef.current,
            emptyRef.current,
            {
              url: (browser.url && /^https?:\/\//.test(browser.url)) ? browser.url : 'about:blank',
              width: size?.width,
              height: size?.height,
              x: position?.x,
              y: position?.y,
            });
        }
      }

      if (!intializeBrowser) {
        await emptyRef.current?.reparent(mainWindowRef.current!)
        await sleep(50)
        await mainWebviewRef.current?.reparent(mainWindowRef.current!)
        window.dispatchEvent(new CustomEvent('refresh-webview-order'))
        setInitializeBrowser(true);
      }
    })();
  }, [browsers, intializeTheme, ready]);

  useEffect(() => {
    if (!mounted) return;
    (async () => {
      if (!allRef.current) allRef.current = await getAllWebviews();
      if (!mainWindowRef.current) mainWindowRef.current = await getCurrentWindow();
      if (!mainWebviewRef.current) mainWebviewRef.current = await getCurrentWebview();

      if (!allRef.current.find((wv) => wv.label === 'webview-empty')) {
        const position = await mainWebviewRef.current.position();
        const size = await mainWebviewRef.current.size();
        await AsyncLock.acquire();
        emptyRef.current = new Webview(mainWindowRef.current, 'webview-empty', {
          url: 'about:blank',
          width: size.width,
          height: size.height,
          x: position.x,
          y: position.y
        })
        await emptyRef.current.once('tauri://created', async () => {
          await sleep(50)
          await mainWebviewRef.current!.reparent(mainWindowRef.current!)
          AsyncLock.release()
        })
      }
    })()
  }, [mounted])

  useEffect(() => {
    if (!mounted) return;
    (async () => {
      if (!allRef.current) allRef.current = await getAllWebviews();
      if (!mainWindowRef.current) mainWindowRef.current = await getCurrentWindow();
      const webwin = await getCurrentWebviewWindow();
      webwin.onDragDropEvent((event) => {
        if (event.event == "tauri://drag-drop") {
          console.log(event.payload)
          window.dispatchEvent(new CustomEvent('drag_drop', { detail: event.payload }));
        }
      })
      mainWindowRef.current.onFocusChanged(async ({ payload: focused }) => {
        window.dispatchEvent(new CustomEvent('mainFocusChanged', { detail: focused }));
      });
      mainWindowRef.current.onMoved(() => {
        window.dispatchEvent(new CustomEvent('mainOnMove'));
      })
      mainWindowRef.current.onResized(() => {
        window.dispatchEvent(new CustomEvent('mainOnResize'));
      })
    })()
  }, [mounted])

  usePythonEvent('eval', async (data) => {
    if (data.label !== 'main') {
      await AsyncLock.run(async () => {
        await invoke('eval_in_webview', {
          label: data.label,
          script: data.script,
        });
      })
    }
  });

  usePythonEvent('update_console', async (data) => {
    if (data.target !== 'main') {
      await pyInvoke("update_console", data);
    }
  });

  usePythonEvent('backend-installed', async (data) => {
    if (data.success) {
      setLlamaCppOrMlxIsInstalled(true);
      setIsInstalling(false);
    }
  });


  useEffect(() => {
    (async () => {
      const res = await pyInvoke<{ os: string }>('os', {});
      if (res && 'os' in res && res.os) {
        const defaultLayout = res.os === "darwin" ? 'rightToLeft' : 'leftToRight';
        // 1. Ensure table exists first
        await pyInvoke("sqlite", {
          db: "global",
          table: "themes",
          command: "execute",
          sql: `CREATE TABLE IF NOT EXISTS themes (
          id      TEXT PRIMARY KEY,
          theme   TEXT,
          layout  TEXT
        )`,
          params: []
        });
        // 2. Query after table is guaranteed to exist
        const savedTheme = (await pyInvoke("sqlite", {
          db: "global",
          table: "themes",
          command: "query",
          sql: "SELECT * FROM themes"
        })).data as any[];
        // 3. Seed defaults if empty
        if (savedTheme.length === 0) {
          await pyInvoke("sqlite", {
            db: "global",
            table: "themes",
            command: "execute",
            sql: `INSERT OR REPLACE INTO themes (id, theme, layout) VALUES (?, ?, ?)`,
            params: [1, 'dark', defaultLayout]
          });
        }
        console.warn("Initial Theme :", savedTheme[0]?.theme, savedTheme[0]?.layout);
        // 4. Apply theme
        Theme.theme = savedTheme[0]?.theme ?? 'dark';
        Theme.layout = savedTheme[0]?.layout ?? defaultLayout;
      }
      setInitializeTheme(true);
    })();
  }, []);
  useEffect(() => {
    if (!intializeTheme) return;
    // Skip the first run caused by intializeTheme flipping to true,
    // because snaptheme hasn't caught up with the newly set Theme values yet.
    if (isFirstSave.current) {
      isFirstSave.current = false;
      return;
    }
    (async () => {
      await pyInvoke("sqlite", {
        db: "global",
        table: "themes",
        command: "execute",
        sql: `INSERT OR REPLACE INTO themes (id, theme, layout) VALUES (?, ?, ?)`,
        params: [1, snaptheme.theme, snaptheme.layout]
      });
      const savedTheme = await pyInvoke<{ theme?: string, layout?: string }>("sqlite", {
        db: "global",
        table: "themes",
        command: "query",
        sql: "SELECT * FROM themes"
      }) as { theme?: string, layout?: string };
      console.warn("Theme :", savedTheme);
    })();
  }, [snaptheme, intializeTheme]);
  const checkModel = async () => {
    const res: any = await pyInvoke<{ data?: Record<string, unknown> }>('file', {
      command: "read",
      filename: "config.json",
      base_dir: "python",
    });
    const config = res?.data?.content as string | undefined;
    if (!config) {
      setSetupModel(true);
      return;
    }
    const parsed = JSON.parse(config);
    if (!parsed.available_models) {
      setSetupModel(true);
      return;
    }
    if (Object.keys(parsed.available_models).length === 0) {
      setSetupModel(true);
      return;
    }
    setSetupModel(false);
  }
  useEffect(() => {
    (async () => await checkModel())()
    hideSplashScreen();
  },
    [])
  useEffect(() => {
    let __timeout: any;
    if (setupModel && (!showCredentialsDialog && !showCustomEndpointDialog && !showLocalModelDialog)) {
      __timeout = setTimeout(() => checkModel(), 100);
    }
    return () => {
      clearTimeout(__timeout);
    }
  },
    [setupModel, showCredentialsDialog, showCustomEndpointDialog, showLocalModelDialog])
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/get_plugin_dirs");
      const data = await res.json();
      (window as any).BASE_URL = data.BASE_URL;
      (window as any).PROJECT_ROOT = data.PROJECT_ROOT;
      (window as any).PYTHON_ROOT = data.PYTHON_ROOT;
      (window as any).BACKENDS_DIR = data.BACKENDS_DIR;
      (window as any).PIPELINES_DIR = data.PIPELINES_DIR;
      (window as any).TOOLS_DIR = data.TOOLS_DIR;
      (window as any).MODEL_PROVIDERS_DIR = data.MODEL_PROVIDERS_DIR;
      (window as any).SETTINGS_DIR = data.SETTINGS_DIR;
      (window as any).IS_MACOS = data.is_darwin;
      (window as any).IS_WINDOWS = data.is_windows;
      (window as any).IS_LINUX = data.is_linux;
    })();
  }, []);
  const [isSearchChatOpen, setIsSearchChatOpen] = useState(false);
  const searchRef = useRef<any>(null);
  const snaptabs = useSnapshot(TabState);
  const snaptabsRef = useRef(snaptabs)
  snaptabsRef.current = snaptabs
  const [tabs, setTabs] = useState<Record<string, React.ReactNode>>({});
  const { children, layout, active, SetActive } = useSnapshot(TabInfo);
  const activeRef = useRef(active)
  activeRef.current = active
  const actives = (() => {
    const keys = Object.keys(tabs);
    const defaults = ["default0", "default1", "default2", "default3"];
    if (!children || children.length === 0) {
      return [...defaults.map(d => keys.indexOf(d))];
    }
    const childIndices = children.map(child => keys.indexOf(child));
    const remaining = 4 - children.length;
    const defaultIndices = defaults
      .slice(-remaining)
      .map(d => keys.indexOf(d));
    return [...childIndices, ...defaultIndices]
  })();
  function AppInfoProps(appname: string, tabId: string, appId: string) {
    return {
      appname,
      mainWindowRef,
      mainWebviewRef,
      allRef,
      emptyRef,
      initializedBrowsersRef,
      useWorkspace: () => {
        return { workspace: "global" };
      },
      tabId,
      appId,
      settings: settings,
      useActiveTabId: () => {
        const { active } = useSnapshot(TabInfo);
        return active;
      },
      useTitle: () => {
        const _tabs = useSnapshot(TabState);
        return typeof _tabs[tabId]?.title === "string" ? _tabs[tabId]?.title : null;
      },
      setTitle: (title: string) => {
        if (TabState[tabId] && typeof TabState[tabId].childrenProps !== "undefined") TabState[tabId] = { ...TabState[tabId], title };
      },
      // here
      setIcon: (icon: string) => {
        if (TabState[tabId] && typeof TabState[tabId].childrenProps !== "undefined") TabState[tabId] = { ...TabState[tabId], iconOverride: icon };
      },
      useNotchVisible: () => {
        const slotIndex = children.indexOf(tabId);
        if (slotIndex === -1) return false;
        const { layout: _layout } = useSnapshot(Theme)
        const isRightToLeft = _layout === "rightToLeft";
        if (isRightToLeft) {
          // Top-Left corner
          switch (layout) {
            case "single": return slotIndex === 0;
            case "horizontal": return slotIndex === 0;
            case "vertical": return slotIndex === 0;
            case "grid2x2": return slotIndex === 0;
            case "triple": return slotIndex === 0;
            case "triple-left": return slotIndex === 0;
            case "triple-right": return slotIndex === 0;
            case "triple-top": return slotIndex === 0;
            case "triple-bottom": return slotIndex === 0;
            default: return false;
          }
        } else {
          // Top-Right corner
          switch (layout) {
            case "single": return slotIndex === 0;
            case "horizontal": return slotIndex === 1;
            case "vertical": return slotIndex === 0;
            case "grid2x2": return slotIndex === 1;
            case "triple": return slotIndex === 2;
            case "triple-left": return slotIndex === 1;
            case "triple-right": return slotIndex === 2;
            case "triple-top": return slotIndex === 0;
            case "triple-bottom": return slotIndex === 1;
            default: return false;
          }
        }
      },
      useTheme: () => {
        return useSnapshot(Theme);
      },
      useTab: () => {
        const _tabs = useSnapshot(TabState);
        return _tabs[tabId] as ITab ?? {};
      },
      addTab: (tabs: { app: string; data?: Record<string, any> }[] | { app: string; data?: Record<string, any> }, layout?: string) => {
        const childrenProps: Record<string, any> = {};
        const IDs = [];
        if (Array.isArray(tabs)) {
          tabs.forEach((tab) => {
            const id = uuidv4();
            IDs.push(id);
            childrenProps[id] = {
              title: null,
              appname: tab.app,
              icon: "default",
              data: tab.data || null
            };
          });
        } else {
          const id = uuidv4();
          const tab = tabs as { app: string; data?: Record<string, any> };
          IDs.push(id);
          childrenProps[id] = {
            title: null,
            appname: tab.app,
            icon: "default",
            data: tab.data || null
          };
        }
        const dummyKeys = ["default1", "default2", "default3"];
        let dummyIdx = 0;
        while (Object.keys(childrenProps).length < 4) {
          const dKey = dummyKeys[dummyIdx] || `default${dummyIdx + 1}`;
          childrenProps[dKey] = {
            icon: "default",
            title: null,
            appname: "select-tab",
            data: null,
          };
          dummyIdx++;
        }
        addTab({
          layout: layout ?? "single",
          childrenProps
        });
        return IDs;
      },
      closeTab: () => {
        closeTab(tabId);
      },
      detachTab: () => {
        detachTab(tabId);
      },
      useTabDatabase: <T,>(tb: string, options?: { initialValue?: T }) => {
        const hashed = generateIdFromString(tabId + "/" + tb);
        return useDatabaseImpl<T>(hashed, options);
      },
      useModel: () => {
        return useDatabaseImpl<Model>("selected-model", { initialValue: { name: null, id: null } });
      },
      useAgent: () => {
        return useDatabaseImpl<IAgent>("selected-agent", { initialValue: { name: null, id: null } });
      },
      getAvailableModels: async () => {
        try {
          const res = await pyInvoke<{ data?: Record<string, unknown>; error?: string }>('file', {
            command: "read",
            filename: "config.json",
            base_dir: "python"
          });
          if (res && typeof res === 'object' && 'data' in res) {
            const config = res.data?.content as string;
            if (config) {
              try {
                const parsed = JSON.parse(config);
                if (parsed.available_models) {
                  return parsed.available_models;
                }
              } catch (e) {
                console.error("File request failed", e);
              }
            }
          }
        } catch (e) {
          console.error("File request failed", e);
        }
        return {};
      },
      useTool: () => {
        return async (tool: string, parameters: Record<string, any>) => {
          return await pyInvoke("tools/execute", { tool, workspace: "global", tabId, ...parameters });
        }
      },
      useGlobal: <T,>(name: string, options?: { initialValue?: T }) => {
        return useGlobal(tabId + "_" + name, options);
      },
      useFile: (
        filename: string,
        options?: {
          initialValue?: string;
          baseDir?: string;
          width?: number;
          height?: number;
          quality?: number;
          bitrate?: string;
          resolution?: string;
          fps?: number;
          thumbnail?: boolean;
          thumb_time?: string;
          format?: string;
          download?: boolean;
        }
      ) => {
        return useFileImpl(filename, {
          ...options,
          baseDir: (options && options.baseDir) ? options.baseDir : "Storage/" + workspace + "/" + tabId + "/"
        });
      },
      useFolder: (
        path: string,
        { baseDir }: { baseDir?: string } = {}
      ) => {
        return useFolderImpl(path, { baseDir: baseDir ?? "Storage/" + workspace + "/" + tabId + "/" });
      },
      pyInvoke: <T,>(
        label: string,
        data?: Record<string, unknown> | ArrayBufferLike | Blob | ArrayBufferView,
        timeout?: number
      ) => {
        return pyInvoke<T>(label, data, timeout);
      }
    };
  }

  useEffect(() => {
    setTabs((prevTabs: any) => {
      const nextTabs = { ...prevTabs };
      let hasChanges = false;
      // Add new tabs
      Object.entries(snaptabs).forEach(([parentKey, parentValue]) => {
        if (parentValue.childrenProps) {
          Object.entries(parentValue.childrenProps).forEach(([key, value]) => {
            if (!nextTabs[key]) {
              const props: AppInfo = AppInfoProps(value.appname, parentKey, key);
              const AppComp = appRegistry[value.appname];
              const Component = AppComp || DefaultPage;
              const AppComponent = memo(
                Component as React.ComponentType<AppInfo>,
                (prev, next) =>
                  prev.appname === next.appname &&
                  prev.tabId === next.tabId &&
                  prev.appId === next.appId
              );
              nextTabs[key] = (
                <Suspense fallback={<div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"><Spinner /></div>}>
                  <AppComponent key={key} {...props} />
                </Suspense>
              );
              hasChanges = true;
            }
          })
        }
      });
      return hasChanges ? nextTabs : prevTabs;
    });
  }, [snaptabs]);

  useEffect(() => {
    if (Object.keys(snaptabs).length == 0) MenuBar.appId = ''
  }, [snaptabs])

  const prevMutedRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const prev = prevMutedRef.current;
    const next: Record<string, boolean> = {};

    const tasks = Object.entries(snaptabs).flatMap(([tabId, tab]) => {
      const muted = tab.isMuted ?? false;
      next[tabId] = muted;
      if (prev[tabId] === muted) return [];
      return (tab.children ?? []).map((childAppId) => {
        if (initializedBrowsersRef.current.has(childAppId)) invoke('set_webview_muted', { label: `webview-${childAppId}`, muted }).catch((e) => console.error(`Failed to mute ${childAppId}:`, e))
      }
      );
    });

    Promise.all(tasks).then(() => {
      prevMutedRef.current = next;
    });
  }, [snaptabs]);

  const isLastMaximizedRef = useRef<boolean>(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let fixing = false; // re-entrancy guard



    const checkFullscreen = async () => {
      if (fixing) return; // ignore events we caused ourselves
      await AsyncLock.acquire();

      try {
        const [full, maximized] = await Promise.all([
          win.isFullscreen(),
          win.isMaximized(),
        ]);

        if (full && maximized) {
          isLastMaximizedRef.current = true
          fixing = true;
          try {
            await win.setFullscreen(false);
            await sleep(50);
            await win.unmaximize();
            await sleep(50);
            await win.setFullscreen(true);
            await sleep(50);
          } finally {
            fixing = false;
          }
        } else {
          if (isLastMaximizedRef.current) {
            await win.maximize()
            isLastMaximizedRef.current = false
          }
        }

        console.warn("Fullscreen", full, { full, maximized });
        setIsFullscreen(full);
      } catch (e) {
        console.error(e);
      }

      AsyncLock.release();
    };

    window.addEventListener('resize', checkFullscreen);
    window.addEventListener('fullscreenchange', checkFullscreen);
    window.addEventListener('fullscreen_changed', checkFullscreen);
    return () => {
      window.removeEventListener('resize', checkFullscreen);
      window.removeEventListener('fullscreenchange', checkFullscreen);
      window.removeEventListener('fullscreen_changed', checkFullscreen);
    };
  }, []);

  useEffect(() => {
    setMounted(true);

    const handleGlobalClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const chip = target.closest('[data-img="true"]');
      if (chip && !target.closest('[data-rm-chip="true"]')) {
        const url = chip.getAttribute('data-url') || '';
        const source = chip.getAttribute('data-source') || '';
        if (url && source) {
          e.stopPropagation();
          const path = url.startsWith('/file/') ? decodeURIComponent(url.slice(6)) : url;
          try {
            const r = await pyInvoke('file', {
              command: 'exists',
              filename: path,
            })
            if (r.data && r.data.exists) {
              revealItemInDir(path)
              toast("File revealed", {
                position: 'bottom-right',
                description: <div className='flex flex-col'>
                  <span className='truncate w-[300px]'>Path: {path} </span>
                </div>,
              })
            } else {
              throw new Error("File does not exist")
            }

          } catch (e) {
            console.error(e)
            toast("Failed to reveal file", {
              position: 'bottom-right',
              description: <div className='flex flex-col pointer-events-none relative w-full select-none'>
                <span className='truncate w-[300px]'>Path: {path} </span>
                <span>{String(e)}</span>
              </div>,
            })
          }
        }
      }
    };
    document.addEventListener('click', handleGlobalClick);
    return () => {
      document.removeEventListener('click', handleGlobalClick);
    };
  }, []);

  useEffect(() => {
    (async () => {
      await pyInvoke('set_active', {
        workspace: workspace || "global",
        tab_id: active.length > 0 ? active : "global",
      })
    })()
  }, [workspace, active])

  useEffect(() => {
    (async () => {
      if (isFullscreen) await mainWindowRef.current?.setFullscreen(false)
    })()
  }, [active])

  useKeyEffect(() => {
    (async () => {
      const now = Date.now();
      if (now - lastDeleteTimeRef.current < 200) {
        return;
      }
      try {
        lastDeleteTimeRef.current = now;
        (async () => {
          if (activeRef.current) {
            const db = workspace;
            const initTb = generateIdFromString(activeRef.current + "/" + "message_state");
            await AsyncLock.acquire();
            const res = await pyInvoke("sqlite", {
              db: db,
              table: initTb,
              command: "query",
              sql: `SELECT id, _v FROM ${initTb} WHERE id IN ('isStreaming', 'activeId', 'dontStop')`
            });
            const rows = res?.data ?? (Array.isArray(res) ? res : []);
            if (Array.isArray(rows)) {
              let isStreaming = false;
              let dontStop = false;
              let activeId = "";
              rows.forEach((row: any) => {
                let val = row._v;
                if (typeof val === 'string') {
                  try {
                    val = JSON.parse(val);
                  } catch { }
                }
                if (row.id === 'isStreaming') {
                  isStreaming = !!val;
                } else if (row.id === 'activeId') {
                  activeId = String(val || "");
                } else if (row.id === 'dontStop') {
                  dontStop = !!val;
                }
              });
              if (isStreaming && activeId && !dontStop) {
                await pyInvoke("v1/chat/stop", { id: activeId });
              }
            }
            AsyncLock.release();
            await deleteTabWithGroupSelection(activeRef.current);
          }
        })()
      } catch (Err) {
        console.error("Error deleting tab:", Err);
      }
    })()
  }, ["control", "w"])

  useKeyEffect(() => {
    setIsCreateTask(true);
  }, ["control", "t"])

  useKeyEffect(() => {
    setIsCreateTask(false);
  }, ["escape"])

  const lastDeleteTimeRef = useRef<any>(null);

  usePythonEvent("delete-tab", (data) => {
    const now = Date.now();
    if (now - lastDeleteTimeRef.current < 80) {
      return;
    }
    try {
      lastDeleteTimeRef.current = now;
      (async () => { await deleteTabWithGroupSelection(active); })()
    } catch (Err) {
      console.error("Error deleting tab:", Err);
    }
  })


  useEffect(() => {
    if (mounted) {
      if (snaptheme.theme === "dark") {
        document.documentElement.className = "dark"
      } else if (snaptheme.theme === "light") {
        document.documentElement.className = "";
      }
    }
  }, [mounted, snaptheme.theme])
  useEffect(() => {
    if (!mounted) return;
    // Input
    function onKeyDown(event: KeyboardEvent) {
      KeyState.setKey(event.key.toLowerCase(), true);
      KeyState.setCtrl(event.ctrlKey);
      KeyState.setShift(event.shiftKey);
      KeyState.setAlt(event.altKey);
      if (event.ctrlKey && event.key >= '1' && event.key <= '9') {

      }
      // Block F12
      if (event.key === 'F12') {
        event.preventDefault();
      }
      // Block Ctrl+Shift+I (Windows/Linux) or Cmd+Option+I (Mac)
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'I' || event.key === 'i')) {
        console.warn("Ctrl+Shift+I or Cmd+Option+I pressed")
        event.preventDefault();
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      KeyState.setKey(event.key.toLowerCase(), false);
      KeyState.setCtrl(event.ctrlKey);
      KeyState.setShift(event.shiftKey);
      KeyState.setAlt(event.altKey);
    }
    function onBlur() {
      KeyState.clearKeys();
    }
    const blockContextMenu = (e: MouseEvent) => {
      // const target = e.target as HTMLElement;
      // const isEditable =
      //   target instanceof HTMLInputElement ||
      //   target instanceof HTMLTextAreaElement ||
      //   !!target.closest('[contenteditable]');   // catches nested contenteditable too
      // if (!isEditable) e.preventDefault();
    };

    const onCodeUpdate = (e: Event) => {
      const data = (e as CustomEvent).detail;
      const editor = editorRef.current;
      if (data.codeId === codeIdRef.current && data.code && editor) {
        const now = Date.now();
        const elapsed = now - lastCodeUpdateRef.current;

        const applyUpdate = () => {
          lastCodeUpdateRef.current = Date.now();
          setCode(data.code);
          setPrevCode(data.code);
          const lineCount = editor.getModel()?.getLineCount() ?? 0;
          editor.revealLine(lineCount, 1); // 1 = ScrollType.Immediate
        };

        if (elapsed >= 1000) {
          if (codeUpdateTimerRef.current) {
            clearTimeout(codeUpdateTimerRef.current);
            codeUpdateTimerRef.current = null;
          }
          applyUpdate();
        } else {
          if (codeUpdateTimerRef.current) {
            clearTimeout(codeUpdateTimerRef.current);
          }
          codeUpdateTimerRef.current = setTimeout(applyUpdate, 1000 - elapsed);
        }
      }
    }

    const onReportAudioState = (_event: any) => {
      const data = _event.detail as any
      if (!data.label) return;
      console.warn("report audio", data)

      const label = data.label;
      const key = label.replace("webview-", "");
      const tabId = Object.keys(TabState).find((id) => TabState[id].children.includes(key));

      if (tabId && TabState[tabId]) {
        setIsPlayingRegistry((prev: Record<string, boolean>) => ({ ...prev, [tabId]: data.playing ?? false }))
      }
    }

    const updateCdpPorts = async () => {
      await AsyncLock.acquire();
      try {
        allRef.current = await getAllWebviews();
        const cdp_ports = await invoke('get_cdp_ports');
        console.warn("cdp_ports", cdp_ports);
        if (pyInvokeRef.current) {
          await pyInvokeRef.current("update_cdp_ports", {
            cdp_ports
          })
        }
      } catch (e) {
        console.error(e)
      } finally {
        AsyncLock.release();
      }
    }

    const onSwitchTab = (event: any) => {
      const data = event.detail;
      if (!data) return;
      const tabIndex = data.tab_index;

      const tabEntries = Object.entries(TabState);
      const pinned = tabEntries.filter(([_, tab]) => tab.group === 'pinned');
      const nonPinned = tabEntries.filter(([_, tab]) => tab.group !== 'pinned');
      const orderedTabs = [...pinned, ...nonPinned];

      if (orderedTabs.length === 0) return;

      let targetIndex = tabIndex;
      if (tabIndex === -1) {
        targetIndex = orderedTabs.length - 1;
      }

      if (targetIndex >= 0 && targetIndex < orderedTabs.length) {
        const [tabId] = orderedTabs[targetIndex];
        TabInfo.SetActive(tabId);
      }
    };

    const onFocusApp = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && !target.closest('.browser-tab') && !target.closest('.resize-handle')) {
        setFocus(false);
      }
    }

    // true = capture phase → fires before ANY child handler
    window.addEventListener('switch_tab', onSwitchTab)
    window.addEventListener('report_audio_state', onReportAudioState)
    window.addEventListener('mousemove', onFocusApp);
    window.addEventListener('contextmenu', blockContextMenu);
    window.addEventListener('update_cdp_ports', updateCdpPorts);
    document.addEventListener('code-block-update', onCodeUpdate);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener('switch_tab', onSwitchTab)
      window.removeEventListener('report_audio_state', onReportAudioState)
      window.removeEventListener('mousemove', onFocusApp);
      window.removeEventListener('contextmenu', blockContextMenu);
      window.removeEventListener('update_cdp_ports', updateCdpPorts);
      document.removeEventListener('code-block-update', onCodeUpdate);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (codeUpdateTimerRef.current) {
        clearTimeout(codeUpdateTimerRef.current);
        codeUpdateTimerRef.current = null;
      }
    };
  }, [mounted]);
  // Mobile bottom bar search  
  const [mobileSearchText, setMobileSearchText] = useState('');
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const [vieweportRef, { width: viewportWidth, height: viewportHeight, overflowX: viewportOverflowX, overflowY: viewportOverflowY, aspectRatio: viewportAspectRatio }] = useElementSize<HTMLDivElement>();
  useEffect(() => {
    Viewport.width = viewportWidth;
    Viewport.height = viewportHeight;
    Viewport.overflowX = viewportOverflowX;
    Viewport.overflowY = viewportOverflowY;
    Viewport.aspectRatio = viewportAspectRatio;
  }, [viewportWidth, viewportHeight, viewportOverflowX, viewportOverflowY, viewportAspectRatio])
  const [warmup, setWarmup] = useState(true);
  useEffect(() => {
    if (isStreamReady && intializeTheme) {
      setTimeout(() => {
        setWarmup(false);
      }, 100)
    }
  },
    [isStreamReady, intializeTheme]);
  if (!intializeTheme || !intializeBrowser) {
    return <AppLoading status={startupStatus} />
  }

  return (
    <div className='overflow-hidden'>
      <style>{`
                html, body {
                    background: transparent !important;
                }
      `}</style>
      <div
        contentEditable
        style={{
          zIndex: -99999,
        }}
        className='opacity-0 absolute select-none pointer-events-none overflow-hidden'
      />

      <Toaster
        theme={snaptheme.theme === 'dark' ? 'dark' : 'light'}
        position="bottom-right"
        style={{ '--toast-z-index': '2147483647' } as React.CSSProperties}
      />
      <DialogUI open={showCodeDialog} onOpenChange={setShowCodeDialog}>
        <DialogContent
          onKeyDown={(e) => {
            if (e.key.toLowerCase() === 's' && e.ctrlKey && editorRef.current && codeId.startsWith('editable')) {
              const c = editorRef.current.getValue();
              setPrevCode(c);
              setIsSaved(true);
              setTimeout(() => setIsSaved(false), 2000);
              window.dispatchEvent(new CustomEvent('code-block-saved', {
                detail: {
                  codeId: codeId,
                  code: c,
                }
              }))
            }
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
          }} className="max-w-[90vw] w-[90vw] h-[90vh] flex flex-col pb-4">
          <DialogHeader>
            <DialogTitle></DialogTitle>
          </DialogHeader>
          <div className=" p-4 w-full h-full overflow-auto rounded-lg flex flex-col">
            {codeId.startsWith('editable') && <div className='absolute left-6 top-6 z-10'>
              <div onClick={(e) => {
                if (!editorRef.current) return;
                const c = editorRef.current.getValue();
                setPrevCode(c);
                setIsSaved(true);
                setTimeout(() => setIsSaved(false), 2000);
                window.dispatchEvent(new CustomEvent('code-block-saved', {
                  detail: {
                    codeId: codeId,
                    code: c,
                  }
                }))
              }} className='flex items-center gap-2 cursor-pointer pointer-events-auto select-none overflow-hidden'>
                <AnimatePresence mode='wait' initial={false}>
                  {isSaved ? (
                    <motion.div
                      key='saved'
                      className='flex items-center gap-2'
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                    >
                      <Check className='w-3.5 h-3.5 text-green-400' strokeWidth={2.5} />
                      <span className='text-green-400 text-sm font-medium'>Saved</span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key='unsaved'
                      className={clsx(
                        'flex items-center gap-2 transition-all'
                      )}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: prevCode == code ? 0 : 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                    >
                      <div className='w-3 h-3 rounded-full bg-accent' />
                      <span className='text-gray-500 dark:text-gray-400 text-sm'>Unsaved</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>}
            <Editor
              onChange={(v) => {
                if (codeId.startsWith('editable')) setCode(v || "");
              }} onMount={handleMount} className="w-full flex-1 font-mono border pt-2" theme="vs-dark" language={codeLanguage} options={{
                scrollBeyondLastLine: false,
                mouseWheelZoom: true,
                wordWrap: 'on',
              }} value={prevCode} />
          </div>
        </DialogContent>
      </DialogUI>

      <motion.div
        key="composer-overlay"
        animate={isCreateTask
          ? { opacity: 1, scale: 1, pointerEvents: 'auto' as const }
          : { opacity: 0, scale: 0.95, pointerEvents: 'none' as const }
        }
        initial={{ opacity: 0, scale: 0.95, pointerEvents: 'none' as const }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={clsx(
          'w-full h-full absolute',
          isCreateTask && 'bg-black/90'
        )}
        style={{ zIndex: 50, visibility: isCreateTask ? 'visible' : 'hidden' }}
      >
        <div className='w-full h-full flex items-center justify-center'>
          <div onClick={() => {
            setIsCreateTask(false);
            setAnimateExit(false);
          }} className='w-full h-full absolute top-0 left-0 bg-transparent'>

          </div>
          <Composer
            name={'task'}
            tabId={'task'}
            activeId={isCreateTask ? 'task' : 'task-inactive'}
            showModelSelection={true}
            showInterval={true}
            showHeader={false}
            workspace={workspace}
            agent={selectedAgent}
            setAgent={setSelectedAgent}
            selectionMode={'agent'}
            interval={taskInterval}
            onIntervalChange={setTaskInterval}
            onSubmit={async (value: string) => {
              console.log(value);
              setAnimateExit(true);
              setIsCreateTask(false);
              const taskId = uuidv4()
              const db = workspace ?? 'global';
              const sql = `INSERT OR REPLACE INTO tasks (id, metadata) VALUES (?, ?)`;
              await pyInvoke("sqlite", {
                db,
                command: "execute",
                sql: `CREATE TABLE IF NOT EXISTS tasks (
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
                  taskId,
                  JSON.stringify({
                    icon: 'AlarmClockCheck',
                    query: value,
                    interval: taskInterval,
                    agent: selectedAgent?.id,
                    timestamp: Date.now(),
                  })
                ]
              });
              if (taskInterval !== 'disabled' && taskInterval !== 'once') {
                const branch = sha256("0").slice(0, 32);
                const tbRaw = "msg_" + branch + "_0";
                // Note: do NOT pre-hash tbRaw — the backend hashes it as
                // generateIdFromString(tab_id + "/" + tb), matching MessageContainer's useDatabase.
                const branchId = sha256(branch).slice(0, 32);
                const branchIndex = 0;
                const activeId = taskId + "_response_" + branchId + "_0_" + branchIndex;

                const initTb = generateIdFromString(taskId + "/" + "message_state");

                let initialValue = {
                  title: { _v: taskId },
                  activeId: { _v: activeId },
                  errorMsg: { _v: "" },
                  initialized: { _v: true },
                  isStreaming: { _v: true },
                  context: { _v: "" },
                  dontStop: { _v: true },
                  isRead: { _v: false },
                }

                await pyInvoke("sqlite", {
                  db, table: initTb, command: 'sync_table', data: initialValue
                });

                let errorlog: string | null = null;
                if (selectedAgent?.id && value.trim().length > 0) {
                  try {
                    const streamRes = await pyInvoke("v1/chat/completions", {
                      id: activeId,
                      query: value,
                      stream: true,
                      agent: selectedAgent?.id,
                      tab_id: taskId,
                      branch_id: branchId,
                      index: branchIndex,
                      response_branch: 0,
                      tb: tbRaw,
                      workspace: db,
                      app_name: "",
                      pipeline: settings["Others/app_settings/string.pipeline"]?.value || "openchad/chat"
                    });
                    if (streamRes && typeof streamRes === 'object' && Symbol.asyncIterator in streamRes) {
                      for await (const _ of streamRes as any) { /* consume stream */ }
                    }
                  } catch (error) {
                    errorlog = JSON.stringify(error);
                  } finally {
                    await pyInvoke("sqlite", {
                      db, table: initTb, command: 'sync_table', data: {
                        ...initialValue,
                        ...(errorlog && { errorMsg: errorlog }),
                        isStreaming: { _v: false },
                        activeId: { _v: "" }
                      }
                    });
                  }
                } else {
                  await pyInvoke("sqlite", {
                    db, table: initTb, command: 'sync_table', data: {
                      ...initialValue,
                      errorMsg: { _v: "No Agent Selected" },
                      isStreaming: { _v: false },
                      activeId: { _v: "" }
                    }
                  });
                }
              }
            }}
            width={1920}
            height={1080}
            isStreaming={false}
            style={{ maxWidth: `100vw` }}
            ref={composerRef}
            maxHeight={'90vh'}
            className={clsx(
              "w-[768px] mx-auto z-30",
              'relative',
            )}
          />
        </div>
      </motion.div>
      <motion.div
        animate={{
          opacity: isSearchChatOpen ? 1 : 0,
          scale: isSearchChatOpen ? 1 : 0.9,
          translateX: "-50%",
          translateY: "-50%",
        }}
        initial={{
          opacity: 0,
          scale: 0.9,
          translateX: "-50%",
          translateY: "-50%",
        }}
        transition={{
          duration: 0.2,
          ease: "easeOut"
        }}
        ref={searchRef} className={
          clsx(
            "shadow-xl fixed w-[750px] bg-[hsl(var(--chat-bubble))] top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 origin-center z-10 border-[1px] rounded-xl border-solid border-[hsl(var(--border))]",
            isSearchChatOpen ? 'pointer-events-auto' : 'pointer-events-none',
          )
        }>
        <button
          onClick={() => {
            setIsSearchChatOpen(false);
          }}
          className='w-[40px] h-[40px] absolute top-[10px] right-[10px] rounded-full flex justify-center items-center p-2'>
          <X />
        </button>
        <input className='w-full p-5 bg-[transparent] border-[0px] border-b-[1px] border-[hsl(var(--border))] focus:outline-none' type="text" placeholder="Search chats..." />
        <div className='w-full h-[400px] overflow-y-auto'>
          <div className='w-full h-[800px]'></div>
        </div>
      </motion.div>
      <div ref={vieweportRef}
        className={clsx(
          "flex h-screen overflow-hidden",
          currentLayout === "rightToLeft" && 'flex-row-reverse',
        )}
      >


        <div data-tauri-drag-region className='absolute w-full h-8 top-0 left-0'>

        </div>
        <aside className={clsx(
          "items-start bg-[hsl(var(--bg))] relative z-10",
          isFullscreen ? 'hidden' : 'hidden md:flex'
        )}>
          {/* <VerticalTab menus={menus} /> */}
          <Sidebar
            projectName={Apps.projectName}
            ProjectIcon={Apps.projectIcon}
            workspace={workspace}
            layout={snaptheme.layout}
            theme={snaptheme.theme}
            settings={settings}
            isPlayingRegistry={isPlayingRegistry}
            {...(Apps.repository && { repository: Apps.repository })}
          />
        </aside>
        <div
          className="flex w-full relative h-full" style={
            {
              boxShadow: "var(--kotakshadow)",
            }
          }>
          {/*  */}
          <div className={clsx(
            "w-full overflow-hidden flex flex-col",
            "h-[calc(100%)] md:h-full",
          )}>
            <Bar theme={snaptheme.theme} isRightToLeft={currentLayout === "rightToLeft"}>
              {activeBarAppId ? <BrowserBar appId={activeBarAppId} /> : null}
            </Bar>
            <div
              id="app"
              className={
                clsx(
                  "flex flex-1",
                  "relative w-full border-[0px] border-solid border-[hsl(var(--chat-border))]",
                  !isFullscreen && "border-t-[1px]",
                  !isFullscreen && (currentLayout === "rightToLeft" ? 'border-r-[1px]' : 'border-l-[1px]'),
                )
              }>

              {
                Object.keys(snaptabs).length == 0 && (
                  <div className="w-full h-full flex items-center justify-center bg-card">
                    {warmup ? <div>
                      <Spinner />
                    </div> : <Button onClick={() => {
                      addTab();
                    }}>
                      <Plus />
                      New Tab
                    </Button>}
                  </div>
                )
              }
              <div className={clsx(
                "relative overflow-hidden ",
                "flex-1",
              )}>
                {Object.keys(snaptabs).length > 0 && <MultiView actives={actives} className='relative top-0 left-0' layout={layout as LayoutType}>
                  {Object.keys(tabs).map((key, index) => (
                    <TabItem key={key} isOpened={actives.includes(index)}>
                      {tabs[key]}
                    </TabItem>
                  ))
                  }
                </MultiView>}
              </div>
            </div>
            <div className='w-full flex md:hidden h-[50px] bg-[hsl(var(--bg))] gap-2 items-center justify-center border-t border-[hsl(var(--chat-border))] px-3'>
              {isMobileSearching && (
                <div
                  className='fixed inset-0 z-0'
                  onClick={() => { setIsMobileSearching(false); setMobileSearchText(''); }}
                />
              )}
              <div className='relative flex-1 z-10'>
                {isMobileSearching && (
                  <>
                    {Object.keys(snaptabs).length > 0 ? (
                      <div className='fixed w-[98vw] mx-1 bottom-[50px] left-0 right-0 bg-[hsl(var(--bg))] border border-[hsl(var(--chat-border))] rounded-xl overflow-hidden z-20'>
                        {Object.entries(snaptabs).filter(([, item]) => (item.title || "Untitled").toLowerCase().includes(mobileSearchText.toLowerCase())).map(([key, item], i) => (
                          <div
                            onClick={() => {
                              SetActive(key)
                              setIsMobileSearching(false);
                            }}
                            key={i}
                            className='flex items-center gap-2 px-3 py-2 hover:bg-[hsl(var(--hover))] cursor-pointer'
                            onMouseDown={e => { e.preventDefault(); }}
                          >
                            <div className='p-1 bg-white/10 rounded-lg'>
                              {item.icon({ className: 'w-4 h-4' })}
                            </div>
                            <span className='text-sm'>{item.title || "Untitled"}</span>
                          </div>
                        ))}
                      </div>
                    ) : <div className="fixed w-[98vw] mx-1 p-2 text-center text-gray-500 bottom-[50px] left-0 right-0 bg-[hsl(var(--bg))] border border-[hsl(var(--chat-border))] rounded-xl overflow-hidden z-20">
                      No results found
                    </div>}
                  </>
                )}
                <div
                  className='flex items-center h-[35px] bg-card hover:bg-[hsl(var(--hover))] transition-colors rounded-xl border border-[hsl(var(--chat-border))] cursor-text'
                  onClick={() => {
                    if (!isMobileSearching) {
                      setIsMobileSearching(true);
                      setTimeout(() => mobileSearchInputRef.current?.focus(), 0);
                    }
                  }}
                >
                  <div className='px-2 flex-shrink-0'>
                    <div className='p-1 bg-white/10 rounded-lg'>
                      {isMobileSearching
                        ? <Search className='w-4 h-4' />
                        : TabInfo.icon({ className: "w-4 h-4" })
                      }
                    </div>
                  </div>
                  {isMobileSearching ? (
                    <input
                      ref={mobileSearchInputRef}
                      className='flex-1 bg-transparent outline-none text-sm min-w-0 pr-2'
                      value={mobileSearchText}
                      onChange={e => setMobileSearchText(e.target.value)}
                      onKeyDown={handleMobileSearchKeyDown}
                      placeholder={snaptabs[active]?.title || "Untitled"}
                    />
                  ) : (
                    <span className='flex-1 text-sm truncate'>{(active && snaptabs[active]?.title) ? snaptabs[active].title || "Untitled" : "Untitled"}</span>
                  )}
                </div>
              </div>
              <div
                onClick={() => {
                  setShowSearchDialog(true)
                }}
                className=' hover:bg-[hsl(var(--hover))] border border-transparent hover:border-[hsl(var(--chat-border))] p-1 rounded-lg z-10'>
                <Copy className='w-5 h-5 scale-x-[-1]' />
              </div>
              <div
                onClick={() => {
                  addTab()
                }}
                className='hover:bg-[hsl(var(--hover))] border border-transparent hover:border-[hsl(var(--chat-border))] p-1 rounded-lg z-10'>
                <Plus className='w-5 h-5' />
              </div>
              <Dropdown
                onOpenChange={setMobileSettingsDropdown}
                content={[
                  ...(typeof window !== 'undefined' && !!(window as any).__TAURI__) ? [{
                    content: <div> Local Models </div>,
                    shortcut: <HardDrive size={16} />,
                    children: null,
                    separator: false,
                    trigger: async () => {
                      setShowLocalModelDialog(true);
                    }
                  }] : [],
                  {
                    content: <div> Credentials </div>,
                    shortcut: <Key size={16} />,
                    children: null,
                    separator: false,
                    trigger: () => {
                      setShowCredentialsDialog(true);
                    }
                  },
                  {
                    content: <div> Custom Endpoints </div>,
                    shortcut: <Globe size={16} />,
                    children: null,
                    separator: false,
                    trigger: () => {
                      setShowCustomEndpointDialog(true);
                    }
                  },
                  {
                    content: <div> MCP Servers </div>,
                    shortcut: <svg fill="currentColor" fillRule="evenodd" height="1.25em" viewBox="0 0 24 24" width="1.25em" xmlns="http://www.w3.org/2000/svg">
                      <title>ModelContextProtocol</title>
                      <path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z" />
                      <path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z" /></svg>,
                    children: null,
                    separator: false,
                    trigger: () => {
                      setShowMcpDialog(true);
                    }
                  },
                  {
                    content: <div> Dark Theme </div>,
                    shortcut: snaptheme.theme === "dark" ? <div>On</div> : <div>Off</div>,
                    children: null,
                    separator: false,
                    trigger: () => {
                      Theme.theme = snaptheme.theme === "dark" ? "light" : "dark";
                    }
                  },
                  {
                    content: <div> Layout </div>,
                    shortcut: snaptheme.layout === "leftToRight" ? <div>Left To Right</div> : <div>Right To Left</div>,
                    children: null,
                    separator: false,
                    trigger: () => {
                      Theme.layout = snaptheme.layout === "leftToRight" ? "rightToLeft" : "leftToRight";
                    }
                  },
                  {
                    content: <div> View Repository </div>,
                    shortcut: <GitBranch size={16} />,
                    children: null,
                    separator: false,
                    trigger: () => {
                      if (isTauri) {
                        openUrl(Apps.repository || 'https://github.com/openchad/openchad')
                      } else {
                        window.open(Apps.repository || 'https://github.com/openchad/openchad', '_blank')
                      }
                    }
                  },
                  {
                    content: <div> Join Our Discord </div>,
                    shortcut: <svg className="cursor-pointer rounded-full w-4 h-4 flex items-center overflow-hidden relative" width="64px" height="64px" viewBox="0 -28.5 256 256" version="1.1" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid" fill="#000000">
                      <g id="SVGRepo_bgCarrier" />
                      <g id="SVGRepo_tracerCarrier" />
                      <g id="SVGRepo_iconCarrier"> <g>
                        <path d="M216.856339,16.5966031 C200.285002,8.84328665 182.566144,3.2084988 164.041564,0 C161.766523,4.11318106 159.108624,9.64549908 157.276099,14.0464379 C137.583995,11.0849896 118.072967,11.0849896 98.7430163,14.0464379 C96.9108417,9.64549908 94.1925838,4.11318106 91.8971895,0 C73.3526068,3.2084988 55.6133949,8.86399117 39.0420583,16.6376612 C5.61752293,67.146514 -3.4433191,116.400813 1.08711069,164.955721 C23.2560196,181.510915 44.7403634,191.567697 65.8621325,198.148576 C71.0772151,190.971126 75.7283628,183.341335 79.7352139,175.300261 C72.104019,172.400575 64.7949724,168.822202 57.8887866,164.667963 C59.7209612,163.310589 61.5131304,161.891452 63.2445898,160.431257 C105.36741,180.133187 151.134928,180.133187 192.754523,160.431257 C194.506336,161.891452 196.298154,163.310589 198.110326,164.667963 C191.183787,168.842556 183.854737,172.420929 176.223542,175.320965 C180.230393,183.341335 184.861538,190.991831 190.096624,198.16893 C211.238746,191.588051 232.743023,181.531619 254.911949,164.955721 C260.227747,108.668201 245.831087,59.8662432 216.856339,16.5966031 Z M85.4738752,135.09489 C72.8290281,135.09489 62.4592217,123.290155 62.4592217,108.914901 C62.4592217,94.5396472 72.607595,82.7145587 85.4738752,82.7145587 C98.3405064,82.7145587 108.709962,94.5189427 108.488529,108.914901 C108.508531,123.290155 98.3405064,135.09489 85.4738752,135.09489 Z M170.525237,135.09489 C157.88039,135.09489 147.510584,123.290155 147.510584,108.914901 C147.510584,94.5396472 157.658606,82.7145587 170.525237,82.7145587 C183.391518,82.7145587 193.761324,94.5189427 193.539891,108.914901 C193.539891,123.290155 183.391518,135.09489 170.525237,135.09489 Z" fill="currentColor" fillRule="nonzero"> </path> </g> </g>
                    </svg>,
                    children: null,
                    separator: false,
                    trigger: () => {
                      if (isTauri) {
                        openUrl('https://discord.gg/JWeqhecqBD')
                      } else {
                        window.open('https://discord.gg/JWeqhecqBD', '_blank')
                      }
                    }
                  },
                ]}>
                <div className='hover:bg-[hsl(var(--hover))] border border-transparent hover:border-[hsl(var(--chat-border))] p-1 rounded-lg z-10'>
                  <Settings className='w-5 h-5' />
                </div>
              </Dropdown>
            </div>
          </div>

        </div>
      </div>
      {setupModel && <>
        <div className='fixed w-[100vw] h-[100vh] left-0 top-0 z-50 bg-black/50 flex items-center justify-center'>
          <div className='w-[520px] bg-card border border-[hsl(var(--chat-border))] rounded-lg shadow-2xl flex flex-col overflow-hidden'>
            {/* Header */}
            <div className='px-6 pt-6 pb-4 border-b border-[hsl(var(--chat-border))]'>
              <h1 className='text-lg font-semibold font-funnel tracking-tight'>Setup Model</h1>
              <p className='text-sm text-muted-foreground mt-0.5'>
                Choose how you want to run your AI model
              </p>
            </div>
            {/* Options */}
            <div className='flex flex-col gap-3 p-6'>
              {/* Local Model */}
              <div
                onClick={() => {
                  if (llamaCppOrMlxIsInstalled) setShowLocalModelDialog(true)
                }}
                className={clsx(
                  'group w-full text-left p-4 rounded-lg  transition-all duration-200',
                  llamaCppOrMlxIsInstalled ? 'border border-[hsl(var(--chat-border))] hover:border-primary/50 hover:bg-primary/5' : 'bg-black/25'
                )}>
                <div className='flex items-start gap-4'>
                  <div className={clsx(
                    'mt-0.5 p-2 rounded-md',
                    llamaCppOrMlxIsInstalled && 'bg-muted group-hover:bg-primary/10 transition-colors'
                  )}>
                    {/* CPU / local icon */}
                    <svg className={
                      clsx
                        (
                          'w-5 h-5 transition-colors',
                          llamaCppOrMlxIsInstalled && 'text-muted-foreground group-hover:text-primary'
                        )
                    } fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth={1.5}>
                      <path strokeLinecap='round' strokeLinejoin='round' d='M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z' />
                    </svg>
                  </div>
                  <div className='flex-1'>
                    <div className='flex items-center justify-between'>
                      <span className='text-sm font-medium'>Import Local Model</span>
                      <span className={clsx(
                        'text-xs px-2 py-0.5 rounded-full',
                        llamaCppOrMlxIsInstalled ? 'text-muted-foreground bg-muted' : 'opacity-0 select-none'
                      )}>Offline</span>
                    </div>
                    <div className='flex items-center gap-4'>
                      <p className='text-xs text-muted-foreground mt-1 leading-relaxed'>
                        Run models entirely on your device, no internet required. Supports <span className='text-foreground/70 font-medium'>.gguf</span> (llama.cpp) {(window as any).IS_MACOS && <>and <span className='text-foreground/70 font-medium'>.mlx</span> (Apple Silicon) formats.</>}
                      </p>
                      {!llamaCppOrMlxIsInstalled && <Button className='flex items-center gap-1' onClick={async (e) => {
                        e.stopPropagation()
                        setIsInstalling(true);
                        await pyInvoke('install_local_backend');
                      }} size={'sm'}>
                        <span>{isInstalling ? 'Installing' : 'Install'}</span>  {isInstalling && <Spinner />}
                      </Button>}
                    </div>
                  </div>

                </div>
              </div>
              {/* API Credentials */}
              <div
                onClick={() => setShowCredentialsDialog(true)}
                className='group w-full text-left p-4 border border-[hsl(var(--chat-border))] rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all duration-200'>
                <div className='flex items-start gap-4'>
                  <div className='mt-0.5 p-2 rounded-md bg-muted group-hover:bg-primary/10 transition-colors'>
                    {/* Key icon */}
                    <svg className='w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors' fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth={1.5}>
                      <path strokeLinecap='round' strokeLinejoin='round' d='M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 0 1 21.75 8.25Z' />
                    </svg>
                  </div>
                  <div className='flex-1'>
                    <div className='flex items-center justify-between'>
                      <span className='text-sm font-medium'>Setup API Credentials</span>
                      <span className='text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full'>Cloud</span>
                    </div>
                    <p className='text-xs text-muted-foreground mt-1 leading-relaxed'>
                      Connect to hosted model providers using your API key.
                    </p>
                    <div className='flex items-center gap-1.5 mt-2.5 flex-wrap'>
                      {['OpenAI', 'Anthropic', 'OpenRouter', 'Gemini'].map((p) => (
                        <span key={p} className='text-[11px] text-muted-foreground border border-[hsl(var(--chat-border))] px-2 py-0.5 rounded-full'>
                          {p}
                        </span>
                      ))}
                      <span className='text-[11px] text-muted-foreground px-1'>+more</span>
                    </div>
                  </div>
                </div>
              </div>
              <div
                onClick={() => setShowCustomEndpointDialog(true)}
                className='group w-full text-left p-4 border border-[hsl(var(--chat-border))] rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all duration-200'>
                <div className='flex items-start gap-4'>
                  <div className='mt-0.5 p-2 rounded-md bg-muted group-hover:bg-primary/10 transition-colors'>
                    {/* Network/proxy icon */}
                    <svg className='w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors' fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth={1.5}>
                      <path strokeLinecap='round' strokeLinejoin='round' d='M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253M3.284 14.253A8.959 8.959 0 0 1 3 12c0-1.064.184-2.084.52-3.036' />
                    </svg>
                  </div>
                  <div className='flex-1'>
                    <div className='flex items-center justify-between'>
                      <span className='text-sm font-medium'>Proxy / Custom Endpoint</span>
                      <span className='text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full'>Self-hosted</span>
                    </div>
                    <p className='text-xs text-muted-foreground mt-1 leading-relaxed'>
                      Point to any OpenAI-compatible base URL  ideal for self-hosted inference servers or corporate proxies.
                    </p>
                    <div className='flex items-center gap-1.5 mt-2.5 flex-wrap'>
                      {['Ollama', 'LM Studio', 'vLLM', 'koboldcpp'].map((p) => (
                        <span key={p} className='text-[11px] text-muted-foreground border border-[hsl(var(--chat-border))] px-2 py-0.5 rounded-full'>
                          {p}
                        </span>
                      ))}
                      <span className='text-[11px] text-muted-foreground px-1'>+more</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* Footer */}
            <div className='px-6 pb-5 flex items-center justify-between'>
              <p className='text-xs text-muted-foreground'>You can change this later in settings</p>
              <button
                onClick={() => {
                  setSetupModel(false);
                }}
                className='text-xs text-muted-foreground hover:text-foreground transition-colors'>
                Skip for now →
              </button>
            </div>
          </div>
        </div>
      </>
      }
    </div>
  )
}
