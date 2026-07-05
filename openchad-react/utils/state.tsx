import { initGlobal, getGlobal, setGlobal, notifyGlobal } from '../components/useGlobal/useGlobal';
export { getGlobal, setGlobal, initGlobal };
import { useGlobal } from '../components/useGlobal';
import uuidv4 from "./uuid";
import { sha256 } from 'js-sha256';
import { cleanupPersistentIframe } from "../components/iframe-mirror";

function generateIdFromString(input: string): string {
    return "tb" + "_" + sha256(input).slice(0, 32);
}
import * as Icons from "lucide-react"
import type { AppInfo } from "./utils";
import clsx from 'clsx';
import { getAllWebviews } from '@tauri-apps/api/webview';
import { AsyncLock } from './../index';
import { invoke } from '@tauri-apps/api/core';

export const LucideIcons = Icons

export const iconList = (() => {
    const seen = new Set<unknown>();
    const result: string[] = [];

    for (const [key, value] of Object.entries(LucideIcons)) {
        if (
            key !== "icons" &&
            key !== "createLucideIcon" &&
            key !== "Icon" &&
            /^[A-Z]/.test(key) &&
            !seen.has(value)          // skip if we've already added this component
        ) {
            seen.add(value);
            result.push(key);
        }
    }

    return result;
})() as (keyof typeof LucideIcons)[];

export interface Model {
    id: string;
    name: string;
    uncensored: boolean;
    audio: boolean;
    image: boolean;
    video: boolean;
    media: boolean;
    local: boolean;
    url?: string;
    downloaded?: boolean;
}

// ============================================================================
// MenuBar
// ============================================================================
export interface MenuBarState { tabId: string; appId: string; }
initGlobal<MenuBarState>("MenuBar", { tabId: "", appId: "" });
export const useMenuBarState = () => useGlobal<MenuBarState>("MenuBar", { initialValue: { tabId: "", appId: "" } });
export const setMenuBarTabId = (tabId: string) =>
    setGlobal<MenuBarState>("MenuBar", p => ({ ...(p ?? { tabId: "", appId: "" }), tabId }));
export const setMenuBarAppId = (appId: string) =>
    setGlobal<MenuBarState>("MenuBar", p => ({ ...(p ?? { tabId: "", appId: "" }), appId }));
/** @deprecated use useMenuBarState() or setMenuBarTabId/setMenuBarAppId */
export const MenuBar = {
    get tabId() { return getGlobal<MenuBarState>("MenuBar")?.tabId ?? ""; },
    set tabId(v: string) { setMenuBarTabId(v); },
    get appId() { return getGlobal<MenuBarState>("MenuBar")?.appId ?? ""; },
    set appId(v: string) { setMenuBarAppId(v); },
};

// ============================================================================
// BrowserNavState
// ============================================================================
export interface BrowserNavEntry { canGoBack: boolean; canGoForward: boolean; }
initGlobal<Record<string, BrowserNavEntry>>("BrowserNavState", {});
export const useBrowserNavState = () =>
    useGlobal<Record<string, BrowserNavEntry>>("BrowserNavState", { initialValue: {} });
export const setBrowserNav = (appId: string, nav: Partial<BrowserNavEntry>) => {
    const cur = getGlobal<Record<string, BrowserNavEntry>>("BrowserNavState") ?? {};
    const existing = cur[appId] ?? { canGoBack: false, canGoForward: false };
    setGlobal("BrowserNavState", { ...cur, [appId]: { ...existing, ...nav } });
};
/** @deprecated use useBrowserNavState() or setBrowserNav() */
export const BrowserNavState = new Proxy({} as Record<string, BrowserNavEntry>, {
    get(_t, key: string) {
        return getGlobal<Record<string, BrowserNavEntry>>("BrowserNavState")?.[key];
    },
    set(_t, key: string, value: BrowserNavEntry) {
        const cur = getGlobal<Record<string, BrowserNavEntry>>("BrowserNavState") ?? {};
        setGlobal("BrowserNavState", { ...cur, [key]: value });
        return true;
    },
    deleteProperty(_t, key: string) {
        const cur = getGlobal<Record<string, BrowserNavEntry>>("BrowserNavState") ?? {};
        const { [key]: _, ...rest } = cur;
        setGlobal("BrowserNavState", rest);
        return true;
    }
});

/** Per-appId handler registry — plain object so refs don't get proxied */
export const BrowserHandlers: Record<string, {
  navigate?: (url: string) => void;
  back?: () => void;
  forward?: () => void;
  refresh?: () => void;
  addressBarClick?: () => void;
}> = {}

// ============================================================================
// Workspace
// ============================================================================
export interface WorkspaceState { workspace: string | null; }
initGlobal<WorkspaceState>("Workspace", { workspace: null });
export const useWorkspaceState = () => useGlobal<WorkspaceState>("Workspace", { initialValue: { workspace: null } });
export const setWorkspace = (workspace: string | null) =>
    setGlobal<WorkspaceState>("Workspace", { workspace });
/** @deprecated use useWorkspaceState() */
export const Workspace = {
    get workspace() { return getGlobal<WorkspaceState>("Workspace")?.workspace ?? null; },
    setWorkspace,
};

export function formatTaskTime(timestamp: number) {
    const date = new Date(timestamp);
    const now = new Date();
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
        date.getDate() === yesterday.getDate() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getFullYear() === yesterday.getFullYear();
    if (isToday) return `${time} Today`;
    if (isYesterday) return `${time} Yesterday`;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${time} ${day}/${month}/${year}`;
}

// ============================================================================
// Theme
// ============================================================================
export interface ThemeState { theme: string; layout: string; }
initGlobal<ThemeState>("Theme", { theme: "dark", layout: "rightToLeft" });
export const useThemeState = () => useGlobal<ThemeState>("Theme", { initialValue: { theme: "dark", layout: "rightToLeft" } });
export const setTheme = (theme: string) =>
    setGlobal<ThemeState>("Theme", p => ({ ...(p ?? { theme: "dark", layout: "rightToLeft" }), theme }));
export const setThemeLayout = (layout: string) =>
    setGlobal<ThemeState>("Theme", p => ({ ...(p ?? { theme: "dark", layout: "rightToLeft" }), layout }));
/** @deprecated use useThemeState() */
export const Theme = {
    get theme() { return getGlobal<ThemeState>("Theme")?.theme ?? "dark"; },
    set theme(v: string) { setTheme(v); },
    get layout() { return getGlobal<ThemeState>("Theme")?.layout ?? "rightToLeft"; },
    set layout(v: string) { setThemeLayout(v); },
};

// Interface for credential structure
export interface Credential {
    activity: Record<number, number>; // timestamp -> amount
    value: string; // API key value
    credits: string;
    addActivity: (amount: number) => void;
    spending: (startDate?: number) => number;
}

export interface ITab {
    iconOverride: string | null;
    defaultIcon: React.ComponentType<{ className: string }>;
    IconOverrideComponent: ({ className }: { className: string }) => React.ReactNode;
    icon: ({ className }: { className: string }) => React.ReactNode;
    title: string | null;
    layout: string;
    isMuted: boolean;
    hasChildren: boolean;
    children: string[];
    group: string | null;
    size: number[],
    childrenProps: Record<string, {
        title: string | null,
        appname: string,
        icon: string,
        data: any,
    }>;
}

export const AppComponents: Record<string, React.ComponentType<any> | React.ComponentType> = {};
export const Apps: Record<string, Record<string, React.ComponentType<any> | React.ComponentType>> = {};

export const icons: Record<string, React.ComponentType<{ className: string }>> = {
    default: LucideIcons.Compass,
}

export interface ChildProp {
    title: string | null;
    appname: string;
    icon: string;
    data: any;
}
interface CreateTabParams {
    group?: string | null;
    title?: string | null;
    iconOverride?: string | null;
    layout?: string | null;
    childrenProps?: Record<string, ChildProp>;
    isMuted?: boolean;
    size?: number[],
}

export function createTab({
    group = null,
    title = null,
    iconOverride = null,
    layout = null,
    childrenProps = {},
    isMuted = false,
    size = [50, 50, 50, 50, 50],
}: CreateTabParams = {}): ITab {
    // Create default children if none provided
    const finalChildrenProps = Object.keys(childrenProps).length === 4
        ? childrenProps
        : {
            [uuidv4()]: {
                icon: "default",
                title: title,
                appname: "default",
                data: null,
            },
            [uuidv4()]: {
                icon: "default",
                title: title,
                appname: "default",
                data: null,
            },
            [uuidv4()]: {
                icon: "default",
                title: title,
                appname: "default",
                data: null,
            },
            [uuidv4()]: {
                icon: "default",
                title: title,
                appname: "default",
                data: null,
            },
        };
    return {
        group,
        iconOverride,
        size,
        isMuted,
        get IconOverrideComponent() {
            return ({ className }: { className: string }) => {
                if (typeof this.iconOverride === 'string' && (this.iconOverride.startsWith('/') || this.iconOverride.startsWith('http') || /\.(png|jpg|jpeg|ico|svg|webp)$/i.test(this.iconOverride))) {
                    return <img src={this.iconOverride} className="w-4 h-4 object-contain rounded-sm" alt="" />;
                }
                if ((window as any).defaultIconRegistry && this.iconOverride) {
                    const Icon = (window as any).defaultIconRegistry[this.iconOverride] as React.ComponentType<{ className: string }>;
                    if (Icon) {
                        return <Icon className={className} />;
                    }
                }
                const Icon = LucideIcons[this.iconOverride as keyof typeof LucideIcons] as React.ComponentType<{ className: string }>;
                if (!Icon) return null;
                return <Icon className={className} />;
            };
        },
        get defaultIcon() {
            const firstChildKey = Object.keys(this.childrenProps)[0];
            const iconName = this.childrenProps[firstChildKey]?.icon || 'default';
            const Icon = LucideIcons[iconName as keyof typeof LucideIcons] as React.ComponentType<{ className: string }>;
            return Icon || icons.default;
        },
        get icon() {
            return ({ className }: { className: string }) => {
                if (typeof this.iconOverride === 'string' &&
                    (
                        this.iconOverride.startsWith('/') ||
                        this.iconOverride.startsWith('http') ||
                        this.iconOverride.startsWith('data:') ||
                        /\.(png|jpg|jpeg|ico|svg|webp)$/i.test(this.iconOverride)
                    )) {
                    return <img src={this.iconOverride} className={clsx(className, "object-contain")} alt="" />;
                }
                const Icon = LucideIcons[this.iconOverride as keyof typeof LucideIcons] as React.ComponentType<{ className: string }>;
                if (Icon) {
                    return <Icon className={className} />;
                }
                if ((window as any).defaultIconRegistry && this.iconOverride) {
                    const Icon = (window as any).defaultIconRegistry[this.iconOverride] as React.ComponentType<{ className: string }>;
                    if (Icon) {
                        return <Icon className={className} />;
                    }
                }
                return <LucideIcons.Compass className={className} />;
            };
        },
        title: title,
        layout: layout || "single",
        get hasChildren() {
            return this.children.length > 0;
        },
        get children() {
            return Object.keys(this.childrenProps);
        },
        childrenProps: finalChildrenProps,
    };
}

// ============================================================================
// KeyState
// ============================================================================
export interface KeyStateData {
    keys: Record<string, boolean>;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
}
const _initialKeys: Record<string, boolean> = {
    a: false, b: false, c: false, d: false, e: false, f: false, g: false,
    h: false, i: false, j: false, k: false, l: false, m: false, n: false,
    o: false, p: false, q: false, r: false, s: false, t: false, u: false,
    v: false, w: false, x: false, y: false, z: false,
    "0": false, "1": false, "2": false, "3": false, "4": false,
    "5": false, "6": false, "7": false, "8": false, "9": false,
    f1: false, f2: false, f3: false, f4: false, f5: false, f6: false,
    f7: false, f8: false, f9: false, f10: false, f11: false, f12: false,
    shift: false, control: false, alt: false, meta: false,
    arrowup: false, arrowdown: false, arrowleft: false, arrowright: false,
    home: false, end: false, pageup: false, pagedown: false,
    space: false, enter: false, escape: false, backspace: false, tab: false, delete: false,
    "`": false, "-": false, "=": false, "[": false, "]": false, "\\": false,
    ";": false, "'": false, ",": false, ".": false, "/": false,
    numpad0: false, numpad1: false, numpad2: false, numpad3: false, numpad4: false,
    numpad5: false, numpad6: false, numpad7: false, numpad8: false, numpad9: false,
    numpadadd: false, numpadsubtract: false, numpadmultiply: false,
    numpaddivide: false, numpaddecimal: false, numpadenter: false,
    capslock: false, numlock: false, scrolllock: false,
};
initGlobal<KeyStateData>("KeyState", { keys: { ..._initialKeys }, ctrl: false, shift: false, alt: false });
export const useKeyStateData = () => useGlobal<KeyStateData>("KeyState", { initialValue: { keys: { ..._initialKeys }, ctrl: false, shift: false, alt: false } });
export const setKey = (key: string, pressed: boolean) => {
    const cur = getGlobal<KeyStateData>("KeyState")!;
    cur.keys[key] = pressed;
    notifyGlobal("KeyState");
};
export const setCtrl = (ctrl: boolean) =>
    setGlobal<KeyStateData>("KeyState", p => ({ ...p!, ctrl }));
export const setShift = (shift: boolean) =>
    setGlobal<KeyStateData>("KeyState", p => ({ ...p!, shift }));
export const setAlt = (alt: boolean) =>
    setGlobal<KeyStateData>("KeyState", p => ({ ...p!, alt }));
export const clearKeys = () => {
    const cur = getGlobal<KeyStateData>("KeyState")!;
    Object.keys(cur.keys).forEach(k => { cur.keys[k] = false; });
    setGlobal<KeyStateData>("KeyState", { ...cur, ctrl: false, shift: false, alt: false });
};
/** @deprecated use useKeyStateData() or setKey/setCtrl/setShift/setAlt */
export const KeyState = {
    get keys() { return getGlobal<KeyStateData>("KeyState")!.keys; },
    setKey,
    clearKeys,
    get ctrl() { return getGlobal<KeyStateData>("KeyState")?.ctrl ?? false; },
    setCtrl,
    get shift() { return getGlobal<KeyStateData>("KeyState")?.shift ?? false; },
    setShift,
    get alt() { return getGlobal<KeyStateData>("KeyState")?.alt ?? false; },
    setAlt,
};

// ============================================================================
// TabState
// ============================================================================
initGlobal<Record<string, ITab>>("TabState", {});
export const useTabState = () => useGlobal<Record<string, ITab>>("TabState", { initialValue: {} });
/** @deprecated Read TabState directly in non-hook code via getGlobal("TabState") */
export const TabState = new Proxy({} as Record<string, ITab>, {
    get(_t, key: string) {
        return getGlobal<Record<string, ITab>>("TabState")?.[key];
    },
    set(_t, key: string, value: ITab) {
        const cur = getGlobal<Record<string, ITab>>("TabState") ?? {};
        setGlobal("TabState", { ...cur, [key]: value });
        return true;
    },
    deleteProperty(_t, key: string) {
        const cur = getGlobal<Record<string, ITab>>("TabState") ?? {};
        const { [key]: _, ...rest } = cur;
        setGlobal("TabState", rest);
        return true;
    },
    ownKeys() {
        return Object.keys(getGlobal<Record<string, ITab>>("TabState") ?? {});
    },
    has(_t, key: string) {
        return key in (getGlobal<Record<string, ITab>>("TabState") ?? {});
    },
    getOwnPropertyDescriptor(_t, key: string) {
        const cur = getGlobal<Record<string, ITab>>("TabState") ?? {};
        if (key in cur) return { configurable: true, enumerable: true, writable: true, value: cur[key] };
        return undefined;
    }
});

// ============================================================================
// DragState
// ============================================================================
export interface DragStateData {
    active: boolean;
    record: Record<string, string | null>;
    timeout: ReturnType<typeof setTimeout> | null;
}
initGlobal<DragStateData>("DragState", { active: false, record: {}, timeout: null });
export const useDragState = () => useGlobal<DragStateData>("DragState", { initialValue: { active: false, record: {}, timeout: null } });
export const setDragRecord = (key: string, id: string | null) => {
    const cur = getGlobal<DragStateData>("DragState")!;
    setGlobal<DragStateData>("DragState", { ...cur, record: { ...cur.record, [key]: id } });
};
export const clearDragState = () => {
    const cur = getGlobal<DragStateData>("DragState")!;
    setGlobal<DragStateData>("DragState", { ...cur, record: {} });
};
export const setDragActive = (active: boolean) =>
    setGlobal<DragStateData>("DragState", p => ({ ...p!, active }));
/** @deprecated use useDragState() or setDragRecord/clearDragState */
export const DragState = {
    get active() { return getGlobal<DragStateData>("DragState")?.active ?? false; },
    get record() { return getGlobal<DragStateData>("DragState")?.record ?? {}; },
    set: setDragRecord,
    clear: clearDragState,
    get timeout() { return getGlobal<DragStateData>("DragState")?.timeout ?? null; },
    get id() { return getGlobal<DragStateData>("DragState")?.record["id"] ?? null; },
    get over() { return getGlobal<DragStateData>("DragState")?.record["over"] ?? null; },
};

// ============================================================================
// Viewport
// ============================================================================
export interface ViewportState {
    width: number;
    height: number;
    overflowX: boolean;
    overflowY: boolean;
    aspectRatio: string;
}
initGlobal<ViewportState>("Viewport", { width: 0, height: 0, overflowX: false, overflowY: false, aspectRatio: "16:9" });
export const useViewport = () => useGlobal<ViewportState>("Viewport", { initialValue: { width: 0, height: 0, overflowX: false, overflowY: false, aspectRatio: "16:9" } });
export const setViewport = (update: Partial<ViewportState>) =>
    setGlobal<ViewportState>("Viewport", p => ({ ...p!, ...update }));
/** @deprecated use useViewport() */
export const Viewport = new Proxy({} as ViewportState, {
    get(_t, key: string) { return (getGlobal<ViewportState>("Viewport") as any)?.[key]; },
    set(_t, key: string, value: any) {
        setGlobal<ViewportState>("Viewport", p => ({ ...p!, [key]: value }));
        return true;
    }
});

// ============================================================================
// TabInfo
// ============================================================================
export interface TabInfoState {
    active: string;
    children: string[];
    layout: string;
    switchMode: boolean;
    size: number[];
}
const _initialTabInfo: TabInfoState = { active: "", children: [], layout: "single", switchMode: false, size: [100] };
initGlobal<TabInfoState>("TabInfo", { ..._initialTabInfo });
export const useTabInfo = () => useGlobal<TabInfoState>("TabInfo", { initialValue: { ..._initialTabInfo } });
export const setActive = (uuid: string) => {
    const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    const tab = tabState[uuid];
    setGlobal<TabInfoState>("TabInfo", p => ({
        ...p!,
        active: uuid,
        switchMode: false,
        layout: tab?.layout ?? p!.layout,
        children: tab ? Object.keys(tab.childrenProps) : p!.children,
        size: tab?.size ?? p!.size,
    }));
};
export const setTabInfoProp = <K extends keyof TabInfoState>(key: K, value: TabInfoState[K]) =>
    setGlobal<TabInfoState>("TabInfo", p => ({ ...p!, [key]: value }));
/** @deprecated use useTabInfo() or setActive/setTabInfoProp */
export const TabInfo = new Proxy({} as TabInfoState & { SetActive: (uuid: string) => void; icon: ({ className }: { className: string }) => React.ReactNode }, {
    get(_t, key: string) {
        if (key === "SetActive") return setActive;
        if (key === "icon") {
            const activeId = getGlobal<TabInfoState>("TabInfo")?.active ?? "";
            const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
            return tabState[activeId]?.icon || (() => null);
        }
        return (getGlobal<TabInfoState>("TabInfo") as any)?.[key];
    },
    set(_t, key: string, value: any) {
        setGlobal<TabInfoState>("TabInfo", p => ({ ...p!, [key]: value }));
        return true;
    }
});

// ============================================================================
// HoverState
// ============================================================================
export interface HoverStateData {
    current: HTMLElement | null;
    mousePos: { x: number; y: number };
}
initGlobal<HoverStateData>("HoverState", { current: null, mousePos: { x: 0, y: 0 } });
export const useHoverState = () => useGlobal<HoverStateData>("HoverState", { initialValue: { current: null, mousePos: { x: 0, y: 0 } } });
export const setHoverState = (update: Partial<HoverStateData>) =>
    setGlobal<HoverStateData>("HoverState", p => ({ ...p!, ...update }));
/** @deprecated use useHoverState() */
export const HoverState = new Proxy({} as HoverStateData, {
    get(_t, key: string) { return (getGlobal<HoverStateData>("HoverState") as any)?.[key]; },
    set(_t, key: string, value: any) {
        setGlobal<HoverStateData>("HoverState", p => ({ ...p!, [key]: value }));
        return true;
    }
});

// ============================================================================
// Helper functions for tab management
// ============================================================================

export const reorderTabs = (fromIndex: number, toIndex: number) => {
    const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    const entries = Object.entries(tabState);
    const [removed] = entries.splice(fromIndex, 1);
    entries.splice(toIndex, 0, removed);
    setGlobal("TabState", Object.fromEntries(entries));
};

export const reorderChildren = (uuid: string, fromIndex: number, toIndex: number) => {
    const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    const tab = tabState[uuid];
    if (!tab) return [];
    if (fromIndex === toIndex) {
        return Object.keys(tab.childrenProps);
    }
    console.log('Reorder called:', { fromIndex, toIndex });
    const entries = Object.entries(tab.childrenProps);
    console.log('Before:', entries.map(([k]) => k));
    // SWAP instead of move
    const temp = entries[fromIndex];
    entries[fromIndex] = entries[toIndex];
    entries[toIndex] = temp;
    console.log('After swap:', entries.map(([k]) => k));
    const newChildrenProps = {} as Record<string, any>;
    entries.forEach(([key, value]) => {
        newChildrenProps[key] = value;
    });
    tab.childrenProps = newChildrenProps;
    setGlobal("TabState", { ...tabState });
    console.log(Object.keys(tab.childrenProps));
    return Object.keys(tab.childrenProps);
};

export const deleteTab = (uuid: string) => {
    const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    const { [uuid]: _, ...rest } = tabState;
    // Filter out any entries where childrenProps is undefined/empty
    const filtered = Object.fromEntries(
        Object.entries(rest).filter(([_, entry]) => {
            const children = entry?.childrenProps;
            return children && typeof children === "object" && Object.keys(children).length > 0;
        })
    );
    setGlobal("TabState", filtered);
    cleanupPersistentIframe(uuid);
};

interface AddTabParams {
    uuid?: string;
    title?: string;
    iconOverride?: string | null;
    group?: string | null;
    layout?: string;
    childrenProps?: Record<string, ChildProp>;
    isMuted?: boolean;
    size?: number[];
}

export const addTab = ({
    uuid: predefinedUuid,
    title,
    iconOverride = null,
    group = null,
    layout,
    childrenProps,
    isMuted = false,
    size
}: AddTabParams = {}): string => {
    const uuid = predefinedUuid ?? uuidv4();
    let resolvedLayout = layout;
    let resolvedChildrenProps = childrenProps;
    if (childrenProps) {
        resolvedChildrenProps = { ...childrenProps }
        const currentChildrenCount = Object.keys(resolvedChildrenProps ?? {}).length;
        if (resolvedChildrenProps && currentChildrenCount > 0 && currentChildrenCount < 4) {
            for (let i = currentChildrenCount; i < 4; i++) {
                resolvedChildrenProps[uuidv4()] = {
                    icon: "default",
                    title: null,
                    appname: "default",
                    data: null,
                } as any;
            }
        }
    }
    const raw: number[] = (window as any).defaultSize ?? [];
    const defaultSize: number[] = Array.from(
        { length: 5 },
        (_, i) => raw[i] ?? 50
    );
    if (!resolvedChildrenProps) {
        const defaultTabs: Array<{ appname: string; data: any }> =
            (window as any).defaultTabs ?? [];
        const defaultLayout: string =
            (window as any).defaultLayout ?? "single";
        const defaultIcon: string =
            (window as any).defaultIcon ?? "default";
        resolvedLayout = resolvedLayout ?? defaultLayout;
        iconOverride = iconOverride ?? defaultIcon;
        if (defaultTabs.length > 0) {
            resolvedChildrenProps = {} as Record<string, ChildProp>;
            for (let i = 0; i < 4; i++) {
                if (defaultTabs[i]) {
                    resolvedChildrenProps[uuidv4()] = {
                        icon: defaultIcon,
                        title: null,
                        appname: defaultTabs[i].appname,
                        data: defaultTabs[i].data ?? {},
                    };
                } else {
                    resolvedChildrenProps[uuidv4()] = {
                        icon: "default",
                        title: null,
                        appname: "default",
                        data: null,
                    };
                }
            }
        }
    }
    const newTab = createTab({
        group,
        title,
        iconOverride,
        layout: resolvedLayout,
        childrenProps: resolvedChildrenProps,
        isMuted: isMuted,
        size: size ?? defaultSize
    });
    const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    setGlobal("TabState", { ...tabState, [uuid]: newTab });
    setActive(uuid);
    return uuid;
};

export const relayoutTab = (pkey: string) => {
    const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    const tab = tabState[pkey];
    if (!tab) return;
    const currentProps = tab.childrenProps;
    const entries = Object.entries(currentProps);
    const realApps = entries.filter(([_, prop]) => prop.appname !== "default" && prop.appname !== "select-tab");
    const newChildrenProps: Record<string, any> = {};
    realApps.forEach(([k, v]) => {
        newChildrenProps[k] = v;
    });
    const dummyKeys = ["default1", "default2", "default3"];
    let dummyIdx = 0;
    while (Object.keys(newChildrenProps).length < 4) {
        if (Object.keys(newChildrenProps).length === 0) {
            newChildrenProps[uuidv4()] = {
                icon: "default",
                title: null,
                appname: "default",
                data: null,
            };
        } else {
            const dKey = dummyKeys[dummyIdx] || `default${dummyIdx + 1}`;
            newChildrenProps[dKey] = {
                icon: "default",
                title: null,
                appname: "default",
                data: null,
            };
            dummyIdx++;
        }
    }
    tab.childrenProps = newChildrenProps;
    const realCount = realApps.length;
    if (realCount === 0) {
        const tabKeys = Object.keys(tabState);
        const oldIndex = tabKeys.indexOf(pkey);
        const { [pkey]: _, ...rest } = tabState;
        setGlobal("TabState", rest);
        const tabInfo = getGlobal<TabInfoState>("TabInfo")!;
        if (tabInfo.active === pkey) {
            const otherTabs = Object.keys(rest);
            if (otherTabs.length > 0) {
                const nextIndex = Math.min(oldIndex, otherTabs.length - 1);
                setActive(otherTabs[nextIndex]);
            } else {
                setGlobal<TabInfoState>("TabInfo", { active: "", children: [], layout: "single", size: [50, 50, 50, 50, 50], switchMode: false });
            }
        }
    } else {
        if (realCount === 1) { tab.layout = "single"; }
        else if (realCount === 2) { tab.layout = "horizontal"; }
        else if (realCount === 3) { tab.layout = "triple"; }
        else if (realCount === 4) { tab.layout = "grid2x2"; }
        setGlobal("TabState", { ...tabState });
        const tabInfo = getGlobal<TabInfoState>("TabInfo")!;
        if (tabInfo.active === pkey) {
            setGlobal<TabInfoState>("TabInfo", p => ({
                ...p!,
                layout: tab.layout,
                children: Object.keys(newChildrenProps),
                size: tab.size,
            }));
        }
    }
};

export const closeTab = (childrenKey: string) => {
    const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    const parentKey = Object.entries(tabState).find(([_, v]) => v.children.includes(childrenKey))?.[0];
    if (parentKey) {
        const tab = tabState[parentKey];
        delete tab.childrenProps[childrenKey];
        setGlobal("TabState", { ...tabState });
        relayoutTab(parentKey);
    }
};

export interface IApp {
    tabicon: string;
    data: Record<string, any>;
    title: string | null;
    MainComponent: React.ComponentType<AppInfo> | null;
}

export const detachTab = (childrenKey: string) => {
    const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    const parentKey = Object.entries(tabState).find(([_, v]) => v.children.includes(childrenKey))?.[0];
    if (parentKey) {
        const tab = tabState[parentKey];
        const childProp = tab.childrenProps[childrenKey];
        addTab({
            layout: "single",
            childrenProps: {
                [uuidv4()]: childProp,
                "default1": { icon: "default", title: null, appname: "default", data: null },
                "default2": { icon: "default", title: null, appname: "default", data: null },
                "default3": { icon: "default", title: null, appname: "default", data: null },
            }
        });
        delete tab.childrenProps[childrenKey];
        setGlobal("TabState", { ...tabState });
        relayoutTab(parentKey);
    }
};

export const getTabsByGroup = (group: string | null): Record<string, ITab> => {
    const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    return Object.fromEntries(
        Object.entries(tabState).filter(([_, tab]) => tab.group === group)
    );
};

export const getAllGroups = (): (string | null)[] => {
    const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    const groups = new Set<string | null>();
    Object.values(tabState).forEach(tab => groups.add(tab.group));
    return Array.from(groups);
};

export const setTabGroup = (uuid: string, group: string | null) => {
    const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    if (tabState[uuid]) {
        tabState[uuid].group = group;
        setGlobal("TabState", { ...tabState });
    }
};

export const reorderTabsInGroup = (group: string | null, fromIndex: number, toIndex: number) => {
    const allEntries = Object.entries(getGlobal<Record<string, ITab>>("TabState") ?? {});
    const groupEntries = allEntries.filter(([_, tab]) => tab.group === group);
    const [removed] = groupEntries.splice(fromIndex, 1);
    groupEntries.splice(toIndex, 0, removed);
    const groupOrder = getAllGroups();
    groupOrder.sort((a, b) => {
        if (a === null) return -1;
        if (b === null) return 1;
        return a.localeCompare(b);
    });
    const result: [string, ITab][] = [];
    groupOrder.forEach(g => {
        const entries = g === group ? groupEntries : allEntries.filter(([_, tab]) => tab.group === g);
        entries.forEach(e => result.push(e as [string, ITab]));
    });
    setGlobal("TabState", Object.fromEntries(result));
};

export const deleteActiveTabWithGroupSelection = async (): Promise<string | null> => {
    return await deleteTabWithGroupSelection(getGlobal<TabInfoState>("TabInfo")!.active);
}

export const deleteTabWithGroupSelection = async (uuid: string): Promise<string | null> => {
    await AsyncLock.acquire();
    const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    const tabToDelete = tabState[uuid];
    if (!tabToDelete) {
        AsyncLock.release();
        return null
    }
    const group = tabToDelete.group;
    const groupTabs = Object.keys(getTabsByGroup(group));
    const indexInGroup = groupTabs.indexOf(uuid);
    let nextTabId: string | null = null;
    const all = await getAllWebviews()
    Object.keys(tabToDelete.childrenProps).map(async (t: string) => {
        const w = all.find((wv) => wv.label === `webview-${t}`)
        if (w) {
            if (!t.startsWith('agent')) {
                await w.close()
            } else {
                await invoke('set_webview_muted', { label: `webview-${t}`, muted: true })
            }
        }
    })
    if (groupTabs.length > 1) {
        if (indexInGroup > 0) {
            nextTabId = groupTabs[indexInGroup - 1];
        } else if (indexInGroup < groupTabs.length - 1) {
            nextTabId = groupTabs[indexInGroup + 1];
        }
    } else {
        const allTabs = Object.keys(tabState).filter(id => id !== uuid);
        if (allTabs.length > 0) {
            const ungroupedTabs = allTabs.filter(id => tabState[id].group === null);
            nextTabId = ungroupedTabs.length > 0 ? ungroupedTabs[0] : allTabs[0];
        }
    }
    deleteTab(uuid);
    const tabInfo = getGlobal<TabInfoState>("TabInfo")!;
    const updatedTabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    if (tabInfo.active === uuid && nextTabId && typeof updatedTabState[nextTabId]?.childrenProps !== "undefined" && updatedTabState[nextTabId].childrenProps !== null) {
        setActive(nextTabId);
    }
    AsyncLock.release();
    return nextTabId;
};

export const clearAllTabs = async (pyInvoke?: any, workspace?: string | null) => {
    await AsyncLock.acquire();
    try {
        const all = await getAllWebviews();
        const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
        const tabUuids = Object.keys(tabState);

        if (pyInvoke) {
            const db = workspace ?? "global";
            await Promise.all(tabUuids.map(async (uuid) => {
                try {
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
                                try { val = JSON.parse(val); } catch { }
                            }
                            if (row.id === 'isStreaming') { isStreaming = !!val; }
                            else if (row.id === 'activeId') { activeId = String(val || ""); }
                            else if (row.id === 'dontStop') { dontStop = !!val; }
                        });
                        if (isStreaming && activeId && !dontStop) {
                            await pyInvoke("v1/chat/stop", { id: activeId });
                        }
                    }
                } catch (e) {
                    console.error(`Failed to stop running chat for tab ${uuid}:`, e);
                }
            }));
        }

        for (const uuid of tabUuids) {
            const tab = tabState[uuid];
            if (tab && tab.childrenProps) {
                await Promise.all(
                    Object.keys(tab.childrenProps).map(async (t: string) => {
                        const w = all.find((wv) => wv.label === `webview-${t}`);
                        if (w) {
                            if (!t.startsWith('agent')) {
                                await w.close();
                            }
                        }
                    })
                );
            }
            cleanupPersistentIframe(uuid);
        }
        setGlobal("TabState", {});
        setGlobal<TabInfoState>("TabInfo", { active: "", children: [], layout: "single", size: [100], switchMode: false });
    } finally {
        AsyncLock.release();
    }
};

export const moveTabToGroup = (uuid: string, targetGroup: string | null, insertAtIndex?: number) => {
    const tabState = getGlobal<Record<string, ITab>>("TabState") ?? {};
    if (!tabState[uuid]) return;
    const tab = tabState[uuid];
    const sourceGroup = tab.group;
    if (sourceGroup === targetGroup && insertAtIndex !== undefined) {
        const groupTabs = Object.keys(getTabsByGroup(targetGroup));
        const currentIndex = groupTabs.indexOf(uuid);
        if (currentIndex !== -1 && currentIndex !== insertAtIndex) {
            reorderTabsInGroup(targetGroup, currentIndex, insertAtIndex);
        }
        return;
    }
    tab.group = targetGroup;
    setGlobal("TabState", { ...tabState });
    if (insertAtIndex !== undefined) {
        const groupTabs = Object.keys(getTabsByGroup(targetGroup));
        const currentIndex = groupTabs.indexOf(uuid);
        if (currentIndex !== -1 && currentIndex !== insertAtIndex) {
            reorderTabsInGroup(targetGroup, currentIndex, insertAtIndex);
        }
    }
};
