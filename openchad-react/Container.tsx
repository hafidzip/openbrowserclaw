import { Suspense, useEffect, useRef, useState } from 'react'
import Sidebar from './components/sidebar'
import Topbar from './components/topbar'
import clsx from 'clsx'
import { motion } from "motion/react"
import { useFileImpl } from './components/useFile'
import { ArrowLeftRight, Copy, GitBranch, Globe, HardDrive, Key, Minus, Plus, Search, Settings, X, type LucideIcon } from 'lucide-react'
import useElementSize from './components/hooks/useElementSize'
import { Button } from './components/ui/button'
import uuidv4 from './utils/uuid'
import { openUrl } from '@tauri-apps/plugin-opener'
import { KeyState, TabInfo, TabState, Viewport, Workspace, Theme, addTab, closeTab, detachTab, type ITab, deleteTab, deleteTabWithGroupSelection } from './utils/state'
import { proxy, useSnapshot } from 'valtio'
import MultiView, { type LayoutType } from './components/multiview'
import { Spinner } from './components/ui/spinner'
import React from 'react'
import ReactDOM from 'react-dom'
import DefaultPage from './components/default-page'
import { usePython } from './components/usePython'
import { useDatabaseImpl } from './components/useDatabase'
import useKeyEffect from './components/useKeyEffect'
import { SelectWorkspace } from './components/select-workspace'
import AppLoading from './components/app-loading'
import { useFolderImpl } from './components/useFolder'
import type { AppInfo, Model } from './utils/utils'
import { sha256 } from 'js-sha256';
import { useGlobal } from './components/useGlobal'
import { useSettings } from './components/useSettings'
import { Dropdown } from './components/dropdown'

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
  return <div className="w-full h-full">
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
}
import { hideSplashScreen } from "vite-plugin-splash-screen/runtime";
import { generateIdFromString } from './index'

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
  const { settings } = useSettings();
  const [startupStatus] = useState<any>(null);
  const [, , { folders }] = useFolderImpl('Workspaces');
  const { workspace, setWorkspace } = useSnapshot(Workspace);
  const [isSwitchWorkspace, setIsSwitchWorkspace] = useState(false);
  const appRegistry = proxy<Record<string, React.ComponentType<AppInfo>>>({
    ...(Apps.appRegistry || {}),
    ...Apps.defaultTab.tabs.reduce((acc: Record<string, React.ComponentType<AppInfo>>, t: any) => {
      acc[t.appname] = t.App;
      return acc;
    }, {})
  });
  const [mounted, setMounted] = useState(false);
  const [showSearchDialog, setShowSearchDialog] = useState(false);
  const [showMcpDialog, setShowMcpDialog] = useState(false);
  const [showCredentialsDialog, setShowCredentialsDialog] = useState(false);
  const [showLocalModelDialog, setShowLocalModelDialog] = useState(false);
  const [showCustomEndpointDialog, setShowCustomEndpointDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [setupModel, setSetupModel] = useState(false);
  const snaptheme = useSnapshot(Theme);
  const currentLayout = snaptheme.layout;
  const [intialzeTheme, setInitialzeTheme] = useState(false);
  const isFirstSave = useRef(true);
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
      setInitialzeTheme(true);
    })();
  }, []);
  useEffect(() => {
    if (!intialzeTheme) return;
    // Skip the first run caused by intialzeTheme flipping to true,
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
  }, [snaptheme, intialzeTheme]);
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
      (window as any).PROJECT_ROOT = data.PROJECT_ROOT;
      (window as any).PYTHON_ROOT = data.PYTHON_ROOT;
      (window as any).BACKENDS_DIR = data.BACKENDS_DIR;
      (window as any).PIPELINES_DIR = data.PIPELINES_DIR;
      (window as any).TOOLS_DIR = data.TOOLS_DIR;
      (window as any).MODEL_PROVIDERS_DIR = data.MODEL_PROVIDERS_DIR;
      (window as any).SETTINGS_DIR = data.SETTINGS_DIR;
      // Attach to the window or a specific element
    })();
  }, []);
  const workspaces = folders
    .filter(f => !f.slice(0, -1).includes('/'))  // exclude nested folders    
    .map(f => f.replace(/\/$/, ''))
    .filter(f => f !== 'Private' && f !== 'global');              // remove trailing slash
  useEffect(() => {
    if (workspaces.length === 1) {
      setWorkspace(workspaces[0]);
    }
  }, [workspaces.length])
  const [isSearchChatOpen, setIsSearchChatOpen] = useState(false);
  const searchRef = useRef<any>(null);
  const snaptabs = useSnapshot(TabState);
  const [tabs, setTabs] = useState<Record<string, React.ReactNode>>({});
  const { children, layout, active, SetActive } = useSnapshot(TabInfo);
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
      useWorkspace: () => {
        const { workspace, setWorkspace } = useSnapshot(Workspace);
        return { workspace: workspace ?? "global", setWorkspace };
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
        return _tabs[tabId] as ITab;
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
        return useDatabaseImpl<Model>("model", { initialValue: { name: null, id: null } });
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
        const { workspace } = useSnapshot(Workspace);
        return async (tool: string, parameters: Record<string, any>) => {
          return await pyInvoke("tools/execute", { tool, workspace, tabId, ...parameters });
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
    (async () => {
      if (typeof window !== 'undefined' && !!(window as any).__TAURI__) {
        try {
          const res = await pyInvoke<{ data?: Record<string, unknown>; error?: string }>('check_tauri', {});
          if (res && typeof res === 'object' && 'data' in res) {
            console.warn(res.data);
          }
        } catch (e) {
          console.error(e);
          window.location.reload();
        }
      }
    })()
  }, [])
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
              const AppComponent = Component as React.ComponentType<AppInfo>;
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
    setMounted(true);
  }, []);

  useEffect(() => {
    (async ()=> {
      await pyInvoke('set_active', {
        workspace: workspace || "global",
        tab_id: active.length > 0 ? active : "global",
      })
    })()
  }, [workspace, active])

  useKeyEffect(() => {
    const activeElement = document.activeElement;
    const isInputFocused =
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement ||
      (activeElement instanceof HTMLElement && activeElement.isContentEditable);
    if (TabInfo.layout !== "single" && !isInputFocused) {
      TabInfo.switchMode = true;
    } else {
      TabInfo.switchMode = false;
    }
  }, ["control", "shift"]);


  const deleteTimerRef = useRef<any>(null);

  useKeyEffect(() => {
    const activeElement = document.activeElement;
    const isInputFocused =
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement ||
      (activeElement instanceof HTMLElement && activeElement.isContentEditable);
    if (isInputFocused) {
      return;
    }

    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
    }

    deleteTimerRef.current = setTimeout(() => {
      deleteTabWithGroupSelection(active)
      deleteTimerRef.current = null;
    }, 80); // delay in ms

  }, ["control", "w"]);

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
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [mounted]);
  // Mobile bottom bar search
  const [isMobileSearching, setIsMobileSearching] = useState(false);
  const [mobileSearchText, setMobileSearchText] = useState('');
  const [selectedMobileTab, setSelectedMobileTab] = useState({ name: 'Blank', icon: TabInfo.icon });
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const mobileTabItems = [
    { name: 'Blank', icon: TabInfo.icon },
    { name: 'Blank 1', icon: TabInfo.icon },
    { name: 'Modern Page', icon: TabInfo.icon },
    { name: 'Outlaw', icon: TabInfo.icon },
  ];
  const filteredMobileItems = mobileTabItems.filter(item =>
    item.name.toLowerCase().includes(mobileSearchText.toLowerCase())
  );
  const handleMobileSelectItem = (item: typeof mobileTabItems[0]) => {
    setSelectedMobileTab(item);
    setIsMobileSearching(false);
    setMobileSearchText('');
  };
  const handleMobileSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && filteredMobileItems.length > 0) handleMobileSelectItem(filteredMobileItems[0]);
    if (e.key === 'Escape') { setIsMobileSearching(false); setMobileSearchText(''); }
  };
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
    if (isStreamReady && intialzeTheme) {
      setTimeout(() => {
        setWarmup(false);
      }, 100)
    }
  },
    [isStreamReady, intialzeTheme]);
  if (!intialzeTheme) {
    return <AppLoading status={startupStatus} />
  }
  if (workspace === null || isSwitchWorkspace) {
    return <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: isSwitchWorkspace ? 0 : 1 }}
    >
      <SelectWorkspace workspaces={workspaces} setWorkspace={(name: string) => {
        setWorkspace(name);
        setIsSwitchWorkspace(false);
      }} />
    </motion.div>
  }
  return (
    <div>
      {isTauri && <div data-tauri-drag-region className='absolute top-0 w-full h-[2.5vh]  left-0 bg-transparent' style={{ zIndex: 10 }} />}
      <div
        contentEditable
        style={{
          zIndex: -99999,
        }}
        className='opacity-0 absolute select-none pointer-events-none'
      />
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
      <div ref={vieweportRef} id="app"
        className={clsx(
          "flex bg-[hsl(var(--bg))]  h-screen overflow-hidden",
          currentLayout === "rightToLeft" && 'flex-row-reverse',
        )}
      >
        <aside className="items-start x hidden md:flex bg-[hsl(var(--bg))] relative z-10">
          {/* <VerticalTab menus={menus} /> */}
          <Sidebar
            projectName={Apps.projectName}
            ProjectIcon={Apps.projectIcon}
            workspace={workspace}
            setIsSwitchWorkspace={setIsSwitchWorkspace}
            showSearchDialog={showSearchDialog}
            setShowSearchDialog={setShowSearchDialog}
            showMcpDialog={showMcpDialog}
            setShowMcpDialog={setShowMcpDialog}
            showCredentialsDialog={showCredentialsDialog}
            setShowCredentialsDialog={setShowCredentialsDialog}
            showLocalModelDialog={showLocalModelDialog}
            setShowLocalModelDialog={setShowLocalModelDialog}
            showCustomEndpointDialog={showCustomEndpointDialog}
            setShowCustomEndpointDialog={setShowCustomEndpointDialog}
            showSettingsDialog={showSettingsDialog}
            setShowSettingsDialog={setShowSettingsDialog}
            layout={snaptheme.layout}
            theme={snaptheme.theme}
            settings={settings}
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
            "w-full overflow-hidden",
            isTauri && "pt-1.5",
            "h-[calc(100%-50px)] md:h-full"
          )}>
            <div
              id="app"
              className={
                clsx(
                  "flex",
                  "bg-card relative w-full h-full border-[0px] border-solid border-[hsl(var(--chat-border))] border-t-[1px]",
                  currentLayout === "rightToLeft" ? 'border-r-[1px]' : 'border-l-[1px]',
                )
              }>
              {
                Object.keys(snaptabs).length == 0 && (
                  <div className="w-full h-full flex items-center justify-center">
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
                "relative overflow-hidden",
                "flex-1",
              )}>
                {Object.keys(snaptabs).length > 0 && <MultiView actives={actives} className='relative top-0 left-0 bg-neutral-300 dark:bg-[hsl(var(--float))]' layout={layout as LayoutType}>
                  {Object.keys(tabs).map((key, index) => (
                    <TabItem key={key} isOpened={actives.includes(index)}>
                      {tabs[key]}
                    </TabItem>
                  ))
                  }
                </MultiView>}
              </div>
              {isTauri && <div className={clsx("absolute z-10 top-[-0.2px]", currentLayout === "rightToLeft" ? 'left-0' : "right-0")}>
                <Topbar reverse={currentLayout === "rightToLeft"} Elements={[
                  currentLayout === "rightToLeft" ?
                    <button
                      onClick={() => {
                        if ((window as any).__TAURI__) {
                          (window as any).__TAURI__.window.getCurrentWindow().minimize()
                        }
                      }}
                      className="pointer-events-auto  w-[30px] h-[30px] flex items-center justify-center rounded-lg transition-colors  relative bottom-1" aria-label="Settings">
                      <div className='w-[13px] h-[13px] rounded-full bg-green-500'>
                      </div>
                    </button>
                    : <button
                      onClick={() => {
                        if ((window as any).__TAURI__) {
                          (window as any).__TAURI__.window.getCurrentWindow().minimize()
                        }
                      }}
                      className="pointer-events-auto w-[30px] h-[30px] flex items-center justify-center rounded-lg hover:bg-[hsl(var(--hover))] transition-colors  relative bottom-1" aria-label="Settings">
                      <Minus className="h-3 w-3 text-zinc-600 dark:text-zinc-300" />
                    </button>,
                  currentLayout === "rightToLeft" ?
                    <button
                      onClick={() => {
                        if ((window as any).__TAURI__) {
                          (window as any).__TAURI__.window.getCurrentWindow().toggleMaximize()
                        }
                      }}
                      className="pointer-events-auto w-[30px] h-[30px] flex items-center justify-center rounded-lg transition-colors  relative bottom-1" aria-label="Settings">
                      <div className='w-[13px] h-[13px] rounded-full bg-yellow-500'>
                      </div>
                    </button>
                    : <button
                      onClick={() => {
                        if ((window as any).__TAURI__) {
                          (window as any).__TAURI__.window.getCurrentWindow().toggleMaximize()
                        }
                      }}
                      className="pointer-events-auto w-[30px] h-[30px] flex items-center justify-center rounded-lg hover:bg-[hsl(var(--hover))] transition-colors  relative bottom-1" aria-label="Settings">
                      <Copy className="h-3 w-3 text-zinc-600 dark:text-zinc-300 transform scale-x-[-1]" />
                    </button>,
                  currentLayout === "rightToLeft" ?
                    <button
                      onClick={() => {
                        if ((window as any).__TAURI__) {
                          (window as any).__TAURI__.window.getCurrentWindow().close()
                        }
                      }}
                      className="pointer-events-auto w-[30px] h-[30px] flex items-center justify-center rounded-lg transition-colors  relative bottom-1" aria-label="Settings">
                      <div className='w-[13px] h-[13px] rounded-full bg-red-500'>
                      </div>
                    </button>
                    : <button
                      onClick={() => {
                        if ((window as any).__TAURI__) {
                          (window as any).__TAURI__.window.getCurrentWindow().close()
                        }
                      }}
                      className="pointer-events-auto w-[30px] h-[30px] flex items-center justify-center rounded-lg hover:bg-[hsl(var(--hover))] transition-colors  relative bottom-1" aria-label="Settings">
                      <X className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                    </button>
                ]} />
              </div>}
            </div>
          </div>
          <div className='w-full flex md:hidden h-[50px] bg-[hsl(var(--bg))] absolute bottom-[0px] z-10 gap-2 items-center justify-center border-t border-[hsl(var(--chat-border))] px-3'>
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
                    placeholder={selectedMobileTab.name}
                  />
                ) : (
                  <span className='flex-1 text-sm'>{selectedMobileTab.name}</span>
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
              content={[
                {
                  content: <div> Switch Workspace </div>,
                  shortcut: <ArrowLeftRight size={16} />,
                  children: null,
                  separator: false,
                  trigger: () => {
                    setIsSwitchWorkspace(true);
                  }
                },
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
                      openUrl('https://github.com/openchad/openchad')
                    } else {
                      window.open('https://github.com/openchad/openchad', '_blank')
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
              <button
                onClick={() => setShowLocalModelDialog(true)}
                className='group w-full text-left p-4 border border-[hsl(var(--chat-border))] rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all duration-200'>
                <div className='flex items-start gap-4'>
                  <div className='mt-0.5 p-2 rounded-md bg-muted group-hover:bg-primary/10 transition-colors'>
                    {/* CPU / local icon */}
                    <svg className='w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors' fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth={1.5}>
                      <path strokeLinecap='round' strokeLinejoin='round' d='M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z' />
                    </svg>
                  </div>
                  <div className='flex-1'>
                    <div className='flex items-center justify-between'>
                      <span className='text-sm font-medium'>Import Local Model</span>
                      <span className='text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full'>Offline</span>
                    </div>
                    <p className='text-xs text-muted-foreground mt-1 leading-relaxed'>
                      Run models entirely on your device, no internet required. Supports <span className='text-foreground/70 font-medium'>.gguf</span> (llama.cpp) and <span className='text-foreground/70 font-medium'>.mlx</span> (Apple Silicon) formats.
                    </p>
                  </div>
                </div>
              </button>
              {/* API Credentials */}
              <button
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
              </button>
              <button
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
              </button>
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
        <div data-tauri-drag-region className='fixed w-[100vw] h-[5vh] left-0 top-0 z-50 bg-transparent' />
      </>
      }
    </div>
  )
}
