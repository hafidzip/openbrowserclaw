import { useCallback, useEffect, useRef, useState } from 'react'
import { selectModel } from './components/sidebar'
import React from 'react'
import { usePython, usePythonEvent } from './components/usePython'
import { useSettings } from './components/useSettings'
import { Dialog as DialogUI, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog"
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "./components/ui/context-menu"

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;

import { register, unregister, isRegistered } from "@tauri-apps/plugin-global-shortcut"
import { getCurrentWindow, cursorPosition } from '@tauri-apps/api/window';

let shortcutPromiseChain = Promise.resolve();




import { hideSplashScreen } from "vite-plugin-splash-screen/runtime";
import LocalModel from './components/localmodel'
import Credentials from './components/credentials'
import CustomEndpoint from './components/customendpoint'
import McpServers from './components/mcp'
import { useGlobal } from '.'
import { Button } from './ui'
import { Check, Code, GitBranch, Globe, HardDrive, Key, Plus, Settings, X } from 'lucide-react'
import clsx from 'clsx'
import { Dropdown } from './components/dropdown'
import { openUrl } from '@tauri-apps/plugin-opener'
import uuidv4 from './utils/uuid'
import Markdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'


export type OverlayApps = {
    id: string;
    App: React.ComponentType;
    pos: {
        x: number;
        y: number;
    }
    rotation: number;
    scale: number;
    html?: string;
    mdx?: string;
}

// ---------------------------------------------------------------------------
// Factory functions for creating custom HTML / MDX overlay source components
// ---------------------------------------------------------------------------
function parseStyleString(styleStr: string): React.CSSProperties {
    const styleObj: Record<string, string> = {};
    const rules = styleStr.split(';');
    rules.forEach((rule) => {
        const parts = rule.split(':');
        if (parts.length < 2) return;
        const key = parts[0].trim();
        let value = parts.slice(1).join(':').trim();
        
        // Strip wrapping quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1).trim();
        }
        
        if (!key) return;
        // Convert CSS property name to camelCase (e.g., background-color -> backgroundColor)
        const camelCaseKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        styleObj[camelCaseKey] = value;
    });
    return styleObj as React.CSSProperties;
}

function rehypeStyleToObject() {
    return (tree: any) => {
        const visit = (node: any) => {
            if (node.type === 'element' && node.properties) {
                if (typeof node.properties.style === 'string') {
                    node.properties.style = parseStyleString(node.properties.style);
                }
            }
            if (node.children) {
                node.children.forEach(visit);
            }
        };
        visit(tree);
    };
}

function createHtmlSourceApp(html: string): React.ComponentType {
    const HtmlSourceApp = React.memo(() => (
        <div
            className="w-fit h-fit"
            dangerouslySetInnerHTML={{ __html: html }}
        />
    ));
    HtmlSourceApp.displayName = 'HtmlSourceApp';
    return HtmlSourceApp;
}

function createMdxSourceApp(mdxContent: string): React.ComponentType {
    const MdxSourceApp = React.memo(() => (
        <div className="w-fit h-fit prose prose-invert prose-sm max-w-none">
            <Markdown
                rehypePlugins={[rehypeRaw, rehypeStyleToObject]}
                remarkPlugins={[remarkGfm]}
            >
                {mdxContent}
            </Markdown>
        </div>
    ));
    MdxSourceApp.displayName = 'MdxSourceApp';
    return MdxSourceApp;
}

// ============================================================================
// OverlayAppItem — memoized per-app wrapper with drag / rotate / scale
// All interactions mutate DOM refs directly (zero re-renders during gesture).
// Values are committed to state only on pointer-up.
// ============================================================================

interface OverlayAppItemProps {
    app: OverlayApps;
    isEditing: boolean;
    isSelected: boolean;
    onSelect: () => void;
    onUpdate: (id: string, patch: Partial<Pick<OverlayApps, 'pos' | 'rotation' | 'scale'>>) => void;
    onMenuAction: (id: string, action: string) => void;
}

const handles = [
    { name: 'top-left', cursor: 'nwse-resize', style: { top: -4, left: -4 } },
    { name: 'top-center', cursor: 'ns-resize', style: { top: -4, left: 'calc(50% - 4px)' } },
    { name: 'top-right', cursor: 'nesw-resize', style: { top: -4, right: -4 } },
    { name: 'middle-left', cursor: 'ew-resize', style: { top: 'calc(50% - 4px)', left: -4 } },
    { name: 'middle-right', cursor: 'ew-resize', style: { top: 'calc(50% - 4px)', right: -4 } },
    { name: 'bottom-left', cursor: 'nesw-resize', style: { bottom: -4, left: -4 } },
    { name: 'bottom-center', cursor: 'ns-resize', style: { bottom: -4, left: 'calc(50% - 4px)' } },
    { name: 'bottom-right', cursor: 'nwse-resize', style: { bottom: -4, right: -4 } },
];


const OverlayAppItem = React.memo(function OverlayAppItem({
    app,
    isEditing,
    isSelected,
    onSelect,
    onUpdate,
    onMenuAction,
}: OverlayAppItemProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false);

    // Live mutable transform values (never trigger re-renders)
    const live = useRef({ x: app.pos.x, y: app.pos.y, rotation: app.rotation, scale: app.scale });

    // Keep live ref in sync when committed state changes (e.g. from another source)
    useEffect(() => {
        live.current = { x: app.pos.x, y: app.pos.y, rotation: app.rotation, scale: app.scale };
        applyTransform();
    }, [app.pos.x, app.pos.y, app.rotation, app.scale]);

    const applyTransform = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        const { x, y, rotation, scale } = live.current;
        el.style.left = `calc(50% + ${x}px)`;
        el.style.top = `calc(50% + ${y}px)`;
        el.style.transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
    }, []);

    // ---- Drag (default pointer) & Rotate (Alt+drag shortcut) ----
    const onPointerDown = useCallback((e: React.PointerEvent) => {
        if (!isEditing) return;
        e.preventDefault();
        e.stopPropagation();

        // Select this source on interaction
        onSelect();

        const startX = e.clientX;
        const startY = e.clientY;
        const origX = live.current.x;
        const origY = live.current.y;
        const origRotation = live.current.rotation;
        const isRotate = e.altKey;

        // For rotation: compute angle from center of element to pointer
        const rect = containerRef.current?.getBoundingClientRect();
        const cx = rect ? rect.left + rect.width / 2 : startX;
        const cy = rect ? rect.top + rect.height / 2 : startY;
        const startAngle = Math.atan2(startY - cy, startX - cx) * (180 / Math.PI);

        const onMove = (ev: PointerEvent) => {
            if (isRotate) {
                const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI);
                live.current.rotation = origRotation + (angle - startAngle);
            } else {
                let targetX = origX + (ev.clientX - startX);
                let targetY = origY + (ev.clientY - startY);
                if (ev.ctrlKey) {
                    const gridSize = 25;
                    targetX = Math.round(targetX / gridSize) * gridSize;
                    targetY = Math.round(targetY / gridSize) * gridSize;
                }
                live.current.x = targetX;
                live.current.y = targetY;
            }
            applyTransform();
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            // Commit to state
            if (isRotate) {
                onUpdate(app.id, { rotation: live.current.rotation });
            } else {
                onUpdate(app.id, { pos: { x: live.current.x, y: live.current.y } });
            }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [isEditing, app.id, onSelect, onUpdate, applyTransform]);

    // ---- Rotation via Top Circle Handle ----
    const onRotateHandlePointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
        const origRotation = live.current.rotation;

        const onMove = (ev: PointerEvent) => {
            const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI);
            live.current.rotation = origRotation + (angle - startAngle);
            applyTransform();
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            onUpdate(app.id, { rotation: live.current.rotation });
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [app.id, onUpdate, applyTransform]);

    // ---- Scale via Handles ----
    const onScaleHandlePointerDown = useCallback((e: React.PointerEvent, handleName: string) => {
        e.preventDefault();
        e.stopPropagation();

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        const startX = e.clientX;
        const startY = e.clientY;
        const origScale = live.current.scale;

        const startDist = Math.hypot(startX - cx, startY - cy);
        if (startDist === 0) return;

        const onMove = (ev: PointerEvent) => {
            const currentDist = Math.hypot(ev.clientX - cx, ev.clientY - cy);
            let newScale = origScale * (currentDist / startDist);
            newScale = Math.max(0.1, Math.min(10, newScale));
            live.current.scale = newScale;
            applyTransform();
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            onUpdate(app.id, { scale: live.current.scale });
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [app.id, onUpdate, applyTransform]);

    // ---- Scale via Scroll Wheel (convenience secondary gesture) ----
    useEffect(() => {
        if (!isEditing) return;
        const el = containerRef.current;
        if (!el) return;

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            live.current.scale = Math.max(0.1, Math.min(10, live.current.scale + delta));
            applyTransform();
            // Debounced commit
            clearTimeout((onWheel as any)._t);
            (onWheel as any)._t = window.setTimeout(() => {
                onUpdate(app.id, { scale: live.current.scale });
            }, 150);
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [isEditing, app.id, onUpdate, applyTransform]);

    const AppComponent = app.App;

    const content = (
        <div
            ref={containerRef}
            onPointerDown={onPointerDown}
            onContextMenu={(e) => {
                if (isEditing) {
                    onSelect();
                }
            }}
            onMouseEnter={() => isEditing && setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}

            style={{
                position: 'absolute',
                left: `calc(50% + ${app.pos.x}px)`,
                top: `calc(50% + ${app.pos.y}px)`,
                transform: `translate(-50%, -50%) rotate(${app.rotation}deg) scale(${app.scale})`,
                cursor: isEditing ? 'grab' : 'default',
                userSelect: isEditing ? 'none' : 'auto',
                pointerEvents: 'auto',
            }}
        >
            {/* Editing overlay — visible border + handles */}
            {isEditing && (
                <div
                    style={{
                        position: 'absolute',
                        inset: -2,
                        border: isSelected
                            ? '2px solid #FF3B30'
                            : isHovered
                                ? '1.5px dashed rgba(255, 59, 48, 0.8)'
                                : '1px dashed rgba(255, 255, 255, 0.3)',
                        pointerEvents: 'none',
                        zIndex: 10,
                        transition: 'border-color 0.15s, border-style 0.15s',
                    }}
                >
                    {isSelected && (
                        <>
                            {/* 8 Corner & Edge Handles */}
                            {handles.map(h => (
                                <div
                                    key={h.name}
                                    onPointerDown={(e) => onScaleHandlePointerDown(e, h.name)}
                                    style={{
                                        position: 'absolute',
                                        width: 8,
                                        height: 8,
                                        background: '#FF3B30',
                                        border: '1px solid #FFFFFF',
                                        cursor: h.cursor,
                                        pointerEvents: 'auto',
                                        zIndex: 11,
                                        ...h.style
                                    }}
                                />
                            ))}
                            {/* Rotation Handle */}
                            <div
                                style={{
                                    position: 'absolute',
                                    top: -20,
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    width: 2,
                                    height: 16,
                                    background: '#FF3B30',
                                    pointerEvents: 'none',
                                }}
                            />
                            <div
                                onPointerDown={onRotateHandlePointerDown}
                                style={{
                                    position: 'absolute',
                                    top: -26,
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    width: 10,
                                    height: 10,
                                    borderRadius: '50%',
                                    background: '#FF3B30',
                                    border: '1px solid #FFFFFF',
                                    cursor: 'grab',
                                    pointerEvents: 'auto',
                                    zIndex: 12,
                                }}
                                title="Drag to rotate"
                            />
                        </>
                    )}
                </div>
            )}
            {/* Disable pointer events on the inner app when editing so drag works */}
            <div style={{ pointerEvents: isEditing ? 'none' : 'auto' }}>
                <AppComponent />
            </div>
        </div>
    );

    if (isEditing) {
        return (
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    {content}
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48 bg-zinc-950/95 border border-zinc-800 text-zinc-300 font-sans backdrop-blur-md">
                    {(app.html || app.mdx) && (
                        <>
                            <ContextMenuItem
                                className="cursor-pointer focus:bg-zinc-850 focus:text-white"
                                onSelect={() => onMenuAction(app.id, 'edit')}
                            >
                                Edit Source
                            </ContextMenuItem>
                            <ContextMenuSeparator className="bg-zinc-800" />
                        </>
                    )}
                    <ContextMenuItem
                        className="cursor-pointer focus:bg-zinc-850 focus:text-white"
                        onSelect={() => onMenuAction(app.id, 'bring-to-front')}
                    >
                        Bring to Front
                    </ContextMenuItem>
                    <ContextMenuItem
                        className="cursor-pointer focus:bg-zinc-850 focus:text-white"
                        onSelect={() => onMenuAction(app.id, 'send-to-back')}
                    >
                        Send to Back
                    </ContextMenuItem>
                    <ContextMenuSeparator className="bg-zinc-800" />
                    <ContextMenuItem
                        className="cursor-pointer focus:bg-zinc-850 focus:text-white"
                        onSelect={() => onMenuAction(app.id, 'center')}
                    >
                        Center Source
                    </ContextMenuItem>
                    <ContextMenuItem
                        className="cursor-pointer focus:bg-zinc-850 focus:text-white"
                        onSelect={() => onMenuAction(app.id, 'reset-scale')}
                    >
                        Reset Scale
                    </ContextMenuItem>
                    <ContextMenuItem
                        className="cursor-pointer focus:bg-zinc-850 focus:text-white"
                        onSelect={() => onMenuAction(app.id, 'reset-rotation')}
                    >
                        Reset Rotation
                    </ContextMenuItem>
                    <ContextMenuItem
                        className="cursor-pointer focus:bg-zinc-850 focus:text-white"
                        onSelect={() => onMenuAction(app.id, 'reset-transform')}
                    >
                        Reset Transform
                    </ContextMenuItem>
                    <ContextMenuSeparator className="bg-zinc-800" />
                    <ContextMenuItem
                        className="cursor-pointer text-red-400 focus:bg-red-950/40 focus:text-red-300"
                        onSelect={() => onMenuAction(app.id, 'delete')}
                    >
                        Delete Source
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
        );
    }

    return content;
}, (prev, next) => {
    // Custom comparator: only re-render when this item's data actually changed
    return (
        prev.app.id === next.app.id &&
        prev.app.pos.x === next.app.pos.x &&
        prev.app.pos.y === next.app.pos.y &&
        prev.app.rotation === next.app.rotation &&
        prev.app.scale === next.app.scale &&
        prev.app.App === next.app.App &&
        prev.isEditing === next.isEditing &&
        prev.isSelected === next.isSelected &&
        prev.onSelect === next.onSelect &&
        prev.onUpdate === next.onUpdate &&
        prev.onMenuAction === next.onMenuAction
    );
});

export type AppRegistry = {
    name: string;
    App: React.ComponentType,
    Icon: React.JSX.Element,
}

export default function ContainerOverlayApp({ Apps, CustomMenu, AppRegistry = [] }: { Apps: OverlayApps[], AppRegistry?: AppRegistry[], CustomMenu?: React.JSX.Element }) {

    const { pyInvoke } = usePython();
    const { settings, updateSetting } = useSettings();
    const [mounted, setMounted] = useState(false);
    const [showMcpDialog, setShowMcpDialog] = useGlobal('showMcpDialog', { initialValue: false })
    const [showCredentialsDialog, setShowCredentialsDialog] = useGlobal('showCredentialsDialog', { initialValue: false })
    const [showLocalModelDialog, setShowLocalModelDialog] = useGlobal('showLocalModelDialog', { initialValue: false })
    const [showCustomEndpointDialog, setShowCustomEndpointDialog] = useGlobal('showCustomEndpointDialog', { initialValue: false })
    const [setupModel, setSetupModel] = useState(false);
    const [appsState, setAppsState] = useGlobal("overlay-apps", { initialValue: Apps });
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        if (!isTauri) {
            setIsLoaded(true);
            return;
        }
        (async () => {
            try {
                // 1. Create table (removed trailing comma)
                await pyInvoke("sqlite", {
                    db: "global",
                    table: "apps",
                    command: "execute",
                    sql: `CREATE TABLE IF NOT EXISTS apps (
              id      TEXT PRIMARY KEY,
              data   TEXT
            )`,
                    params: []
                });

                // 2. Query after table is guaranteed to exist
                const savedApps = (await pyInvoke("sqlite", {
                    db: "global",
                    table: "apps",
                    command: "query",
                    sql: "SELECT * FROM apps"
                })).data as any[];

                console.warn("Initial Saved Apps:", savedApps);

                // Helper to serialize defaults (excluding ComponentType `App`)
                const serializeDefaults = (appsList: OverlayApps[]) => {
                    return JSON.stringify(appsList.map(a => ({
                        id: a.id,
                        pos: a.pos,
                        rotation: a.rotation,
                        scale: a.scale,
                        html: a.html,
                        mdx: a.mdx
                    })));
                };

                const currentDefaultsStr = serializeDefaults(Apps);
                const defaultsRow = savedApps.find(row => row.id === 'defaults');
                const activeRow = savedApps.find(row => row.id === '1');

                // 3. Reset defaults/active if empty, or if Apps default config was updated
                if (!defaultsRow || defaultsRow.data !== currentDefaultsStr) {
                    await pyInvoke("sqlite", {
                        db: "global",
                        table: "apps",
                        command: "execute",
                        sql: `INSERT OR REPLACE INTO apps (id, data) VALUES (?, ?)`,
                        params: ['defaults', currentDefaultsStr]
                    });
                    await pyInvoke("sqlite", {
                        db: "global",
                        table: "apps",
                        command: "execute",
                        sql: `INSERT OR REPLACE INTO apps (id, data) VALUES (?, ?)`,
                        params: ['1', JSON.stringify(Apps)]
                    });
                    setAppsState(Apps);
                } else if (activeRow) {
                    // Parse saved apps state and restore the component mappings
                    const parsed = JSON.parse(activeRow.data) as any[];
                    const loadedApps = parsed.map((item: any) => {
                        const defaultApp = Apps.find(a => a.id === item.id);
                        if (defaultApp) {
                            return {
                                ...item,
                                App: defaultApp.App
                            };
                        }
                        if (item.html) {
                            return {
                                ...item,
                                App: createHtmlSourceApp(item.html)
                            };
                        }
                        if (item.mdx) {
                            return {
                                ...item,
                                App: createMdxSourceApp(item.mdx)
                            };
                        }
                        return null;
                    }).filter(Boolean) as OverlayApps[];

                    setAppsState(loadedApps);
                }
            } catch (err) {
                console.error("Error loading apps from SQLite:", err);
            }
            setIsLoaded(true);
        })();
    }, []);

    // 4. Save updates back to SQLite (debounced to avoid spamming the DB during drags)
    useEffect(() => {
        if (!isTauri || !isLoaded) return;

        const timer = setTimeout(async () => {
            try {
                await pyInvoke("sqlite", {
                    db: "global",
                    table: "apps",
                    command: "execute",
                    sql: `INSERT OR REPLACE INTO apps (id, data) VALUES (?, ?)`,
                    params: ['1', JSON.stringify(appsState)]
                });
            } catch (err) {
                console.error("Error saving appsState to database:", err);
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [appsState, isLoaded]);

    const [isEditing, setIsEditing] = useGlobal('overlay-editing', { initialValue: false });
    const [selectedAppId, setSelectedAppId] = useGlobal('overlay-selected-app-id', { initialValue: '' });

    // State for the "Add Source" dialog (HTML / MDX code editor)
    const [addSourceType, setAddSourceType] = useState<'html' | 'mdx' | null>(null);
    const [addSourceContent, setAddSourceContent] = useState('');
    const [editingAppId, setEditingAppId] = useState<string | null>(null);

    // Ref to keep handleMenuAction stable and avoid re-renders
    const appsStateRef = useRef(appsState);
    useEffect(() => {
        appsStateRef.current = appsState;
    }, [appsState]);

    const closeDialog = () => {
        setAddSourceType(null);
        setAddSourceContent('');
        setEditingAppId(null);
    };

    useEffect(() => {
        if (!isTauri) return;

        const win = getCurrentWindow();
        let winPos = { x: 0, y: 0 };
        let scale = 1;
        let active = true;

        // Initialize cache
        win.innerPosition().then(pos => {
            if (active) winPos = pos;
        }).catch(err => console.error("Error getting window position:", err));

        win.scaleFactor().then(s => {
            if (active) scale = s;
        }).catch(err => console.error("Error getting window scale factor:", err));

        // Store listeners to clean up
        const cleanups: (() => void)[] = [];

        win.onMoved(({ payload: pos }) => {
            if (active) winPos = pos;
        }).then(unlisten => {
            if (active) cleanups.push(unlisten);
            else unlisten();
        }).catch(err => console.error("Error listening onMoved:", err));

        win.onResized(async () => {
            try {
                const pos = await win.innerPosition();
                if (active) winPos = pos;
            } catch (err) {
                console.error("Error updating window position on resize:", err);
            }
        }).then(unlisten => {
            if (active) cleanups.push(unlisten);
            else unlisten();
        }).catch(err => console.error("Error listening onResized:", err));

        win.onScaleChanged(({ payload }) => {
            if (active) scale = payload.scaleFactor;
        }).then(unlisten => {
            if (active) cleanups.push(unlisten);
            else unlisten();
        }).catch(err => console.error("Error listening onScaleChanged:", err));

        // Let's set up the loop
        let intervalId: any = null;
        let lastIgnore: boolean | null = null;

        if (isEditing) {
            lastIgnore = false;
            win.setIgnoreCursorEvents(false).catch(err => console.error(err));
            win.setFocusable(true).catch(err => console.error(err));
            win.setFocus().catch(err => console.error(err));
        } else {
            win.setFocusable(false).catch(err => console.error(err));
            intervalId = setInterval(async () => {
                try {
                    const isInputFocused = !!(
                        document.hasFocus() &&
                        document.activeElement && (
                            document.activeElement.tagName === 'INPUT' ||
                            document.activeElement.tagName === 'TEXTAREA' ||
                            document.activeElement.getAttribute('contenteditable') === 'true'
                        )
                    );
                    // Get current global cursor coordinates
                    const cursor = await cursorPosition();

                    // Convert to logical pixels relative to the window client area
                    const localX = (cursor.x - winPos.x) / scale;
                    const localY = (cursor.y - winPos.y) / scale;

                    // Query elements with [data-tauri-cursor-region]
                    const elements = document.querySelectorAll('[data-tauri-cursor-region=true]');

                    let overRegion = isInputFocused;
                    if (!overRegion) {
                        for (let i = 0; i < elements.length; i++) {
                            const el = elements[i];
                            const rect = el.getBoundingClientRect();
                            if (
                                localX >= rect.left &&
                                localX <= rect.right &&
                                localY >= rect.top &&
                                localY <= rect.bottom
                            ) {
                                overRegion = true;
                                break;
                            }
                        }
                    }

                    const nextIgnore = !overRegion;
                    if (active && lastIgnore !== nextIgnore) {
                        lastIgnore = nextIgnore;
                        await win.setIgnoreCursorEvents(nextIgnore);
                        await win.setFocusable(!nextIgnore);
                    } else {
                        win.setFocusable(false)
                    }
                } catch (err) {
                    console.error("Error in hit-testing loop:", err);
                }
            }, 50); // check every 50ms
        }

        return () => {
            active = false;
            if (intervalId) clearInterval(intervalId);
            cleanups.forEach(unlisten => unlisten());
        };
    }, [isEditing]);

    // Stable callback: update a single app's transform without replacing the whole array reference for siblings
    const handleAppUpdate = useCallback((id: string, patch: Partial<Pick<OverlayApps, 'pos' | 'rotation' | 'scale'>>) => {
        setAppsState((prev: OverlayApps[]) =>
            prev.map(a => a.id === id ? { ...a, ...patch } : a)
        );
    }, [setAppsState]);

    const handleMenuAction = useCallback((id: string, action: string) => {
        switch (action) {
            case 'edit': {
                const item = appsStateRef.current.find(a => a.id === id);
                if (!item) break;
                if (item.html) {
                    setAddSourceContent(item.html);
                    setAddSourceType('html');
                    setEditingAppId(id);
                } else if (item.mdx) {
                    setAddSourceContent(item.mdx);
                    setAddSourceType('mdx');
                    setEditingAppId(id);
                }
                break;
            }
            case 'bring-to-front':
                setAppsState((prev: OverlayApps[]) => {
                    const item = prev.find(a => a.id === id);
                    if (!item) return prev;
                    return [...prev.filter(a => a.id !== id), item];
                });
                break;
            case 'send-to-back':
                setAppsState((prev: OverlayApps[]) => {
                    const item = prev.find(a => a.id === id);
                    if (!item) return prev;
                    return [item, ...prev.filter(a => a.id !== id)];
                });
                break;
            case 'center':
                handleAppUpdate(id, { pos: { x: 0, y: 0 } });
                break;
            case 'reset-scale':
                handleAppUpdate(id, { scale: 1 });
                break;
            case 'reset-rotation':
                handleAppUpdate(id, { rotation: 0 });
                break;
            case 'reset-transform':
                handleAppUpdate(id, { pos: { x: 0, y: 0 }, scale: 1, rotation: 0 });
                break;
            case 'delete':
                setAppsState((prev: OverlayApps[]) => prev.filter(a => a.id !== id));
                if (selectedAppId === id) {
                    setSelectedAppId('');
                }
                break;
        }
    }, [setAppsState, handleAppUpdate, selectedAppId, setSelectedAppId]);

    const handleContainerPointerDown = useCallback((e: React.PointerEvent) => {
        if (!isEditing) return;
        // If clicking the empty container itself, clear the active selection
        if (e.target === e.currentTarget) {
            setSelectedAppId('');
        }
    }, [isEditing, setSelectedAppId]);

    const addLocalModel = useCallback(async (paths: string[]): Promise<void> => {
        let modelsArr: string[] = Array.isArray(settings["openchad/LocalModelProvider/local.model"]) ? settings["openchad/LocalModelProvider/local.model"] : [];
        await updateSetting("openchad/LocalModelProvider/local.model", [...new Set([...modelsArr, ...paths])])
    }, [settings]);
    const deleteLocalModel = useCallback(async (path: string): Promise<void> => {
        let modelsArr: string[] = Array.isArray(settings["openchad/LocalModelProvider/local.model"]) ? settings["openchad/LocalModelProvider/local.model"] : [];
        await updateSetting("openchad/LocalModelProvider/local.model", modelsArr.filter((model) => model !== path))
    }, [settings]);
    const addEndpoint = useCallback(async (endpoint: string): Promise<void> => {
        let modelsArr: string[] = Array.isArray(settings["openchad/ProxyModelProvider/custom.endpoints"]) ? settings["openchad/ProxyModelProvider/custom.endpoints"] : [];
        await updateSetting("openchad/ProxyModelProvider/custom.endpoints", [...new Set([...modelsArr, endpoint])])
    }, [settings]);
    const deleteEndpoint = useCallback(async (endpoint: string): Promise<void> => {
        let modelsArr: string[] = Array.isArray(settings["openchad/ProxyModelProvider/custom.endpoints"]) ? settings["openchad/ProxyModelProvider/custom.endpoints"] : [];
        await updateSetting("openchad/ProxyModelProvider/custom.endpoints", modelsArr.filter((model) => model !== endpoint))
    }, [settings]);

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

    useEffect(() => {
        if (!mounted || !isTauri) return;

        const handleKeyDown = async (e: KeyboardEvent) => {
            if (e.key !== 'F11') return;
            e.preventDefault();
            const win = getCurrentWindow();
            await win.setFullscreen(!(await win.isFullscreen()));
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [mounted]);

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
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!isTauri) return;
        if (mounted) {
            shortcutPromiseChain = shortcutPromiseChain.then(async () => {
                try {
                    if (!(await isRegistered("CmdOrCtrl+Shift+E"))) {
                        await register("CmdOrCtrl+Shift+E", async () => {
                            const win = getCurrentWindow();
                            setIsEditing(!isEditing);
                            win.setFocus();
                        })
                    }
                } catch (err) {
                    console.error("Error registering CmdOrCtrl+Shift+E:", err);
                }
                try {
                    if (!(await isRegistered("esc"))) {
                        await register("esc", async () => {
                            setIsEditing(false);
                            setSetupModel(false);
                            setShowMcpDialog(false);
                            setShowCredentialsDialog(false);
                            setShowCustomEndpointDialog(false);
                            setShowLocalModelDialog(false);
                        })
                    }
                } catch (err) {
                    console.error("Error registering esc:", err);
                }
            });
        }
        return () => {
            if (!isTauri) return;
            shortcutPromiseChain = shortcutPromiseChain.then(async () => {
                try {
                    if (await isRegistered("CmdOrCtrl+Shift+E")) {
                        await unregister("CmdOrCtrl+Shift+E");
                    }
                } catch (err) {
                    console.error("Error unregistering CmdOrCtrl+Shift+E:", err);
                }
                try {
                    if (await isRegistered("esc")) {
                        await unregister("esc");
                    }
                } catch (err) {
                    console.error("Error unregistering esc:", err);
                }
            });
        }
    }, [mounted])



    useEffect(() => {
        if (mounted) {
            document.documentElement.className = "dark"
        }
    }, [mounted])


    return (
        <div>
            <style>{`
                html, body {
                    background: transparent !important;
                }
            `}</style>
            <div
                className={clsx(
                    'fixed w-[100vw] h-[100vh] top-0 left-0 z-50',
                    !isEditing ? "bg-transparent" : "bg-black/50"
                )}
                onPointerDown={handleContainerPointerDown}
                style={{ pointerEvents: isEditing ? 'auto' : 'none' }}
            >
                {isLoaded && appsState.map((app: OverlayApps) => (
                    <OverlayAppItem
                        key={app.id}
                        app={app}
                        isEditing={isEditing}
                        isSelected={app.id === selectedAppId}
                        onSelect={() => setSelectedAppId(app.id)}
                        onUpdate={handleAppUpdate}
                        onMenuAction={handleMenuAction}
                    />
                ))}
            </div>

            {/* Edit mode toggle */}
            {isEditing && (CustomMenu ? CustomMenu : <div
                style={
                    {
                        zIndex: 999999
                    }
                }
                className={
                    clsx(
                        "fixed bottom-2 right-2",
                    )
                }>
                <div className='flex items-center justify-center gap-2'>
                    <Button
                        onClick={(e) => {
                            setIsEditing(false);
                        }}
                        className='flex items-center justify-center cursor-pointer'>
                        <Check />
                        Done Editing
                    </Button>
                    <Dropdown
                        content={[
                            ...AppRegistry.map((app) => {
                                return {
                                    content: <div> Add {app.name} </div>,
                                    shortcut: app.Icon,
                                    children: null,
                                    separator: false,
                                    trigger: () => {
                                        setAppsState(appsState => [...appsState, {
                                            id: uuidv4(),
                                            appname: app.name,
                                            data: {},
                                            App: app.App,
                                            pos: {
                                                x: 0,
                                                y: 0
                                            },
                                            rotation: 0,
                                            scale: 1
                                        }])
                                    }
                                }
                            }),
                            {
                                content: <div> Add HTML </div>,
                                shortcut: <Code size={16} />,
                                children: null,
                                separator: false,
                                trigger: () => {
                                    setAddSourceContent('');
                                    setAddSourceType('html');
                                }
                            },
                            {
                                content: <div> Add MDX </div>,
                                shortcut: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 15 15" fill="none" style={{
                                    color: 'currentColor'
                                }}><path fill-rule="evenodd" clip-rule="evenodd" d="M5.31537 1.83658C4.91591 1.72069 4.6196 1.75177 4.40406 1.86852C4.18851 1.98528 4.00061 2.21648 3.87946 2.61438C3.75743 3.01517 3.71578 3.55024 3.77508 4.1963C3.78469 4.30099 3.79689 4.40794 3.81168 4.51697C4.33487 4.38401 4.89711 4.279 5.48788 4.20569C5.89742 3.63189 6.327 3.11445 6.76281 2.66575C6.74097 2.64805 6.71917 2.63058 6.69739 2.61335C6.18865 2.21073 5.71773 1.95332 5.31537 1.83658ZM7.49994 1.9775C7.43924 1.92661 7.37857 1.87716 7.31796 1.8292C6.746 1.37655 6.16025 1.04047 5.59401 0.876189C5.02487 0.711062 4.44065 0.711415 3.92776 0.989234C3.41488 1.26705 3.09543 1.7562 2.92282 2.32312C2.75109 2.88714 2.71259 3.56136 2.77927 4.28771C2.7949 4.45796 2.81643 4.63245 2.84379 4.81065C2.67409 4.87146 2.51042 4.93563 2.35329 5.00297C1.68286 5.2903 1.10837 5.64527 0.694221 6.06491C0.277951 6.4867 0 7.00057 0 7.58387C0 8.16716 0.27795 8.68103 0.694221 9.10282C1.10837 9.52246 1.68286 9.87743 2.35329 10.1648C2.51042 10.2321 2.67408 10.2963 2.84378 10.3571C2.81642 10.5353 2.79488 10.7098 2.77925 10.8801C2.71257 11.6064 2.75107 12.2806 2.9228 12.8447C3.09541 13.4116 3.41486 13.9007 3.92774 14.1785C4.44063 14.4564 5.02485 14.4567 5.59399 14.2916C6.16023 14.1273 6.74598 13.7912 7.31794 13.3386C7.37856 13.2906 7.43923 13.2412 7.49994 13.1903C7.56065 13.2412 7.62132 13.2906 7.68193 13.3386C8.2539 13.7912 8.83965 14.1273 9.40589 14.2916C9.97503 14.4567 10.5592 14.4564 11.0721 14.1785C11.585 13.9007 11.9045 13.4116 12.0771 12.8447C12.2488 12.2806 12.2873 11.6064 12.2206 10.8801C12.205 10.7098 12.1835 10.5353 12.1561 10.3571C12.3258 10.2963 12.4895 10.2321 12.6467 10.1648C13.3171 9.87743 13.8916 9.52246 14.3058 9.10282C14.722 8.68103 15 8.16716 15 7.58387C15 7.00057 14.722 6.4867 14.3058 6.06491C13.8916 5.64527 13.3171 5.2903 12.6467 5.00297C12.4895 4.93562 12.3258 4.87144 12.1561 4.81061C12.1834 4.63242 12.205 4.45795 12.2206 4.28771C12.2873 3.56136 12.2488 2.88714 12.0771 2.32312C11.9045 1.7562 11.585 1.26705 11.0721 0.989234C10.5592 0.711415 9.97501 0.711062 9.40587 0.876189C8.83963 1.04047 8.25388 1.37655 7.68191 1.8292C7.62131 1.87716 7.56064 1.92661 7.49994 1.9775ZM7.49994 3.34216C7.27514 3.57233 7.05016 3.82461 6.82771 4.09712C7.04936 4.08834 7.27361 4.08387 7.5 4.08387C7.72635 4.08387 7.95056 4.08834 8.17216 4.09712C7.94972 3.82461 7.72474 3.57233 7.49994 3.34216ZM9.51199 4.20567C9.10245 3.63188 8.67287 3.11444 8.23707 2.66575C8.25891 2.64805 8.28071 2.63058 8.30249 2.61335C8.81123 2.21073 9.28215 1.95332 9.68451 1.83658C10.084 1.72069 10.3803 1.75177 10.5958 1.86852C10.8114 1.98528 10.9993 2.21648 11.1204 2.61438C11.2424 3.01517 11.2841 3.55024 11.2248 4.1963C11.2152 4.30098 11.203 4.40792 11.1882 4.51694C10.665 4.38399 10.1028 4.27898 9.51199 4.20567ZM8.94935 5.15034C8.484 5.10693 7.9991 5.08387 7.5 5.08387C7.00085 5.08387 6.51591 5.10693 6.05052 5.15035C5.79069 5.53887 5.53944 5.95428 5.30171 6.39316C5.08522 6.79282 4.89116 7.19123 4.71966 7.58387C4.89117 7.97652 5.08524 8.37494 5.30173 8.77462C5.53945 9.21348 5.7907 9.62888 6.05051 10.0174C6.5159 10.0608 7.00085 10.0839 7.5 10.0839C7.99911 10.0839 8.48401 10.0608 8.94936 10.0174C9.20918 9.62889 9.46042 9.21349 9.69815 8.77462C9.91464 8.37494 10.1087 7.97652 10.2802 7.58387C10.1087 7.19124 9.91465 6.79282 9.69817 6.39316C9.46043 5.95427 9.20918 5.53886 8.94935 5.15034ZM10.7728 6.28838C10.7096 6.16452 10.6445 6.04064 10.5775 5.91687C10.4696 5.71781 10.3589 5.52276 10.2456 5.33206C10.5062 5.38167 10.7573 5.43803 10.9978 5.5005C10.9346 5.75638 10.8596 6.01957 10.7728 6.28838ZM10.7728 8.87936C10.7096 9.00323 10.6445 9.12712 10.5774 9.25091C10.4696 9.44995 10.3589 9.64498 10.2456 9.83568C10.5062 9.78606 10.7573 9.72969 10.9978 9.66722C10.9346 9.41135 10.8596 9.14816 10.7728 8.87936ZM11.9533 9.36619C11.8083 8.7925 11.6114 8.19354 11.3649 7.58386C11.6114 6.97419 11.8083 6.37523 11.9533 5.80154C12.0563 5.84048 12.1561 5.8807 12.2528 5.92212C12.8491 6.17768 13.2997 6.46916 13.594 6.76735C13.8862 7.06339 14 7.33873 14 7.58387C14 7.829 13.8862 8.10434 13.594 8.40038C13.2997 8.69857 12.8491 8.99005 12.2528 9.24561C12.1561 9.28703 12.0563 9.32725 11.9533 9.36619ZM11.1882 10.6508C10.665 10.7837 10.1028 10.8888 9.51201 10.9621C9.10247 11.5359 8.67288 12.0533 8.23707 12.502C8.25891 12.5197 8.28072 12.5372 8.30251 12.5544C8.81125 12.957 9.28217 13.2145 9.68453 13.3312C10.084 13.4471 10.3803 13.416 10.5958 13.2993C10.8114 13.1825 10.9993 12.9513 11.1204 12.5534C11.2425 12.1526 11.2841 11.6175 11.2248 10.9715C11.2152 10.8668 11.203 10.7598 11.1882 10.6508ZM7.49994 11.8256C7.72475 11.5954 7.94973 11.3431 8.17218 11.0706C7.95057 11.0794 7.72635 11.0839 7.5 11.0839C7.27361 11.0839 7.04935 11.0794 6.82769 11.0706C7.05015 11.3431 7.27513 11.5954 7.49994 11.8256ZM4.75426 9.83565C4.64098 9.64497 4.53025 9.44994 4.42244 9.25091C4.35539 9.12712 4.29025 9.00323 4.22704 8.87936C4.14031 9.14815 4.06531 9.41133 4.00208 9.66719C4.24253 9.72967 4.49368 9.78603 4.75426 9.83565ZM3.81167 10.6508C4.33485 10.7837 4.8971 10.8887 5.48786 10.962C5.8974 11.5358 6.327 12.0533 6.76282 12.502C6.74097 12.5197 6.71915 12.5372 6.69737 12.5544C6.18863 12.957 5.71771 13.2145 5.31535 13.3312C4.91589 13.4471 4.61958 13.416 4.40404 13.2993C4.18849 13.1825 4.00059 12.9513 3.87944 12.5534C3.75741 12.1526 3.71576 11.6175 3.77506 10.9715C3.78468 10.8668 3.79688 10.7598 3.81167 10.6508ZM3.04656 9.36615C3.19156 8.79247 3.38844 8.19352 3.63494 7.58387C3.38844 6.97421 3.19157 6.37526 3.04656 5.80158C2.94366 5.84051 2.84383 5.88071 2.74721 5.92212C2.15089 6.17768 1.70026 6.46916 1.40597 6.76735C1.1138 7.06339 1 7.33873 1 7.58387C1 7.829 1.1138 8.10434 1.40597 8.40038C1.70026 8.69857 2.15089 8.99005 2.74721 9.24561C2.84383 9.28702 2.94366 9.32722 3.04656 9.36615ZM4.00208 5.50053C4.06531 5.7564 4.14031 6.01958 4.22704 6.28837C4.29024 6.16452 4.35538 6.04065 4.42242 5.91687C4.53024 5.71782 4.64098 5.52278 4.75427 5.33208C4.49369 5.3817 4.24254 5.43806 4.00208 5.50053ZM6 7.58387C6 6.75544 6.67157 6.08387 7.5 6.08387C8.32843 6.08387 9 6.75544 9 7.58387C9 8.41229 8.32843 9.08387 7.5 9.08387C6.67157 9.08387 6 8.41229 6 7.58387ZM7.5 7.08387C7.22386 7.08387 7 7.30772 7 7.58387C7 7.86001 7.22386 8.08387 7.5 8.08387C7.77614 8.08387 8 7.86001 8 7.58387C8 7.30772 7.77614 7.08387 7.5 7.08387Z" fill="currentColor" /></svg>,
                                children: null,
                                separator: false,
                                trigger: () => {
                                    setAddSourceContent('');
                                    setAddSourceType('mdx');
                                }
                            },
                        ]}
                    >
                        <Button className='w-fit h-fit rounded-full p-2' variant={"secondary"}>
                            <Plus />
                        </Button>
                    </Dropdown>
                    <Dropdown
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
                        <Button className='w-fit h-fit rounded-full p-2' variant={"secondary"}>
                            <Settings />
                        </Button>
                    </Dropdown>

                </div>
            </div>)}
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
                        endpoints={settings["openchad/ProxyModelProvider/custom.endpoints"]?.value}
                        addEndpoint={addEndpoint}
                        deleteEndpoint={deleteEndpoint}
                    />
                </DialogContent>
            </DialogUI>
            {isEditing && setupModel && <>
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
            {/* ─── Add HTML / MDX Source Dialog ─── */}
            {isEditing && <DialogUI open={addSourceType !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
                <DialogContent className="max-w-2xl flex flex-col border-accent/20 bg-card p-0 overflow-hidden shadow-2xl">
                    <DialogHeader className="px-6 pt-5 pb-3 border-b border-[hsl(var(--chat-border))]">
                        <DialogTitle className="text-base font-semibold tracking-tight">
                            {editingAppId ? `Edit ${addSourceType?.toUpperCase()} Source` : `Add ${addSourceType?.toUpperCase()} Source`}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-4 p-6">
                        {/* Live preview */}
                        {addSourceContent.trim() && (
                            <div className="border border-[hsl(var(--chat-border))] rounded-lg p-4 bg-background max-h-48 overflow-auto flex flex-col items-start">
                                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Preview</p>
                                <div className="border border-dashed border-zinc-700 p-2 rounded w-fit h-fit bg-zinc-950/50">
                                    {addSourceType === 'html' ? (
                                        <div className="w-fit h-fit" dangerouslySetInnerHTML={{ __html: addSourceContent }} />
                                    ) : (
                                        <div className="w-fit h-fit prose prose-invert prose-sm max-w-none">
                                            <Markdown rehypePlugins={[rehypeRaw, rehypeStyleToObject]} remarkPlugins={[remarkGfm]}>
                                                {addSourceContent}
                                            </Markdown>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        {/* Code editor textarea */}
                        <textarea
                            style={
                                {
                                    zIndex: 999999999,
                                }
                            }
                            value={addSourceContent}
                            onChange={(e) => setAddSourceContent(e.target.value)}
                            placeholder={addSourceType === 'html'
                                ? '<div style="color: white; font-size: 24px;">\n  Hello World\n</div>'
                                : '# Hello World\n\nThis is **MDX** content with <span style="color:cyan">inline HTML</span>.'}
                            className="w-full relative min-h-[200px] max-h-[400px] resize-y rounded-lg border border-[hsl(var(--chat-border))] bg-background p-4 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                            spellCheck={false}
                            autoFocus
                        />
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">
                                {addSourceType === 'html'
                                    ? 'Paste any valid HTML.'
                                    : 'Write React Markdown.'}
                            </p>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="secondary"
                                    className="text-sm"
                                    onClick={closeDialog}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    className="text-sm"
                                    disabled={!addSourceContent.trim()}
                                    onClick={() => {
                                        const content = addSourceContent.trim();
                                        if (!content) return;
                                        const App = addSourceType === 'html'
                                            ? createHtmlSourceApp(content)
                                            : createMdxSourceApp(content);
                                        
                                        if (editingAppId) {
                                            setAppsState((prev: OverlayApps[]) =>
                                                prev.map(a => a.id === editingAppId ? {
                                                    ...a,
                                                    App,
                                                    html: addSourceType === 'html' ? content : undefined,
                                                    mdx: addSourceType === 'mdx' ? content : undefined,
                                                } : a)
                                            );
                                        } else {
                                            const newApp: OverlayApps = {
                                                id: uuidv4(),
                                                App,
                                                pos: { x: 0, y: 0 },
                                                rotation: 0,
                                                scale: 1,
                                                html: addSourceType === 'html' ? content : undefined,
                                                mdx: addSourceType === 'mdx' ? content : undefined,
                                            };
                                            setAppsState((prev: OverlayApps[]) => [...prev, newApp]);
                                        }
                                        closeDialog();
                                    }}
                                >
                                    {editingAppId ? 'Save Changes' : 'Add Source'}
                                </Button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </DialogUI>}
        </div>
    )
}
