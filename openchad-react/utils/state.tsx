import { proxy } from 'valtio';
import uuidv4 from "./uuid";
import { cleanupPersistentIframe } from "../components/iframe-mirror";
import * as Icons from "lucide-react"
import type { AppInfo } from "./utils";
import clsx from 'clsx';

export const LucideIcons = Icons

export const iconList = Object.keys(LucideIcons).filter((key) => {
    // Icons are React components (functions or objects with render) and usually start with uppercase
    // Some exports might be 'createLucideIcon', 'icons', etc.
    return key !== "icons" && key !== "createLucideIcon" && key !== "Icon" && /^[A-Z]/.test(key)
}) as (keyof typeof LucideIcons)[];

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

export const Workspace = proxy({
    workspace: null as string | null,
    setWorkspace: (workspace: string | null) => {
        Workspace.workspace = workspace;
    }
})

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

export const Theme = proxy({
    theme: "dark",
    layout: "rightToLeft",
})
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

export const AppComponents = proxy<Record<string, React.ComponentType<any> | React.ComponentType>>({});

export const Apps = proxy<Record<string, Record<string, React.ComponentType<any> | React.ComponentType>>>({});

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
    size?: number[],
}

export function createTab({
    group = null,
    title = null,
    iconOverride = null,
    layout = null,
    childrenProps = {},
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
                if (typeof this.iconOverride === 'string' && (this.iconOverride.startsWith('/') || this.iconOverride.startsWith('http') || /\.(png|jpg|jpeg|ico|svg|webp)$/i.test(this.iconOverride))) {
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

export const KeyState = proxy({
    keys: {
        // =====================
        // Letters
        // =====================
        a: false, b: false, c: false, d: false, e: false, f: false, g: false,
        h: false, i: false, j: false, k: false, l: false, m: false, n: false,
        o: false, p: false, q: false, r: false, s: false, t: false, u: false,
        v: false, w: false, x: false, y: false, z: false,
        // =====================
        // Numbers (top row)
        // =====================
        "0": false, "1": false, "2": false, "3": false, "4": false,
        "5": false, "6": false, "7": false, "8": false, "9": false,
        // =====================
        // Function keys
        // =====================
        f1: false, f2: false, f3: false, f4: false, f5: false, f6: false,
        f7: false, f8: false, f9: false, f10: false, f11: false, f12: false,
        // =====================
        // Modifiers
        // =====================
        shift: false,
        control: false,
        alt: false,
        meta: false, // Windows / Command key
        // =====================
        // Navigation
        // =====================
        arrowup: false,
        arrowdown: false,
        arrowleft: false,
        arrowright: false,
        home: false,
        end: false,
        pageup: false,
        pagedown: false,
        // =====================
        // Editing / system
        // =====================
        space: false,
        enter: false,
        escape: false,
        backspace: false,
        tab: false,
        delete: false,
        // =====================
        // Symbols
        // =====================
        "`": false,
        "-": false,
        "=": false,
        "[": false,
        "]": false,
        "\\": false,
        ";": false,
        "'": false,
        ",": false,
        ".": false,
        "/": false,
        // =====================
        // Numpad
        // =====================
        numpad0: false,
        numpad1: false,
        numpad2: false,
        numpad3: false,
        numpad4: false,
        numpad5: false,
        numpad6: false,
        numpad7: false,
        numpad8: false,
        numpad9: false,
        numpadadd: false,
        numpadsubtract: false,
        numpadmultiply: false,
        numpaddivide: false,
        numpaddecimal: false,
        numpadenter: false,
        // =====================
        // Locks
        // =====================
        capslock: false,
        numlock: false,
        scrolllock: false,
    } as Record<string, boolean>,
    setKey: (key: string, pressed: boolean) => {
        KeyState.keys[key] = pressed
    },
    clearKeys: () => {
        Object.keys(KeyState.keys).forEach(key => {
            KeyState.keys[key] = false;
        });
        KeyState.ctrl = false;
        KeyState.shift = false;
        KeyState.alt = false;
    },
    ctrl: false,
    setCtrl: (ctrl: boolean) => {
        KeyState.ctrl = ctrl;
    },
    shift: false,
    setShift: (shift: boolean) => {
        KeyState.shift = shift;
    },
    alt: false,
    setAlt: (alt: boolean) => {
        KeyState.alt = alt;
    },
})

export const TabState = proxy<Record<string, ITab>>({})

export const DragState = proxy(
    {
        active: false,
        record: {
            id: null as string | null,
            over: null as string | null
        } as Record<string, string | null>,
        set: (key: string, id: string | null) => {
            DragState.record[key] = id;
        },
        clear: () => {
            DragState.record = {};
        },
        timeout: null as NodeJS.Timeout | null,
        get id() {
            return DragState.record["id"];
        },
        get over() {
            return DragState.record["over"];
        }
    }
)

export const Viewport = proxy({
    width: 0,
    height: 0,
    overflowX: false,
    overflowY: false,
    aspectRatio: "16:9",
})

export const TabInfo = proxy({
    active: "",
    get icon() {
        return TabState[this.active]?.icon || (() => null);
    },
    children: [] as string[],
    layout: "single",
    switchMode: false,
    size: [100],
    SetActive: (uuid: string) => {
        TabInfo.active = uuid;
        TabInfo.switchMode = false;
        const tab = TabState[uuid];
        if (tab) {
            TabInfo.layout = tab.layout;
            TabInfo.children = tab.children;
            TabInfo.size = tab.size;
        }
    }
})
// Helper functions for tab management

export const reorderTabs = (fromIndex: number, toIndex: number) => {
    const entries = Object.entries(TabState);
    const [removed] = entries.splice(fromIndex, 1);
    entries.splice(toIndex, 0, removed);
    // Clear current state
    Object.keys(TabState).forEach(key => {
        delete TabState[key];
    });
    // Re-add with new indices
    entries.forEach(([key, value]) => {
        TabState[key] = value;
    });
};
// Helper functions for tab management

export const reorderChildren = (uuid: string, fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
        return Object.keys(TabState[uuid].childrenProps);
    }
    console.log('Reorder called:', { fromIndex, toIndex });
    const entries = Object.entries(TabState[uuid].childrenProps);
    console.log('Before:', entries.map(([k]) => k));
    // SWAP instead of move
    const temp = entries[fromIndex];
    entries[fromIndex] = entries[toIndex];
    entries[toIndex] = temp;
    console.log('After swap:', entries.map(([k]) => k));
    // Rebuild the object completely fresh
    const newChildrenProps = {} as Record<string, any>;
    entries.forEach(([key, value]) => {
        newChildrenProps[key] = value;
    });
    TabState[uuid].childrenProps = newChildrenProps;
    console.log(Object.keys(TabState[uuid].childrenProps));
    return Object.keys(TabState[uuid].childrenProps);
};

export const deleteTab = (uuid: string) => {
    delete TabState[uuid];
    // Filter out any entries where childrenProps is undefined/empty
    Object.keys(TabState).forEach((key) => {
        const entry = TabState[key];
        const children = entry?.childrenProps;
        if (!children || (typeof children === "object" && Object.keys(children).length === 0)) {
            delete TabState[key];
        }
    });
    cleanupPersistentIframe(uuid);
};
interface AddTabParams {
    uuid?: string;
    title?: string;
    iconOverride?: string | null;
    group?: string | null;
    layout?: string;
    childrenProps?: Record<string, ChildProp>;
    size?: number[];
}

export const addTab = ({
    uuid: predefinedUuid,
    title,
    iconOverride = null,
    group = null,
    layout,
    childrenProps,
    size
}: AddTabParams = {}): string => {
    const uuid = predefinedUuid ?? uuidv4();
    // When called with no childrenProps, fall back to the defaultTab
    // registered by Container via window.defaultTabs / window.defaultLayout
    let resolvedLayout = layout;
    let resolvedChildrenProps = childrenProps;
    const defaultSize: number[] =
        (window as any).defaultSize ?? [50, 50, 50, 50, 50];
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
    TabState[uuid] = createTab({
        group,
        title,
        iconOverride,
        layout: resolvedLayout,
        childrenProps: resolvedChildrenProps,
        size: size ?? defaultSize
    });
    TabInfo.SetActive(uuid);
    return uuid;
};

export const relayoutTab = (pkey: string) => {
    const currentProps = TabState[pkey].childrenProps;
    const entries = Object.entries(currentProps);
    // Separate real apps and dummy apps
    const realApps = entries.filter(([_, prop]) => prop.appname !== "default" && prop.appname !== "select-tab");
    // Construct new childrenProps with real apps first
    const newChildrenProps: Record<string, any> = {};
    realApps.forEach(([k, v]) => {
        newChildrenProps[k] = v;
    });
    // Fill remaining slots with dummies
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
    TabState[pkey].childrenProps = newChildrenProps;
    const realCount = realApps.length;
    if (realCount === 0) {
        const tabKeys = Object.keys(TabState);
        const oldIndex = tabKeys.indexOf(pkey);
        delete TabState[pkey];
        if (TabInfo.active === pkey) {
            const otherTabs = Object.keys(TabState);
            if (otherTabs.length > 0) {
                const nextIndex = Math.min(oldIndex, otherTabs.length - 1);
                TabInfo.SetActive(otherTabs[nextIndex]);
            } else {
                TabInfo.active = "";
                TabInfo.children = [];
                TabInfo.layout = "single";
                TabInfo.size = [50, 50, 50, 50, 50];
            }
        }
    } else {
        if (realCount === 1) {
            TabState[pkey].layout = "single";
        } else if (realCount === 2) {
            TabState[pkey].layout = "horizontal";
        } else if (realCount === 3) {
            TabState[pkey].layout = "triple";
        } else if (realCount === 4) {
            TabState[pkey].layout = "grid2x2";
        }
        if (TabInfo.active === pkey) {
            TabInfo.layout = TabState[pkey].layout;
            TabInfo.children = Object.keys(newChildrenProps);
            TabInfo.size = TabState[pkey].size;
        }
    }
};

export const closeTab = (childrenKey: string) => {
    const parentKey = Object.entries(TabState).find(([_, v]) => v.children.includes(childrenKey))?.[0];
    if (parentKey) {
        delete TabState[parentKey].childrenProps[childrenKey];
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
    const parentKey = Object.entries(TabState).find(([_, v]) => v.children.includes(childrenKey))?.[0];
    if (parentKey) {
        const childProp = TabState[parentKey].childrenProps[childrenKey];
        addTab({
            layout: "single",
            childrenProps: {
                [uuidv4()]: childProp,
                "default1": { icon: "default", title: null, appname: "default", data: null },
                "default2": { icon: "default", title: null, appname: "default", data: null },
                "default3": { icon: "default", title: null, appname: "default", data: null },
            }
        });
        delete TabState[parentKey].childrenProps[childrenKey];
        relayoutTab(parentKey);
    }
};
// Tab Group Management Utilities
/**
 * Get all tabs belonging to a specific group
 * @param group - Group name (null for ungrouped tabs)
 */

export const getTabsByGroup = (group: string | null): Record<string, ITab> => {
    return Object.fromEntries(
        Object.entries(TabState).filter(([_, tab]) => tab.group === group)
    );
};
/**
 * Get all unique group names from TabState
 */

export const getAllGroups = (): (string | null)[] => {
    const groups = new Set<string | null>();
    Object.values(TabState).forEach(tab => groups.add(tab.group));
    return Array.from(groups);
};
/**
 * Set a tab's group
 * @param uuid - Tab ID
 * @param group - Group name or null for ungrouped
 */

export const setTabGroup = (uuid: string, group: string | null) => {
    if (TabState[uuid]) {
        TabState[uuid].group = group;
    }
};
/**
 * Reorder tabs within a specific group
 * @param group - Group to reorder within
 * @param fromIndex - Original index within the group
 * @param toIndex - Target index within the group
 */

export const reorderTabsInGroup = (group: string | null, fromIndex: number, toIndex: number) => {
    // Get all tabs, separating by group
    const allEntries = Object.entries(TabState);
    const groupEntries = allEntries.filter(([_, tab]) => tab.group === group);
    // Reorder within the group
    const [removed] = groupEntries.splice(fromIndex, 1);
    groupEntries.splice(toIndex, 0, removed);
    // Reconstruct TabState maintaining group order
    // First reconstruct groups in their original order
    const groupOrder = getAllGroups();
    // Clear current state
    Object.keys(TabState).forEach(key => {
        delete TabState[key];
    });
    // Re-add tabs in order: null group first, then named groups alphabetically
    groupOrder.sort((a, b) => {
        if (a === null) return -1;
        if (b === null) return 1;
        return a.localeCompare(b);
    });
    groupOrder.forEach(g => {
        const entries = g === group ? groupEntries : allEntries.filter(([_, tab]) => tab.group === g);
        entries.forEach(([key, value]) => {
            TabState[key] = value;
        });
    });
};
/**
 * Delete a tab with auto-selection of next tab in the same group
 * @param uuid - Tab ID to delete
 * @returns The ID of the newly selected tab, or null if no tabs remain
 */

export const deleteTabWithGroupSelection = (uuid: string): string | null => {
    const tabToDelete = TabState[uuid];
    if (!tabToDelete) return null;
    const group = tabToDelete.group;
    const groupTabs = Object.keys(getTabsByGroup(group));
    const indexInGroup = groupTabs.indexOf(uuid);
    // Find next tab in the same group first
    let nextTabId: string | null = null;
    if (groupTabs.length > 1) {
        // Try to select next tab in same group
        if (indexInGroup > 0) {
            nextTabId = groupTabs[indexInGroup - 1];
        } else if (indexInGroup < groupTabs.length - 1) {
            nextTabId = groupTabs[indexInGroup + 1];
        }
    } else {
        // No more tabs in this group, find next in any group
        const allTabs = Object.keys(TabState).filter(id => id !== uuid);
        if (allTabs.length > 0) {
            // Prefer ungrouped tabs, then any other group
            const ungroupedTabs = allTabs.filter(id => TabState[id].group === null);
            nextTabId = ungroupedTabs.length > 0 ? ungroupedTabs[0] : allTabs[0];
        }
    }
    // Delete the tab
    deleteTab(uuid);
    // Update active tab if the deleted tab was active
    if (TabInfo.active === uuid && nextTabId && typeof TabState[nextTabId].childrenProps !== "undefined" && TabState[nextTabId].childrenProps !== null) {
        TabInfo.SetActive(nextTabId);
    }
    return nextTabId;
};
/**
 * Move a tab from one group to another
 * @param uuid - Tab ID
 * @param targetGroup - Target group name or null
 * @param insertAtIndex - Optional index to insert at within target group
 */

export const moveTabToGroup = (uuid: string, targetGroup: string | null, insertAtIndex?: number) => {
    if (!TabState[uuid]) return;
    const tab = TabState[uuid];
    const sourceGroup = tab.group;
    // If moving to the same group, just reorder
    if (sourceGroup === targetGroup && insertAtIndex !== undefined) {
        const groupTabs = Object.keys(getTabsByGroup(targetGroup));
        const currentIndex = groupTabs.indexOf(uuid);
        if (currentIndex !== -1 && currentIndex !== insertAtIndex) {
            reorderTabsInGroup(targetGroup, currentIndex, insertAtIndex);
        }
        return;
    }
    // Change the group
    tab.group = targetGroup;
    // If insert position specified, reorder to that position
    if (insertAtIndex !== undefined) {
        const groupTabs = Object.keys(getTabsByGroup(targetGroup));
        const currentIndex = groupTabs.indexOf(uuid);
        if (currentIndex !== -1 && currentIndex !== insertAtIndex) {
            reorderTabsInGroup(targetGroup, currentIndex, insertAtIndex);
        }
    }
};

export const HoverState = proxy<{
    current: HTMLElement | null;
    mousePos: { x: number, y: number };
}>({
    current: null,
    mousePos: { x: 0, y: 0 }
});
