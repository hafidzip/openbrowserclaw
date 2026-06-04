import { useCallback, useEffect, useRef, useState } from 'react'
import { selectModel } from './components/sidebar'
import { motion } from "motion/react"
import { KeyState, Workspace, Theme, } from './utils/state'
import { useSnapshot } from 'valtio'
import React from 'react'
import { usePython, usePythonEvent } from './components/usePython'
import { SelectWorkspace } from './components/select-workspace'
import AppLoading from './components/app-loading'
import { useFolderImpl } from './components/useFolder'
import { useSettings } from './components/useSettings'
import { Dialog as DialogUI, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog"

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;


import { getCurrentWindow } from '@tauri-apps/api/window';




import { hideSplashScreen } from "vite-plugin-splash-screen/runtime";
import LocalModel from './components/localmodel'
import Credentials from './components/credentials'
import CustomEndpoint from './components/customendpoint'
import McpServers from './components/mcp'
import { useGlobal } from '.'

export default function ContainerSingleApp({ App, enableWorkspace = false }: { App: React.ComponentType, enableWorkspace?: boolean }) {
    const { pyInvoke } = usePython();
    const { settings, updateSetting } = useSettings();
    const [startupStatus] = useState<any>(null);
    const [, , { folders }] = useFolderImpl('Workspaces');
    const { workspace, setWorkspace } = useSnapshot(Workspace);
    const [isSwitchWorkspace, setIsSwitchWorkspace] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [showMcpDialog, setShowMcpDialog] = useGlobal('showMcpDialog', {initialValue: false})
    const [showCredentialsDialog, setShowCredentialsDialog] = useGlobal('showCredentialsDialog', {initialValue: false})
    const [showLocalModelDialog, setShowLocalModelDialog] = useGlobal('showLocalModelDialog', {initialValue: false})
    const [showCustomEndpointDialog, setShowCustomEndpointDialog] = useGlobal('showCustomEndpointDialog', {initialValue: false})
    const [setupModel, setSetupModel] = useState(false);
    const snaptheme = useSnapshot(Theme);
    const [intialzeTheme, setInitialzeTheme] = useState(false);
    const isFirstSave = useRef(true);

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
        if (!enableWorkspace) {
            setWorkspace('global');
        }
    }, [enableWorkspace, setWorkspace]);

    useEffect(() => {
        if (!enableWorkspace) return;
        if (workspaces.length === 1) {
            setWorkspace(workspaces[0]);
        }
    }, [workspaces.length, enableWorkspace, setWorkspace])

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


    if (!intialzeTheme) {
        return <AppLoading status={startupStatus} />
    }

    if ((workspace === null || isSwitchWorkspace) && enableWorkspace) {
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
            <App/>
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
