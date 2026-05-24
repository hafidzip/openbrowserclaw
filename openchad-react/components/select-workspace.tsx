import { useState } from "react"
import {
    ArrowUpRightIcon,
    X,
    Plus,
    ArrowLeft,
    Check
} from "lucide-react"
import { Button } from "./ui"
import { Input } from "./ui"
import { Card, CardContent } from "./ui"
import { Avatar } from "./ui"
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "./ui"
import clsx from "clsx"
import useElementSize from "./hooks/useElementSize"
import { openUrl } from '@tauri-apps/plugin-opener'
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;

const WorkspaceLogo = ({ className }: { className?: string }) => (
    <svg
        className={clsx("stroke-[15px] stroke-accent", className)}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 657 657"
    >
        <path fill="currentColor" d="M173 84h6a167 167 0 0 1 80 34l3 2a428 428 0 0 0 21 15l4 4 2 1a462 462 0 0 0 17 14c8 8 17 15 24 24l14 15 6 6 2 2c3 3 3 3 3 6l-8 7-3 3-2 1-8 6-4 1c-4-1-5-3-8-6a2267 2267 0 0 0-4-5l-9-9-10-11-21-21c-3-1-5-4-7-6-17-14-17-14-36-26-3 0-5 2-7 4l-2 2-2 2-2 2a968 968 0 0 0-17 19l-2 2a4081 4081 0 0 0-25 34l8 6 3 2a257 257 0 0 1 27 22 208 208 0 0 1 31 31 296 296 0 0 1 32 39 359 359 0 0 1 26 40 393 393 0 0 1 64 185c3 31-3 67-23 92a71 71 0 0 1-51 24 153 153 0 0 1-50-8l-6-2-1-3a1041 1041 0 0 1 9 1l8 1a65 65 0 0 0 51-13l4-1 1-2c1-4 3-6 6-9 5-6 8-13 10-21l2-5c20-49-4-118-23-164a332 332 0 0 0-16-32c-5-11-12-22-18-32l-2-2a356 356 0 0 0-50-67l-2 2-7 7c-12 11-12 11-22 23l-8 10-18 21 6 8 11 13 2 3a1365 1365 0 0 1 7 10c35 49 64 114 55 175-2 16-9 31-22 40l-5 3-2 2c-14 7-31 4-45 0a156 156 0 0 1-54-33 215 215 0 0 1-30-29 291 291 0 0 1-51-79c-14-29-25-61-26-93v-4c-1-22 2-44 17-60 10-10 21-14 35-14 29 0 54 16 75 34l5 4 7 6a82 82 0 0 0 14-18l2-2c10-15 21-29 33-41l4-8-24-20-2-2-19-13-3-2-19-10-2-1c-24-11-49-16-74-8-16 6-27 18-34 34l-8 24-2-1a121 121 0 0 1 26-69c4-6 8-10 15-13l2-2c7-4 13-6 20-7l3-1a105 105 0 0 1 67 13l3 1h7l3-4 2-3 2-2 3-3 10-14c10-14 21-26 33-38-11-11-36-16-52-18l-2-1c-9-1-18-1-27 1h-4c-13 2-22 8-33 15l-6 2 7-11 3-4 2-1 3-4a78 78 0 0 1 72-22ZM31 339c-8 11-12 23-12 37v3c-1 51 23 100 52 139l2 3c15 20 33 37 53 51l3 2c15 10 34 16 53 13 10-2 17-7 23-16 6-10 9-20 9-32v-3c1-58-29-114-66-156l-2-3-28-26-2-2c-22-17-62-36-85-10Z" />
        <path fill="currentColor" d="m344 57 7 5a199 199 0 0 1 35 27l12 10a134 134 0 0 1 24 22l6 7 18 20 13-5c14-7 28-13 43-17l3-2 16-2 4 5a2136 2136 0 0 0 38 54l8 14a267 267 0 0 1 22 42c21 43 35 90 37 138v20a124 124 0 0 1-9 43c-3 12-9 23-15 34l-2-1 4-13a116 116 0 0 0 7-37 373 373 0 0 0-59-212l-2-3a476970923 476970923 0 0 0-12-21l-24-33c-8 2-15 5-22 9l-3 1-26 13 10 14 17 25 11 19a362 362 0 0 1 29 55l1 2c25 54 44 114 42 174v4c-1 18-3 34-9 51v3c-3 9-7 17-14 24l-6 9c-7 9-17 16-27 22 0-4 0-5 3-8l2-3 2-2c18-24 23-50 24-79v-24c-1-22-5-43-10-65v-3l-15-45-1 1a378 378 0 0 1-58 34l-3 2-5 3 2 4c11 30 19 63 22 95v2c3 36 3 83-21 113l-5 5-4 6c-4 5-9 9-15 12l-2 1c-12 8-25 12-39 12v-3l5-3c12-7 22-14 30-26l2-4c5-7 8-14 10-21l1-2c3-10 5-19 6-30l1-7a356 356 0 0 0-54-210 248 248 0 0 0-27-45l-3-5-2-4-2-2-1-7 4-3 2-1 3-2 5-3 3-2 8-5c4 2 5 4 8 8l2 3a236496 236496 0 0 1 16 27l1 2 4 7a136 136 0 0 1 12 22l1 4a1318 1318 0 0 0 11 21l2 4 1 3 1 4a8549 8549 0 0 0 60-35l2-2 2-1 4-1a272 272 0 0 0-15-33l-1-3a404 404 0 0 0-31-53c-7-12-15-24-24-35l-9-13a335 335 0 0 0-43-49 242 242 0 0 0-37-34c-6-5-12-11-19-15l-2-1a981 981 0 0 0-53-30h-2c-9-4-18-7-28-8l-9-2c-16-3-31 0-46 3l-1-3c12-7 24-12 37-14l3-1c37-6 77 9 108 29ZM88 421c23 16 39 41 45 68 2 10 3 21-2 31-3 5-7 7-13 8-12 1-21-4-30-12l-2-2c-19-15-33-41-36-65-1-9-1-17 4-25l2-3c9-8 22-5 32 0Z" />
        <path fill="currentColor" d="m459 47 10 4 2 1 5 4 2 1a703 703 0 0 1 58 40l19 19 4 5c8 8 15 17 21 26l2 2c20 29 36 61 46 95l1 3c9 31 9 64 11 95h-3v-3a344 344 0 0 0-54-161l-2-3a2024 2024 0 0 0-7-12l-21-29-5-5a210 210 0 0 0-25-29 146 146 0 0 0-24-23c-9-8-18-14-28-20l-12-8v-2Z" />
        <path fill="currentColor" d="M329 16a182 182 0 0 1 119 38c6 3 11 8 16 13l11 9 12 10-1 3c-15 5-15 5-21 2-4-2-7-6-10-9l-9-8-8-7c-9-8-20-14-30-20l-6-4c-7-5-15-8-23-12h-2c-14-6-28-9-43-11l-6-1 1-3Z" />
    </svg>
)

export function SelectWorkspace({ workspaces, setWorkspace }: { workspaces: string[], setWorkspace: (workspace: string) => void }) {
    const [isCreating, setIsCreating] = useState(false)
    const [newWorkspaceName, setNewWorkspaceName] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [containerRef, { width, height }] = useElementSize<HTMLDivElement>()
    const isEmpty = workspaces.length === 0 && !isCreating
    const isSmallWidth = width < 480
    const isSmallHeight = height < 500
    // Compute dynamic number of grid columns when in wider viewport
    const colsCount = width < 720
        ? 2
        : width < 960
            ? Math.min(workspaces.length + 1, 3)
            : Math.min(workspaces.length + 1, 4)
    return (
        <div
            ref={containerRef}
            className={clsx(
                "absolute w-full h-full flex flex-col items-center transition-all duration-300",
                // Hide or fade-in while sizing hasn't initialized
                (width === 0 || height === 0) ? "opacity-0" : "opacity-100",
                // Adjust alignment and scrolling based on height
                isSmallHeight ? "justify-start py-6 overflow-y-auto" : "justify-center overflow-hidden"
            )}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        >
            {/* Common Window elements */}
            <div data-tauri-drag-region className='absolute top-0 w-full h-[4vh] left-0 bg-transparent' style={{ zIndex: 10 }} />
            <WindowControls />
            {/* Back button (Creation Mode) */}
            {isCreating && (
                <div className="absolute z-90 top-[-0.2px] -left-1 p-3 pl-5" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}>
                    <ArrowLeft className="cursor-pointer" onClick={() => {
                        setIsCreating(false);
                    }} />
                </div>
            )}
            {/* 1. Handle Empty State */}
            {isEmpty && (
                <Empty className={clsx("animate-in fade-in duration-300", isSmallHeight && "gap-3 p-3")}>
                    <EmptyHeader>
                        {!isSmallHeight && (
                            <EmptyMedia variant="icon">
                                <WorkspaceLogo className="w-5 h-5" />
                            </EmptyMedia>
                        )}
                        <EmptyTitle className={clsx(isSmallHeight && "text-base")}>No Workspaces Yet</EmptyTitle>
                        {!isSmallHeight && (
                            <EmptyDescription>
                                You haven&apos;t created any workspaces yet. Get started by creating
                                your first workspace.
                            </EmptyDescription>
                        )}
                    </EmptyHeader>
                    
                    <EmptyContent>
                        <div className="flex gap-2">
                            <Button onClick={() => setIsCreating(true)} size={isSmallHeight ? "sm" : "default"}>Create Workspace</Button>
                        </div>
                    </EmptyContent>
                    <Button variant="link" asChild className="text-muted-foreground" size="sm">
                        <a onClick={(e) => {
                            e.preventDefault();
                            if (isTauri) {
                                openUrl('https://openchad.github.io/docs/customization/custom-app.html')
                            } else {
                                window.open('https://openchad.github.io/docs/customization/custom-app.html', '_blank')
                            }
                        }} href="#">
                            Learn More <ArrowUpRightIcon className="w-4 h-4 ml-1" />
                        </a>
                    </Button>
                </Empty>
            )}
            {/* 2. Handle Creation Mode */}
            {isCreating && (
                <div className={clsx(
                    "max-w-md w-full px-8 animate-in fade-in zoom-in-95 duration-200",
                    isSmallHeight ? "space-y-4 py-8" : "space-y-6"
                )}>
                    <div className={clsx("text-center", isSmallHeight ? "space-y-1" : "space-y-2")}>
                        {!isSmallHeight && (
                            <div className="flex items-center justify-center w-full relative mb-2">
                                <WorkspaceLogo className="w-5 h-5" />
                            </div>
                        )}
                        <h2 className={clsx("font-medium tracking-tight", isSmallHeight ? "text-lg" : "text-2xl")}>
                            Set up your new workspace
                        </h2>
                        {!isSmallHeight && (
                            <p className="text-muted-foreground text-sm">
                                Separate your work, side projects, and personal life. keep your focus where it belongs.
                            </p>
                        )}
                    </div>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (!workspaces.includes(newWorkspaceName)) {
                                setWorkspace(newWorkspaceName);
                                setIsCreating(false);
                            }
                        }}
                        className={clsx("w-full", isSmallHeight ? "space-y-3" : "space-y-4")}
                    >
                        <div className="space-y-2">
                            <Input
                                name="workspace-name"
                                id="workspace-name"
                                placeholder="e.g. Personal Project"
                                value={newWorkspaceName}
                                onChange={(e) => {
                                    setNewWorkspaceName(e.target.value)
                                    if (workspaces.includes(e.target.value)) {
                                        setError("Workspace name already exists")
                                    } else {
                                        setError(null)
                                    }
                                }}
                                className={clsx(
                                    "bg-muted/50",
                                    error ? "border-red-500" : "border-zinc-700/50"
                                )}
                                autoFocus
                            />
                            {error && <p className="text-red-500 text-sm">{error}</p>}
                        </div>
                        <div className="flex gap-3 pt-2">
                            <Button
                                type="submit"
                                className="w-full"
                                disabled={!newWorkspaceName}
                                size={isSmallHeight ? "sm" : "default"}
                            >
                                <Check className="w-4 h-4 mr-2" />
                                Create
                            </Button>
                        </div>
                    </form>
                </div>
            )}
            {/* 3. Handle Workspace Selection Mode */}
            {!isEmpty && !isCreating && (
                <>
                    <div className={clsx(
                        "flex flex-col items-center space-y-1 animate-in slide-in-from-bottom-5 duration-500 fade-in",
                        isSmallHeight ? "mb-4 mt-6" : "mb-12"
                    )}>
                        {!isSmallHeight && (
                            <div className="w-16 h-16 rounded-full bg-card flex items-center justify-center mb-6 shadow-xl">
                                <WorkspaceLogo className="w-5 h-5" />
                            </div>
                        )}
                        <h1 className={clsx("font-medium text-accent", isSmallHeight ? "text-lg" : "text-2xl")}>
                            Select Workspace
                        </h1>
                        {!isSmallHeight && (
                            <p className="text-accent/50 text-sm">Pick a workspace to start your session</p>
                        )}
                    </div>
                    <div
                        className={clsx(
                            isSmallWidth
                                ? "flex flex-col gap-3 max-w-md px-6 w-full animate-in zoom-in-95 duration-500 delay-100 fade-in fill-mode-backwards"
                                : "grid gap-6 max-w-4xl px-8 w-full animate-in zoom-in-95 duration-500 delay-100 fade-in fill-mode-backwards"
                        )}
                        style={isSmallWidth ? undefined : {
                            gridTemplateColumns: `repeat(${colsCount}, minmax(0, 1fr))`
                        }}
                    >
                        {workspaces.map((workspace, i) => {
                            if (isSmallWidth) {
                                return (
                                    <Card
                                        key={i}
                                        className="group border-0 bg-transparent shadow-none bg-card dark:hover:bg-[hsl(var(--hover))] transition-all duration-200 cursor-pointer flex flex-row items-center p-3 rounded-xl ring-1 ring-transparent hover:ring-zinc-700/50 w-full"
                                        onClick={() => setWorkspace(workspace)}
                                    >
                                        <CardContent className="p-0 flex flex-row items-center gap-4 w-full">
                                            <Avatar className="flex items-center justify-center w-12 h-12 border border-zinc-800 group-hover:border-zinc-600 transition-colors shadow-md text-sm shrink-0">
                                                {workspace.substring(0, 2).toUpperCase()}
                                            </Avatar>
                                            <div className="text-left space-y-0.5">
                                                <h3 className="font-medium text-accent/70 group-hover:text-accent transition-colors">
                                                    {workspace}
                                                </h3>
                                                <p className="text-[11px] text-accent/30 group-hover:text-accent/40 transition-colors">Workspace</p>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )
                            }
                            return (
                                <Card
                                    key={i}
                                    className="group border-0 bg-transparent shadow-none bg-card dark:hover:bg-[hsl(var(--hover))] transition-all duration-200 cursor-pointer flex flex-col items-center p-4 rounded-xl ring-1 ring-transparent hover:ring-zinc-700/50"
                                    onClick={() => setWorkspace(workspace)}
                                >
                                    <CardContent className="p-0 flex flex-col items-center gap-4">
                                        <Avatar className="flex items-center justify-center w-20 h-20 border-2 border-zinc-800 group-hover:border-zinc-600 transition-colors shadow-lg">
                                            {workspace.substring(0, 2).toUpperCase()}
                                        </Avatar>
                                        <div className="text-center space-y-1">
                                            <h3 className="font-medium text-accent/50 group-hover:text-accent transition-colors">
                                                {workspace}
                                            </h3>
                                        </div>
                                    </CardContent>
                                </Card>
                            )
                        })}
                        {/* The "Add" Card */}
                        {isSmallWidth ? (
                            <Card
                                className="group border border-dashed border-accent/25 bg-transparent shadow-none hover:border-accent dark:hover:bg-zinc-800/30 transition-all duration-200 cursor-pointer flex flex-row items-center p-3 rounded-xl w-full"
                                onClick={() => setIsCreating(true)}
                            >
                                <CardContent className="p-0 flex flex-row items-center gap-4 w-full">
                                    <div className="w-12 h-12 rounded-full bg-transparent border border-dashed border-[hsl(var(--border))] flex items-center justify-center group-hover:scale-105 transition-all duration-300 shrink-0">
                                        <Plus className="w-5 h-5 text-accent/50 group-hover:text-accent" />
                                    </div>
                                    <span className="font-medium text-accent/50 group-hover:text-accent">Add Workspace</span>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card
                                className="group border-2 border-dashed border-accent/25 bg-transparent shadow-none hover:border-accent dark:hover:bg-zinc-800/30 transition-all duration-200 cursor-pointer flex flex-col items-center justify-center p-4 rounded-xl min-h-[180px]"
                                onClick={() => setIsCreating(true)}
                            >
                                <CardContent className="p-0 flex flex-col items-center gap-4">
                                    <div className="w-20 h-20 rounded-full bg-transparent border border-[hsl(var(--border))] flex items-center justify-center group-hover:scale-105 transition-all duration-300">
                                        <Plus className="w-8 h-8 text-accent/50 group-hover:text-accent" />
                                    </div>
                                    <span className="font-medium text-accent/50 group-hover:text-accent">Add</span>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
// Extracted Window Controls to keep code clean and reusable across views

function WindowControls() {
    return (
        <div className="absolute z-90 top-[-0.2px] -right-1 p-3 pr-5" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}>
            <X className="cursor-pointer" onClick={() => {
                if ((window as any).__TAURI__) {
                    (window as any).__TAURI__.window.getCurrentWindow().close()
                }
            }} />
        </div>
    )
}