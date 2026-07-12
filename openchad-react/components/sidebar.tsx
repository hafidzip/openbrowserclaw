"use client"
import clsx from "clsx"
import { Aspan } from "./animated"
import { motion, AnimatePresence } from "motion/react"
import { useRef, useState, useEffect, Fragment, useCallback, memo } from "react"
import { ChevronDown, GitBranch, Plus, Settings, X, Pin, ChevronRight, ArrowLeftRight, Key, HardDrive, Globe, Drama, EarthIcon, Scroll, AlarmCheck, Volume2, VolumeX, Wrench } from "lucide-react"
import { Dialog as DialogUI, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog"
import { Dropdown } from "./dropdown"
import { TabState, addTab, TabInfo, reorderTabsInGroup, deleteTabWithGroupSelection, setTabGroup, type ITab, Theme, LucideIcons } from '../utils/state'
import { useSnapshot } from 'valtio'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { IconPopover } from "./iconPopover"
import { useDatabaseImpl } from "./useDatabase"
import { Search } from "lucide-react"
import { open } from '@tauri-apps/plugin-dialog';
import { useSettings, type SettingItem } from "./useSettings"
import { usePython, usePythonEvent } from "./usePython"
import SettingsMenu from "./settings-menu"
import Credentials from "./credentials"
import LocalModel from "./localmodel"
import CustomEndpoint from "./customendpoint"
import { openUrl } from '@tauri-apps/plugin-opener'
import McpServers from "./mcp"
import SiteRegistry from "./SiteRegistry"
import Tasks from "./Tasks"
import { useGlobal } from "./useGlobal"
import Agents from "./Agents"
import ControllableBrowsers from "./ControllableBrowsers"
import Tools from "./Tools"
import { AsyncLock, generateIdFromString, uuidv4 } from "./../index"
import { getCurrentWebview, Webview } from "@tauri-apps/api/webview"
import { getCurrentWindow, Window as TauriWindow } from "@tauri-apps/api/window"
import { Spinner } from "./ui"

// Sortable Tab Item Component
interface SortableTabItemProps {
  defaultTitle: string;
  isPinned: boolean;
  id: string;
  icon: string;
  title: string | null;
  index: number;
  isCollapsible: boolean;
  isCollapsedSidebar: boolean;
  hoveredTabId: string | null;
  onMouseEnter: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
  onContextMenu: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onDelete: () => void;
  onMuteToggle: () => void;
  isActive: boolean;
  onClick: () => void;
  isPlayingAudio: boolean;
  isMuted: boolean;
}

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;

export async function selectModel() {
  const file = await open({
    multiple: true,
    directory: false,
    filters: [{
      name: 'Model',
      extensions: (window as any).IS_MACOS ? ['gguf', 'mlx'] : ['gguf']
    }]
  });
  return file;
}

function SortableTabItem({ defaultTitle,
  isPinned,
  id,
  icon,
  title,
  isCollapsedSidebar,
  hoveredTabId,
  isActive,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
  onDelete,
  onMuteToggle,
  onClick,
  isMuted,
  isPlayingAudio
}: SortableTabItemProps) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const isHovered = hoveredTabId === id;
  // Combine refs
  const combinedRef = (node: HTMLDivElement | null) => {
    divRef.current = node;
    setNodeRef(node);
  };
  return (
    <div
      key={id}
      ref={combinedRef}
      style={style}
      onMouseEnter={(e) => onMouseEnter(id, e)}
      onMouseLeave={onMouseLeave}
      onContextMenu={(e) => onContextMenu(id, e)}
      onClick={onClick}
      className={clsx(
        "w-full h-[36px] flex items-center gap-1 rounded-lg text-xs transition-colors relative group",

        (isActive) ? (id.startsWith("agent") ? "bg-purple-300 dark:bg-purple-800" : "bg-neutral-300 dark:bg-[hsl(var(--hover))]") : isHovered ? (id.startsWith("agent") ? "bg-purple-800/40 dark:bg-purple-900/75" : "bg-neutral-200 dark:bg-[hsl(var(--hover))]/50") : (id.startsWith("agent") && "bg-purple-900/25 dark:bg-purple-900/50"),
      )}
      data-tab-id={id}
    >
      {/* Drag Handle and Content */}
      <div
        {...attributes}
        {...listeners}
        className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer active:cursor-grabbing"
      >
        <TabIcon iconVal={icon} className="relative min-w-[20px] transition-all duration-250 left-[7px]" />
        {
          !isCollapsedSidebar &&
          <>
            {(isPlayingAudio || isMuted) &&
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMuteToggle();
                }}
                className={clsx(
                  "p-1 rounded-md hover:bg-accent/20 transition-opacity",
                  "opacity-100"
                )}
                aria-label="Mute tab"
              >
                {isMuted ? <VolumeX className="h-4 w-4 text-accent" /> : <Volume2 className="h-4 w-4 text-accent" />}
              </button>
            }
          </>
        }
        <Aspan isCollapsed={isCollapsedSidebar} className="truncate flex-1 min-w-0 block">{title || defaultTitle}</Aspan>
      </div>
      {/* Delete Button - Expanded State */}
      {!isCollapsedSidebar && <>
        {
          isHovered ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className={clsx(
                "p-1 rounded-md hover:bg-accent/20 transition-opacity mr-1",
                "opacity-100"
              )}
              aria-label="Delete tab"
            >
              <X className="h-4 w-4 text-accent" />
            </button>
          ) : (
            <button
              className={clsx(
                "p-1 rounded-md hover:bg-accent/20 mr-1",
                isPinned ? "opacity-100" : "opacity-0"
              )}
            >
              <Pin className="h-4 w-4 text-accent" />
            </button>
          )
        }
      </>}
      {/* Delete Button - Collapsed State (Top Right Corner) */}

      {isCollapsedSidebar && <>
        {isHovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="absolute -top-1 -left-0 p-[2px] rounded-md bg-neutral-600 hover:bg-neutral-700 dark:bg-[hsl(var(--float))] dark:hover:bg-[hsl(var(--hoverfloat))] transition-colors"
            aria-label="Delete tab"
          >
            <X className="h-2.5 w-2.5 text-white" />
          </button>
        )}
        {(isPlayingAudio || isMuted) && <button
          onClick={(e) => {
            e.stopPropagation();
            onMuteToggle();
          }}
          className="absolute bottom-1 -right-1 p-[2px] rounded-md bg-neutral-600 hover:bg-neutral-700 dark:bg-[hsl(var(--float))] dark:hover:bg-[hsl(var(--hoverfloat))] transition-colors"
          aria-label="Mute tab"
        >
          {isMuted ? <VolumeX className="h-3 w-3 text-white" /> : <Volume2 className="h-3 w-3 text-white" />}
        </button>}
      </>}
    </div>
  );
}

const TabIcon = memo(({ iconVal, className }: { iconVal: string | undefined, className?: string }) => {
  if (
    typeof iconVal === "string" &&
    (iconVal.startsWith("/") ||
      iconVal.startsWith("http") ||
      iconVal.startsWith("data:") ||
      /\.(png|jpg|jpeg|ico|svg|webp)$/i.test(iconVal))
  ) {
    return <img src={iconVal} className={clsx(className, "w-4 h-4 object-contain rounded-sm")} alt="" />;
  }
  const Icon = (LucideIcons as any)[iconVal as string] || LucideIcons.Compass;
  return <Icon className={clsx(className, "h-4 w-4")} />;
});
// Tab Group Component - Handles a group of tabs with its own DnD context
interface TabGroupProps {
  defaultTitle: string;
  pinned: boolean;
  group: string | null;
  tabs: Record<string, ITab>;
  isCollapsible: boolean;
  isCollapsedSidebar: boolean;
  hoveredTabId: string | null;
  activeTabId: string;
  onTabMouseEnter: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onTabMouseLeave: () => void;
  onTabContextMenu: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onTabDelete: (uuid: string) => void;
  onTabClick: (uuid: string) => void;
  sensors: ReturnType<typeof useSensors>;
  showGroupHeader?: boolean;
  defaultCollapsed?: boolean;
  isPlayingRegistry: Record<string, boolean>;
}

function TabGroup({
  defaultTitle,
  pinned,
  isCollapsible,
  group,
  tabs,
  isCollapsedSidebar,
  hoveredTabId,
  activeTabId,
  onTabMouseEnter,
  onTabMouseLeave,
  onTabContextMenu,
  onTabDelete,
  onTabClick,
  sensors,
  showGroupHeader = false,
  defaultCollapsed = false,
  isPlayingRegistry,
}: TabGroupProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [lastActiveTabId, setLastActiveTabId] = useState("");
  const tabIds = Object.keys(tabs);
  useEffect(() => {
    setTimeout(() => {
      setLastActiveTabId(activeTabId);
    }, 100);
  }, [activeTabId]);
  // Handle drag end for this group
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = tabIds.indexOf(active.id as string);
      const newIndex = tabIds.indexOf(over.id as string);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderTabsInGroup(group, oldIndex, newIndex);
      }
    }
  };
  if (tabIds.length === 0) return null;
  const groupLabel = group === null ? "Tabs" : group.charAt(0).toUpperCase() + group.slice(1);
  const Chevron = isCollapsed ? ChevronRight : ChevronDown;
  return (<>
    <div className={clsx(
      "flex flex-col",
      isCollapsedSidebar ? "gap-2" : "",
    )}>
      {/* Group Header (only for named groups) */}
      {showGroupHeader && group !== null && isCollapsible && (
        <motion.button
          onClick={() => {
            setIsCollapsed(!isCollapsed);
          }}
          className={clsx(
            isCollapsed && "opacity-[0.5]",
            "group w-full h-[36px] flex items-center gap-3 text-sm transition-colors",
          )}>
          <Aspan className="flex-1 text-left" isCollapsed={isCollapsedSidebar}>{groupLabel}</Aspan>
          {/* ChevronRight - visible on hover */}
          <Chevron className={clsx(
            "absolute min-w-[20px] transition-all duration-250 opacity-0 group-hover:opacity-100 absolute",
            isCollapsedSidebar ? "left-[2px] bg-[hsl(var(--hover))] p-2 h-8 w-8 rounded-lg" : "h-4 w-4 right-5",
          )} />
          {/* Other Icon - hidden on hover */}
          <Pin className={clsx(
            "absolute min-w-[20px] transition-all duration-250 opacity-100 group-hover:opacity-0",
            isCollapsedSidebar ? "left-[2px] bg-[hsl(var(--hover))] p-2 h-8 w-8 rounded-lg" : "h-4 w-4 right-5",
          )} />
        </motion.button>
      )}
      <AnimatePresence initial={false}>
        {isCollapsed && Object.keys(tabs).includes(lastActiveTabId) && isCollapsible &&
          <motion.button
            key="collapsed-active-tab"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "36px", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              duration: Object.keys(tabs).includes(lastActiveTabId) ? 0 : 0.5,
            }}
            className="w-full h-[36px] rounded-lg flex items-center gap-3 text-sm hover:opacity-[1.0] transition-colors bg-[hsl(var(--hover))]">
            <TabIcon iconVal={tabs[lastActiveTabId].iconOverride || "Compass"} className=" relative min-w-[20px] transition-all duration-250 left-[7px]" />
            <Aspan isCollapsed={isCollapsedSidebar}> {tabs[lastActiveTabId].title} </Aspan>
          </motion.button>
        }
      </AnimatePresence>
      {/* Tab List */}
      <AnimatePresence initial={false}>
        {(!isCollapsed || !isCollapsible) && (
          <motion.div
            key="tab-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: Object.keys(tabs).includes(activeTabId) ? 0 : 0.2 }}
            className="flex flex-col gap-1"
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            >
              <SortableContext
                key={"sortable-context"}
                items={tabIds}
                strategy={verticalListSortingStrategy}
              >
                {Object.entries(tabs).map(([uuid, { iconOverride, title, isMuted }], index) => (
                  <SortableTabItem
                    defaultTitle={defaultTitle}
                    isPinned={pinned}
                    key={uuid}
                    id={uuid}
                    icon={iconOverride || "Compass"}
                    title={title}
                    index={index}
                    isCollapsible={isCollapsible}
                    isCollapsedSidebar={isCollapsedSidebar}
                    hoveredTabId={hoveredTabId}
                    onMouseEnter={onTabMouseEnter}
                    onMouseLeave={onTabMouseLeave}
                    onContextMenu={onTabContextMenu}
                    onDelete={() => onTabDelete(uuid)}
                    onMuteToggle={() => { if (TabState[uuid]) TabState[uuid].isMuted = !isMuted; }}
                    isActive={activeTabId === uuid}
                    onClick={() => onTabClick(uuid)}
                    isMuted={isMuted}
                    isPlayingAudio={isPlayingRegistry[uuid] ?? false}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    {showGroupHeader && group !== null && <div className={
      clsx(
        "w-full bg-[hsl(var(--bg))] relative",
        (isCollapsedSidebar) && "py-2"
      )
    }>
      <AnimatePresence initial>
        {
          isCollapsed && Object.keys(tabs).length > 1 && Object.keys(tabs).includes(lastActiveTabId) && <motion.span
            key="more-tabs-indicator"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: Object.keys(tabs).includes(lastActiveTabId) ? 0 : 0.5 }}
            onClick={() => {
              setIsCollapsed(false);
            }}
            className={clsx(
              "text-xs text-center w-full relative mx-auto bottom-0 block p-2 cursor-pointer",
              isCollapsedSidebar ? "bottom-2" : ""
            )}>{Object.keys(tabs).length - 1}{isCollapsedSidebar ? "+" : " more"}</motion.span>
        }
      </AnimatePresence>
      {isCollapsedSidebar && <div className={clsx("w-full h-[1px]", "bg-[hsl(var(--border))]")} />}
    </div>}
  </>
  );
}

function SearchDialogBody({ workspace, isOpen, setOpen }: { workspace: string | null, isOpen: boolean, setOpen: (open: boolean) => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  return (
    <>
      <DialogHeader className="px-6">
        <DialogTitle className="text-lg font-medium pt-10 text-foreground/90">
          <div className="relative w-full border border-[hsl(var(--chat-border))] flex items-center gap-2 bg-[hsl(var(--float))] rounded-full px-4 shadow-sm focus-within:ring-1 focus-within:ring-accent/30 transition-all">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              placeholder="Search your tab history..."
              className="bg-transparent border-none p-2 w-full h-10 focus-visible:ring-0 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
        </DialogTitle>
      </DialogHeader>
      <SiteRegistry workspace={workspace} isOpen={isOpen} setOpen={setOpen} query={searchQuery} />
    </>
  );
}

export default function Sidebar({
  mainWebviewRef,
  mainWindowRef,
  projectName,
  ProjectIcon,
  workspace,
  layout,
  theme,
  settings,
  repository,
  isPlayingRegistry
}: {
  mainWebviewRef: React.RefObject<Webview | null>;
  mainWindowRef: React.RefObject<TauriWindow | null>;
  projectName: string;
  ProjectIcon: React.ComponentType;
  workspace: string | null,
  layout: string;
  theme: string;
  settings: Record<string, SettingItem>;
  repository?: string;
  isPlayingRegistry: Record<string, boolean>
}) {
  const allTabs = useSnapshot(TabState);
  // Record<string, { title: string; layout: string; group: string | null; childrenProps: Record<string, { title: string; path: string; icon: string; }> }>>
  // const [savedTabs, setSavedTabs, { query: savedTabsQuery }] = useDatabase<string[]>("tabs");
  const [savedTabs, setSavedTabs, { query: savedTabsQuery }] = useDatabaseImpl<Record<string,
    {
      title: string | null;
      layout: string;
      group: string | null;
      size: number[];
      childrenProps: Record<string, {
        title: string | null;
        appname: string;
        icon: string;
        data: any;
      }
      >
    }>>("tabs");
  const tabs = Object.fromEntries(Object.entries(allTabs).filter(([_, tab]) => tab.group === null));
  const pinnedTabs = Object.fromEntries(Object.entries(allTabs).filter(([_, tab]) => tab.group === "pinned"));
  const s = useSettings();
  const [isCollapsedSidebar, setIsCollapsedSidebar] = useState(true);
  const [isInstalling, setIsInstalling] = useGlobal('isInstalling', { initialValue: false });
  const [llamaCppOrMlxIsInstalled, setLlamaCppOrMlxIsInstalled] = useGlobal('llamaCppOrMlxIsInstalled', { initialValue: false });
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [searchTaskQuery, setSearchTaskQuery] = useState("");
  const [searchAgentsQuery, setSearchAgentsQuery] = useState("");
  const [searchControllableBrowsersQuery, setSearchControllableBrowsersQuery] = useState("");
  // const [, setIsSwitchWorkspace] = useGlobal('isSwitchWorkspace', { initialValue: false });
  const [showSearchDialog, setShowSearchDialog] = useGlobal('showSearchDialog', { initialValue: false });
  const [showMcpDialog, setShowMcpDialog] = useGlobal('showMcpDialog', { initialValue: false });
  const [showCredentialsDialog, setShowCredentialsDialog] = useGlobal('showCredentialsDialog', { initialValue: false });
  const [showLocalModelDialog, setShowLocalModelDialog] = useGlobal('showLocalModelDialog', { initialValue: false });
  const [showCustomEndpointDialog, setShowCustomEndpointDialog] = useGlobal('showCustomEndpointDialog', { initialValue: false });
  const [showSettingsDialog, setShowSettingsDialog] = useGlobal('showSettingsDialog', { initialValue: false });
  const [showTaskDialog, setShowTaskDialog] = useGlobal('showTaskDialog', { initialValue: false });
  const [showControllableBrowsersDialog, setShowControllableBrowsersDialog] = useGlobal('showControllableBrowsersDialog', { initialValue: false });
  const [showAgentsDialog, setShowAgentsDialog] = useGlobal('showAgentsDialog', { initialValue: false });
  const [showCodeDialog, setShowCodeDialog] = useGlobal('showCodeDialog', { initialValue: false });
  const [showToolsDialog, setShowToolsDialog] = useGlobal('showToolsDialog', { initialValue: false });
  const [, setSettingsDropdown] = useGlobal('settingsDropdown', { initialValue: false });

  useEffect(() => {
    setIsTransitioning(true);
    const timer = setTimeout(() => {
      setIsTransitioning(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [isCollapsedSidebar]);

  const [showPopup, setShowPopup] = useState(false);
  const [popupTop, setPopupTop] = useState(0);
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
  const [editingTitleTabId, setEditingTitleTabId] = useState<string | null>(null);
  const [tempTitle, setTempTitle] = useState("");
  const hoverTimeoutRef = useRef<any | null>(null);
  const hideTimeoutRef = useRef<any | null>(null);
  useEffect(() => {
    if (!showPopup) {
      setEditingTitleTabId(null);
      window.dispatchEvent(new CustomEvent('hide-popup'));
    }
  }, [showPopup]);

  useEffect(() => {
    if (!editingTitleTabId) {
      window.dispatchEvent(new CustomEvent('hide-popup'));
    }
  }, [editingTitleTabId])


  const sidebarRef = useRef<HTMLDivElement>(null);
  const isAllowCollapseRef = useRef<boolean>(true);
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const mousePositionRef = useRef<{ x: number; y: number } | null>(null);
  const { active, SetActive } = useSnapshot(TabInfo);
  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { pyInvoke } = usePython();
  useEffect(() => {
    if (mounted) {
      (async () => {
        const t = await savedTabsQuery(`SELECT * FROM tabs`);
        setLoaded(true);
        let needAdd = true;
        if (Array.isArray(t)) {
          t.forEach(tab => {
            needAdd = false;
            addTab({
              uuid: tab.id,
              title: tab.title,
              layout: tab.layout,
              iconOverride: tab.iconOverride,
              group: tab.group,
              childrenProps: tab.childrenProps,
              size: tab.size
            });
          })
        }
        if (needAdd) addTab();
      })();
    }
  }, [mounted, workspace, savedTabsQuery]);
  useEffect(() => {
    setMounted(true);
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => {
      (async () => {
        const tabsToSave = Object.fromEntries(
          Object.entries(TabState).map(([id, tab]) => [
            id,
            {
              title: tab.title,
              layout: tab.layout,
              iconOverride: tab.iconOverride,
              group: tab.group,
              childrenProps: tab.childrenProps,
              size: tab.size
            },
          ]),
        );
        if (mounted && loaded) {
          setSavedTabs(tabsToSave);
          const entriesToSave = Object.entries(TabState).filter(([_, tab]) => tab.title);
          if (entriesToSave.length > 0) {
            const db = workspace ?? "global";
            const placeholders = entriesToSave.map(() => "(?, ?)").join(", ");
            const sql = `INSERT OR REPLACE INTO tab_metadata (id, metadata) VALUES ${placeholders}`;
            const params = entriesToSave.flatMap(([id, tab]) => [
              id,
              JSON.stringify({
                title: tab.title,
                layout: tab.layout,
                iconOverride: tab.iconOverride,
                size: tab.size,
                childrenProps: tab.childrenProps,
                timestamp: Date.now(),
              })
            ]);
            await pyInvoke("sqlite", {
              db,
              command: "execute",
              sql: `CREATE TABLE IF NOT EXISTS tab_metadata (
                      id    TEXT PRIMARY KEY,
                      metadata TEXT
                    )`,
              params: []
            });
            await pyInvoke("sqlite", {
              db,
              command: "execute",
              sql,
              params
            });
          }
        }
      })()
    }, 250);
    return () => clearTimeout(timer);
  }, [allTabs, mounted, loaded, workspace])
  // Track mouse position
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
    };
    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, []);
  // Check if hovered tab still exists and close popup if not
  useEffect(() => {
    if (hoveredTabId) {
      const exists = Object.keys(allTabs).includes(hoveredTabId);
      if (!exists) {
        setShowPopup(false);
        setHoveredTabId(null);
      }
    }
  }, [allTabs, hoveredTabId]);
  // Check hover state after tabs change (e.g., after deletion)
  useEffect(() => {
    if (editingTitleTabId) return;
    if (!mousePositionRef.current || !tabContainerRef.current) return;
    const { x, y } = mousePositionRef.current;
    const elements = document.elementsFromPoint(x, y);
    // Find if any tab is under the cursor
    const tabElement = elements.find(el => el.hasAttribute('data-tab-id'));
    if (tabElement) {
      const tabId = tabElement.getAttribute('data-tab-id');
      if (tabId !== hoveredTabId) {
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
          hideTimeoutRef.current = null;
        }
        setShowPopup(false);
        setHoveredTabId(tabId);
        if (sidebarRef.current) {
          const sidebarRect = sidebarRef.current.getBoundingClientRect();
          const tabRect = tabElement.getBoundingClientRect();
          setPopupTop(tabRect.top - sidebarRect.top);
        }
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }
        hoverTimeoutRef.current = setTimeout(() => {
          setShowPopup(true);
        }, 800);
      }
    } else {
      setHoveredTabId(null);
    }
  }, [Object.keys(allTabs).length, editingTitleTabId]); // Trigger when tab count changes
  // Handle tab deletion with group-aware auto-selection
  const handleDeleteTab = (uuid: string) => {
    // Use the group-aware deletion that auto-selects next tab in same group
    (async () => {
      const db = workspace ?? "global";
      const initTb = generateIdFromString(uuid + "/" + "message_state");
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
      await deleteTabWithGroupSelection(uuid);
    })()
    // The useEffect above will handle updating hover state
  };
  const handleTabMouseEnter = (id: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (editingTitleTabId) return;
    setHoveredTabId(id);
    if (sidebarRef.current) {
      const sidebarRect = sidebarRef.current.getBoundingClientRect();
      const tabRect = e.currentTarget.getBoundingClientRect();
      setPopupTop(tabRect.top - sidebarRect.top);
    }
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
  };
  const handleTabMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (editingTitleTabId) return;
    if (!showPopup) setHoveredTabId(null);
    hideTimeoutRef.current = setTimeout(() => {
      setShowPopup(false);
      setHoveredTabId(null);
    }, 300);
  };
  const handleTabContextMenu = async (id: string, e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();

    if (editingTitleTabId) return;
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoveredTabId(id);
    if (sidebarRef.current) {
      const sidebarRect = sidebarRef.current.getBoundingClientRect();
      const tabRect = e.currentTarget.getBoundingClientRect();
      setPopupTop(tabRect.top - sidebarRect.top);
    }

    if (mainWebviewRef.current && mainWindowRef.current) await mainWebviewRef.current.reparent(mainWindowRef.current)
    setShowPopup(true);
  };

  const addLocalModel = useCallback(async (paths: string[]): Promise<void> => {
    let modelsArr: string[] = Array.isArray(s.settings["openchad/LocalModelProvider/local.model"]) ? s.settings["openchad/LocalModelProvider/local.model"] : [];
    await s.updateSetting("openchad/LocalModelProvider/local.model", [...new Set([...modelsArr, ...paths])])
  }, [s]);
  const deleteLocalModel = useCallback(async (path: string): Promise<void> => {
    let modelsArr: string[] = Array.isArray(s.settings["openchad/LocalModelProvider/local.model"]) ? s.settings["openchad/LocalModelProvider/local.model"] : [];
    await s.updateSetting("openchad/LocalModelProvider/local.model", modelsArr.filter((model) => model !== path))
  }, [s]);
  const addEndpoint = useCallback(async (endpoint: string): Promise<void> => {
    let modelsArr: string[] = Array.isArray(s.settings["openchad/ProxyModelProvider/custom.endpoints"]) ? s.settings["openchad/ProxyModelProvider/custom.endpoints"] : [];
    await s.updateSetting("openchad/ProxyModelProvider/custom.endpoints", [...new Set([...modelsArr, endpoint])])
  }, [s]);
  const deleteEndpoint = useCallback(async (endpoint: string): Promise<void> => {
    let modelsArr: string[] = Array.isArray(s.settings["openchad/ProxyModelProvider/custom.endpoints"]) ? s.settings["openchad/ProxyModelProvider/custom.endpoints"] : [];
    await s.updateSetting("openchad/ProxyModelProvider/custom.endpoints", modelsArr.filter((model) => model !== endpoint))
  }, [s]);

  const [mcpStatuses, setMcpStatuses] = useState<Record<string, "connected" | "disconnected" | "disconnecting" | "connecting" | "error">>({});
  usePythonEvent('mcp_statuses', (data: any) => {
    setMcpStatuses(data);
  })
  useEffect(() => {
    (async () => {
      const res = await pyInvoke("mcp_tool/statuses")
      if (res.statuses) {
        setMcpStatuses(res.statuses)
      }
    })()
  }, [])
  return (
    <div
      ref={sidebarRef}
      style={{
        width: isCollapsedSidebar ? "50px" : "320px",
        willChange: "width",
        contain: "layout style",
      }}
      className={clsx(
        "h-full flex flex-col pb-1 px-2 relative gap-1 z-50",
        "transition-[width] duration-200 ease-out group",
      )}>
      <div data-tauri-drag-region className="w-full absolute left-0 h-[50px] bg-transparent" />
      <div className="flex items-center gap-2 pt-2">
        <div
          className={clsx(
            "relative left-1 h-8 w-8 rounded-md flex items-center justify-center text-zinc-800 dark:text-zinc-100 font-bold pointer-events-auto",
            isCollapsedSidebar && "group-hover:opacity-0",
          )}>
          <ProjectIcon />
        </div>
        <Aspan isCollapsed={isCollapsedSidebar} className="text-lg opacity-0 text-zinc-900 dark:text-gray-200 font-funnel flex items-center gap-1.5">{projectName} <span className="text-xs font-medium font-mono border relative top-[1px] p-[1px] rounded-full px-2">claw</span></Aspan>
        <div className="ml-auto pointer-events-none">
          <button
            onClick={() => {
              setIsCollapsedSidebar(!isCollapsedSidebar);
              isAllowCollapseRef.current = false;
              setTimeout(() => {
                isAllowCollapseRef.current = true;
              }, 250);
            }}
            className={clsx(
              "absolute z-20 top-2 group/collapsed right-2.5 h-8 w-8 inline-flex items-center justify-center rounded-xl transition-colors pointer-events-auto",
              isCollapsedSidebar && "group-hover:opacity-100 opacity-0",
            )}
            aria-label="Sidebar"
          >
            <svg
              className="h-4 w-4 text-zinc-600/50 dark:text-zinc-300/50 opacity-50 group-hover/collapsed:opacity-100"
              viewBox="0 0 24 24"
              fill="none"
              stroke="hsl(var(--accent))"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
        </div>
      </div>
      <div
        ref={tabContainerRef}
        className={clsx(
          "flex-shrink flex flex-col overflow-x-visible relative transform -translate-y-2 w-[calc(100%+10px)] pr-[10px]",
          isTransitioning ? "overflow-y-visible" : "overflow-y-auto",
          (!isCollapsedSidebar) ? "pt-2" : "pt-1"
        )}>
        <div
          onClick={() => setShowSearchDialog(true)}
          className={clsx(
            "px-2 border border-[hsl(var(--chat-border))] hover:bg-neutral-200 dark:hover:bg-[hsl(var(--hover))]/50 relative cursor-pointer rounded-full",
            (isCollapsedSidebar || Object.keys(pinnedTabs).length > 0) && "mb-1"
          )}>
          <div
            className={clsx(
              "w-full h-[36px] flex items-center gap-1 rounded-full text-sm transition-colors relative group",
            )}
          >
            {/* Drag Handle and Content */}
            <div
              className="flex items-center gap-3 flex-1 min-w-0"
            >
              <div className="w-4 h-4">
                <Search className={clsx(
                  "h-4 w-4 absolute",
                  isCollapsedSidebar && "absolute left-0"
                )} />
              </div>
              <Aspan isCollapsed={isCollapsedSidebar}>Search</Aspan>
            </div>
          </div>
        </div>
        {/* Pinned Tabs Group */}
        <TabGroup
          defaultTitle={"Untitled"}
          pinned={true}
          isCollapsible={false}
          group="pinned"
          tabs={pinnedTabs as Record<string, ITab>}
          isCollapsedSidebar={isCollapsedSidebar}
          hoveredTabId={hoveredTabId}
          activeTabId={active}
          onTabMouseEnter={handleTabMouseEnter}
          onTabMouseLeave={handleTabMouseLeave}
          onTabContextMenu={handleTabContextMenu}
          onTabDelete={handleDeleteTab}
          onTabClick={SetActive}
          sensors={sensors}
          showGroupHeader={true}
          defaultCollapsed={false}
          isPlayingRegistry={isPlayingRegistry}
        />
        {!isCollapsedSidebar && <div className="h-1" />}
        {/* Ungrouped Tabs */}
        <TabGroup
          defaultTitle={settings["Others/app_settings/string.title"]?.value || "Untitled"}
          pinned={false}
          isCollapsible={false}
          group={null}
          tabs={tabs as Record<string, ITab>}
          isCollapsedSidebar={isCollapsedSidebar}
          hoveredTabId={hoveredTabId}
          activeTabId={active}
          onTabMouseEnter={handleTabMouseEnter}
          onTabMouseLeave={handleTabMouseLeave}
          onTabContextMenu={handleTabContextMenu}
          onTabDelete={handleDeleteTab}
          onTabClick={(uuid) => {
            SetActive(uuid)
          }}
          sensors={sensors}
          showGroupHeader={false}
          isPlayingRegistry={isPlayingRegistry}
        />
      </div>
      <div className={clsx(
        "w-full relative z-10",
        Object.keys(tabs).length > 0 ? "-translate-y-2" : "-translate-y-3"
      )}>
        <motion.button
          onClick={async () => {
            addTab()
          }}
          className={clsx(
            "w-full h-[36px] flex items-center gap-3 rounded-lg  text-sm hover:bg-[hsl(var(--hover))] transition-colors",
          )}>
          <Plus className="relative h-4 w-4 min-w-[20px] transition-all duration-250 left-[7px]" />
          <Aspan isCollapsed={isCollapsedSidebar} className="text-xs">New Tab</Aspan>
        </motion.button>
      </div>
      <div className="flex-1">
      </div>
      <div className={clsx("overflow-hidden w-full flex items-center transition-colors rounded-lg"
        , isCollapsedSidebar ? "py-1" : "py-2 bg-[hsl(var(--hover))]/40 hover:bg-[hsl(var(--hover))] border-[1px] border-accent/10 dark:border-accent/5"
      )}>
        <Dropdown onOpenChange={async (o) => {
          if (o) {
            if (mainWebviewRef.current && mainWindowRef.current) await mainWebviewRef.current.reparent(mainWindowRef.current)
          }
          setSettingsDropdown(o)
        }}
          content={[
            // {
            //   content: <div> Switch Workspace </div>,
            //   shortcut: <ArrowLeftRight size={16} />,
            //   children: null,
            //   separator: false,
            //   trigger: () => {
            //     setIsSwitchWorkspace(true);
            //   }
            // },

            {
              content: <div> Agents </div>,
              shortcut: <Drama size={16} />,
              children: null,
              separator: false,
              trigger: () => {
                setShowAgentsDialog(true);
              }
            },
            {
              content: <div> Controllable Browsers </div>,
              shortcut: <EarthIcon size={16} />,
              children: null,
              separator: false,
              trigger: () => {
                setShowControllableBrowsersDialog(true);
              }
            },
            {
              content: <div> Tasks </div>,
              shortcut: <AlarmCheck size={16} />,
              children: null,
              separator: false,
              trigger: () => {
                setShowTaskDialog(true);
              }
            },
            {
              content: <div> Tools </div>,
              shortcut: <Wrench size={16} />,
              children: null,
              separator: false,
              trigger: () => {
                setShowToolsDialog(true);
              }
            },
            ...(typeof window !== 'undefined' && !!(window as any).__TAURI__ && !llamaCppOrMlxIsInstalled) ? [{
              content: <div> Local Models </div>,
              shortcut: isInstalling ? <Spinner /> : <div>Install</div>,
              children: null,
              separator: false,
              trigger: async () => {
                if (!isInstalling) {
                  setIsInstalling(true);
                  await pyInvoke('install_local_backend');
                }
              }
            }] : [],
            ...(typeof window !== 'undefined' && !!(window as any).__TAURI__ && llamaCppOrMlxIsInstalled) ? [{
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
              shortcut: theme === "dark" ? <div>On</div> : <div>Off</div>,
              children: null,
              separator: false,
              trigger: () => {
                Theme.theme = theme === "dark" ? "light" : "dark";
              }
            },
            {
              content: <div> Layout </div>,
              shortcut: layout === "leftToRight" ? <div>Left To Right</div> : <div>Right To Left</div>,
              children: null,
              separator: false,
              trigger: () => {
                Theme.layout = layout === "leftToRight" ? "rightToLeft" : "leftToRight";
              }
            }
          ]}>
          <motion.button
            className={clsx(
              "focus:outline-none flex items-center gap-5 flex-1",
            )}>
            <div className={clsx(
              "w-8 h-8 relative flex items-center justify-center rounded-full",
              isCollapsedSidebar ? "left-[0px]" : "left-[10px]",
              isCollapsedSidebar ? "bg-white/10" : "bg-transparent",
            )}>
              <Settings className={clsx(
                "h-5 w-5 min-w-[20px] transition-all duration-250",
              )} />
            </div>
            <div className="flex flex-1 flex-col text-left">
              <Aspan className={clsx("text-md relative flex items-center gap-1")} isCollapsed={isCollapsedSidebar}>
                Settings
              </Aspan>
              <Aspan className="text-xs" isCollapsed={isCollapsedSidebar}><span className="opacity-[0.5]">
                v0.1.0
              </span></Aspan>
            </div>
          </motion.button>
        </Dropdown>
        <svg
          onClick={() => {
            if (isTauri) {
              addTab({
                childrenProps: {
                  [uuidv4()]: {
                    icon: "Compass",
                    title: null,
                    appname: "main-app",
                    data: { url: 'https://discord.gg/JWeqhecqBD' }
                  }
                }
              });
            } else {
              window.open('https://discord.gg/JWeqhecqBD', '_blank')
            }
          }}
          style={{
            display: isCollapsedSidebar ? "none" : "block"
          }} className="cursor-pointer mr-2 rounded-full opacity-50 hover:opacity-100 w-6 h-6 flex items-center overflow-hidden relative" width="64px" height="64px" viewBox="0 -28.5 256 256" version="1.1" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid" fill="#000000">
          <g id="SVGRepo_bgCarrier" />
          <g id="SVGRepo_tracerCarrier" />
          <g id="SVGRepo_iconCarrier"> <g> <path d="M216.856339,16.5966031 C200.285002,8.84328665 182.566144,3.2084988 164.041564,0 C161.766523,4.11318106 159.108624,9.64549908 157.276099,14.0464379 C137.583995,11.0849896 118.072967,11.0849896 98.7430163,14.0464379 C96.9108417,9.64549908 94.1925838,4.11318106 91.8971895,0 C73.3526068,3.2084988 55.6133949,8.86399117 39.0420583,16.6376612 C5.61752293,67.146514 -3.4433191,116.400813 1.08711069,164.955721 C23.2560196,181.510915 44.7403634,191.567697 65.8621325,198.148576 C71.0772151,190.971126 75.7283628,183.341335 79.7352139,175.300261 C72.104019,172.400575 64.7949724,168.822202 57.8887866,164.667963 C59.7209612,163.310589 61.5131304,161.891452 63.2445898,160.431257 C105.36741,180.133187 151.134928,180.133187 192.754523,160.431257 C194.506336,161.891452 196.298154,163.310589 198.110326,164.667963 C191.183787,168.842556 183.854737,172.420929 176.223542,175.320965 C180.230393,183.341335 184.861538,190.991831 190.096624,198.16893 C211.238746,191.588051 232.743023,181.531619 254.911949,164.955721 C260.227747,108.668201 245.831087,59.8662432 216.856339,16.5966031 Z M85.4738752,135.09489 C72.8290281,135.09489 62.4592217,123.290155 62.4592217,108.914901 C62.4592217,94.5396472 72.607595,82.7145587 85.4738752,82.7145587 C98.3405064,82.7145587 108.709962,94.5189427 108.488529,108.914901 C108.508531,123.290155 98.3405064,135.09489 85.4738752,135.09489 Z M170.525237,135.09489 C157.88039,135.09489 147.510584,123.290155 147.510584,108.914901 C147.510584,94.5396472 157.658606,82.7145587 170.525237,82.7145587 C183.391518,82.7145587 193.761324,94.5189427 193.539891,108.914901 C193.539891,123.290155 183.391518,135.09489 170.525237,135.09489 Z" fill="#ffffff" fillRule="nonzero"> </path> </g> </g>
        </svg>
        <div
          onClick={
            () => {
              if (isTauri) {
                addTab({
                  childrenProps: {
                    [uuidv4()]: {
                      icon: "Compass",
                      title: null,
                      appname: "main-app",
                      data: { url: repository || 'https://github.com/hafidzip/openbrowserclaw' }
                    }
                  }
                });
              } else {
                window.open(repository || 'https://github.com/hafidzip/openbrowserclaw', '_blank')
              }
            }
          }
          style={{
            display: isCollapsedSidebar ? "none" : "block"
          }} className="mr-2 opacity-50 hover:opacity-100 w-6 h-6 flex items-center justify-center overflow-hidden relative">
          <GitBranch className="p-[1px] cursor-pointer relative" />
        </div>
      </div>

      {showPopup && hoveredTabId && Object.keys(allTabs).includes(hoveredTabId) && (
        <div
          key={hoveredTabId}
          style={{ zIndex: 50, top: popupTop }}
          className={clsx("absolute pl-4", layout === "rightToLeft" ? "right-full" : "left-full")}
          onMouseEnter={() => {
            if (hideTimeoutRef.current) {
              clearTimeout(hideTimeoutRef.current);
              hideTimeoutRef.current = null;
            }
          }}
          onMouseLeave={handleTabMouseLeave}
        >
          <div className="w-fit min-w-64 max-w-72 p-2 rounded-xl border bg-card text-card-foreground shadow-lg bg-opacity-95 ">
            <div className="flex gap-2 items-center">
              {<Fragment key="icon-section">
                {
                  allTabs[hoveredTabId].iconOverride ? <Fragment key="icon-override">
                    <div
                      onClick={() => {
                        TabState[hoveredTabId].iconOverride = null;
                        window.dispatchEvent(new CustomEvent("tab-update", {
                          detail: {
                            tabId: hoveredTabId,
                            title: TabState[hoveredTabId].title,
                            icon: 'default',
                          }
                        }))
                      }}
                      className={clsx(
                        "p-2 relative rounded-lg overflow-hidden cursor-pointer transition-colors border-r border-r-[hsl(var(--chat-border))] hover:bg-[hsl(var(--hover))]",
                      )}>
                      <div className="absolute flex items-center justify-center top-0 right-0 w-full h-full bg-[hsl(var(--hover))] opacity-0 hover:opacity-100">
                        <X className="h-4 w-4" />
                      </div>
                      <TabIcon iconVal={allTabs[hoveredTabId].iconOverride || "Compass"} />
                    </div>
                  </Fragment> :
                    <IconPopover onSelect={(icon) => {
                      TabState[hoveredTabId].iconOverride = icon;
                      window.dispatchEvent(new CustomEvent("tab-update", {
                        detail: {
                          tabId: hoveredTabId,
                          title: TabState[hoveredTabId].title,
                          icon
                        }
                      }))
                      setShowPopup(false);
                      setHoveredTabId(null);
                    }}>
                      <div className={clsx(
                        "p-2 rounded-lg cursor-pointer transition-colors border-r border-r-[hsl(var(--chat-border))] hover:bg-[hsl(var(--hover))]",
                      )}>
                        <TabIcon iconVal={allTabs[hoveredTabId].iconOverride || "Compass"} />
                      </div>
                    </IconPopover>
                }
              </Fragment>}
              <Fragment key="title">
                {editingTitleTabId === hoveredTabId ? (
                  <input
                    type="text"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const tab = TabState[hoveredTabId];
                        if (tab) {
                          TabState[hoveredTabId].title = tempTitle;
                          window.dispatchEvent(new CustomEvent("tab-update", {
                            detail: {
                              tabId: hoveredTabId,
                              title: tempTitle,
                              icon: TabState[hoveredTabId].iconOverride
                            }
                          }))
                        }
                        setEditingTitleTabId(null);
                      } else if (e.key === "Escape") {
                        setEditingTitleTabId(null);
                      }
                    }}
                    onBlur={() => {
                      const tab = TabState[hoveredTabId];
                      if (tab && tab.hasChildren) {
                        const firstChildKey = Object.keys(tab.childrenProps)[0];
                        if (firstChildKey && tab.childrenProps[firstChildKey]) {
                          tab.childrenProps[firstChildKey].title = tempTitle;
                        }
                      }
                      setEditingTitleTabId(null);
                    }}
                    className="bg-transparent border-b border-primary text-foreground focus:outline-none font-semibold text-xs w-full flex-1 min-w-0"
                    autoFocus
                  />
                ) : (
                  <span
                    className="cursor-pointer hover:underline text-xs flex-1 min-w-0 truncate"
                    onClick={() => {
                      setEditingTitleTabId(hoveredTabId);
                      setTempTitle(allTabs[hoveredTabId].title || "");
                    }}
                  >
                    {allTabs[hoveredTabId].title || "Untitled"}
                  </span>
                )}
              </Fragment>
              {/* Pin/Unpin Toggle Button */}
              <div
                key="pin-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  if (hoveredTabId) {
                    const currentGroup = allTabs[hoveredTabId]?.group;
                    const newGroup = currentGroup === "pinned" ? null : "pinned";
                    setTabGroup(hoveredTabId, newGroup);
                    setShowPopup(false);
                    setHoveredTabId(null);
                  }
                }}
                className={clsx(
                  "cursor-pointer ml-auto p-1 rounded-md transition-colors",
                  allTabs[hoveredTabId]?.group === "pinned"
                    ? "bg-primary text-primary-foreground"
                    : "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
                )}
              >
                <Pin className="h-4 w-4" />
              </div>
            </div>
          </div>
        </div>
      )}
      <DialogUI open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col border-accent/20 bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-funnel">
              <Settings className="w-5 h-5 text-accent" />
              Settings
            </DialogTitle>
          </DialogHeader>
          <SettingsMenu />
        </DialogContent>
      </DialogUI>
      <DialogUI open={showControllableBrowsersDialog} onOpenChange={setShowControllableBrowsersDialog}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col border-accent/20 bg-card p-0 overflow-hidden shadow-2xl">
          <DialogHeader className="px-6">
            <DialogTitle className="text-lg font-medium pt-10 text-foreground/90">
              <div className="relative w-full border border-[hsl(var(--chat-border))] flex items-center gap-2 bg-[hsl(var(--float))] rounded-full px-4 shadow-sm focus-within:ring-1 focus-within:ring-accent/30 transition-all">
                <Search className="w-4 h-4 text-muted-foreground" />
                <input
                  placeholder="Search browsers..."
                  className="bg-transparent border-none p-2 w-full h-10 focus-visible:ring-0 text-sm"
                  value={searchControllableBrowsersQuery}
                  onChange={(e) => setSearchControllableBrowsersQuery(e.target.value)}
                  autoFocus
                />
              </div>
            </DialogTitle>
          </DialogHeader>
          <ControllableBrowsers workspace={workspace} isOpen={showControllableBrowsersDialog} setOpen={setShowControllableBrowsersDialog} query={searchControllableBrowsersQuery} />
        </DialogContent>
      </DialogUI>
      <DialogUI open={showAgentsDialog} onOpenChange={setShowAgentsDialog}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col border-accent/20 bg-card p-0 overflow-hidden shadow-2xl">
          <DialogHeader className="px-6">
            <DialogTitle className="text-lg font-medium pt-10 text-foreground/90">
              <div className="relative w-full border border-[hsl(var(--chat-border))] flex items-center gap-2 bg-[hsl(var(--float))] rounded-full px-4 shadow-sm focus-within:ring-1 focus-within:ring-accent/30 transition-all">
                <Search className="w-4 h-4 text-muted-foreground" />
                <input
                  placeholder="Search agents..."
                  className="bg-transparent border-none p-2 w-full h-10 focus-visible:ring-0 text-sm"
                  value={searchAgentsQuery}
                  onChange={(e) => setSearchAgentsQuery(e.target.value)}
                  autoFocus
                />
              </div>
            </DialogTitle>
          </DialogHeader>
          <Agents workspace={workspace} isOpen={showAgentsDialog} setOpen={setShowAgentsDialog} query={searchAgentsQuery} />
        </DialogContent>
      </DialogUI>
      <DialogUI open={showTaskDialog} onOpenChange={setShowTaskDialog}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col border-accent/20 bg-card p-0 overflow-hidden shadow-2xl">
          <DialogHeader className="px-6">
            <DialogTitle className="text-lg font-medium pt-10 text-foreground/90">
              <div className="relative w-full border border-[hsl(var(--chat-border))] flex items-center gap-2 bg-[hsl(var(--float))] rounded-full px-4 shadow-sm focus-within:ring-1 focus-within:ring-accent/30 transition-all">
                <Search className="w-4 h-4 text-muted-foreground" />
                <input
                  placeholder="Search task..."
                  className="bg-transparent border-none p-2 w-full h-10 focus-visible:ring-0 text-sm"
                  value={searchTaskQuery}
                  onChange={(e) => setSearchTaskQuery(e.target.value)}
                  autoFocus
                />
              </div>
            </DialogTitle>
          </DialogHeader>
          <Tasks openInTab={true} workspace={workspace} isOpen={showTaskDialog} setOpen={setShowTaskDialog} query={searchTaskQuery} />
        </DialogContent>
      </DialogUI>
      <DialogUI open={showSearchDialog} onOpenChange={setShowSearchDialog}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col border-accent/20 bg-card p-0 overflow-hidden shadow-2xl">
          <SearchDialogBody workspace={workspace} isOpen={showSearchDialog} setOpen={setShowSearchDialog} />
        </DialogContent>
      </DialogUI>
      <DialogUI open={showCredentialsDialog} onOpenChange={setShowCredentialsDialog}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col border-accent/20 bg-card p-0 overflow-hidden shadow-2xl">
          <DialogHeader>
            <DialogTitle className="hidden">
              Credentials
            </DialogTitle>
          </DialogHeader>
          <Credentials isOpen={showCredentialsDialog} />
        </DialogContent>
      </DialogUI>
      <DialogUI open={showLocalModelDialog} onOpenChange={setShowLocalModelDialog}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col border-accent/20 bg-card p-0 overflow-hidden shadow-2xl">
          <DialogHeader>
            <DialogTitle className="hidden">
              Local Models
            </DialogTitle>
          </DialogHeader>
          <LocalModel
            selectModel={selectModel}
            isOpen={showLocalModelDialog}
            addLocalModel={addLocalModel}
            deleteLocalModel={deleteLocalModel}
          />
        </DialogContent>
      </DialogUI>
      <DialogUI open={showMcpDialog} onOpenChange={setShowMcpDialog}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col border-accent/20 bg-card p-0 overflow-hidden shadow-2xl">
          <DialogHeader>
            <DialogTitle className="hidden">
              MCP Servers
            </DialogTitle>
          </DialogHeader>
          <McpServers
            isOpen={showMcpDialog}
            mcpStatuses={mcpStatuses}
          />
        </DialogContent>
      </DialogUI>
      <DialogUI open={showCustomEndpointDialog} onOpenChange={setShowCustomEndpointDialog}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col border-accent/20 bg-card p-0 overflow-hidden shadow-2xl">
          <DialogHeader>
            <DialogTitle className="hidden">
              Custom Endpoints
            </DialogTitle>
          </DialogHeader>
          <CustomEndpoint
            endpoints={s.settings["openchad/ProxyModelProvider/custom.endpoints"]?.value}
            addEndpoint={addEndpoint}
            deleteEndpoint={deleteEndpoint}
          />
        </DialogContent>
      </DialogUI>
      <DialogUI open={showToolsDialog} onOpenChange={setShowToolsDialog}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col border-accent/20 bg-card p-0 overflow-hidden shadow-2xl">
          <DialogHeader>
            <DialogTitle className="hidden">
              Tools
            </DialogTitle>
          </DialogHeader>
          <Tools isOpen={showToolsDialog} />
        </DialogContent>
      </DialogUI>
    </div>
  )
}