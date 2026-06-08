import React, {
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from 'react'
import { useGlobal, useDatabase, AppIdContext } from 'openchad-react'
import { Dialog as DialogUI, DialogContent, DialogHeader, DialogTitle } from 'openchad-react/components/ui/dialog'
import { Button } from 'openchad-react/ui'
import {
    ChevronDown,
    ChevronUp,
    Flag,
    ListChecks,
    Pause,
    Play,
    Plus,
    RotateCcw,
    Trash2,
    X,
    GripVertical,
    Clock,
} from 'lucide-react'
import clsx from 'clsx'

// ---------------------------------------------------------------------------
// Shared text outline style (inherited by all descendants)
// ---------------------------------------------------------------------------
const TEXT_OUTLINE = `
  -2px -2px 0 #000,  
   0   -2px 0 #000,  
   2px -2px 0 #000,  
   2px  0   0 #000,  
   2px  2px 0 #000,  
   0    2px 0 #000,  
  -2px  2px 0 #000,  
  -2px  0   0 #000
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type TimerTask = {
    id: string
    name: string
    /** Elapsed milliseconds for this task (saved when completed) */
    elapsed: number
    /** Whether this task has been completed in the current run */
    done: boolean
    /** Best elapsed time across all runs (milliseconds, -1 = never set) */
    best: number
    /** Target duration in milliseconds (-1 = no target) */
    target: number
}

type TimerState = 'idle' | 'running' | 'paused' | 'finished'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function genId() {
    return Math.random().toString(36).slice(2, 10)
}

function fmt(ms: number, showMs = true): string {
    if (ms < 0) ms = 0
    const totalSecs = Math.floor(ms / 1000)
    const h = Math.floor(totalSecs / 3600)
    const m = Math.floor((totalSecs % 3600) / 60)
    const s = totalSecs % 60
    const centis = Math.floor((ms % 1000) / 10)

    const hh = h > 0 ? `${h}:` : ''
    const mm = h > 0 ? String(m).padStart(2, '0') + ':' : m > 0 ? `${m}:` : ''
    const ss = String(s).padStart(2, '0')
    const cc = showMs ? `.${String(centis).padStart(2, '0')}` : ''
    return `${hh}${mm}${ss}${cc}`
}

function diff(a: number, b: number): { sign: string; text: string; positive: boolean } {
    const delta = a - b
    return {
        sign: delta >= 0 ? '+' : '-',
        text: fmt(Math.abs(delta), false),
        positive: delta <= 0,
    }
}

/**
 * Parse a human-readable target string into milliseconds.
 * Supports: "5s", "3m", "2h", "1h30m", "3m30s", "90", "1:30", "1:30:00"
 * Returns -1 if empty/invalid.
 */
function parseTarget(raw: string): number {
    const s = raw.trim()
    if (!s) return -1

    // hh:mm:ss or mm:ss
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
        const parts = s.split(':').map(Number)
        if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000
        return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
    }

    // e.g. 1h30m15s, 3m, 5s, 2h
    const regex = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/i
    const match = s.match(regex)
    if (match) {
        const h = parseInt(match[1] ?? '0') || 0
        const m = parseInt(match[2] ?? '0') || 0
        const sec = parseInt(match[3] ?? '0') || 0
        const total = h * 3600 + m * 60 + sec
        if (total > 0) return total * 1000
    }

    // Plain number = seconds
    const plain = parseFloat(s)
    if (!isNaN(plain) && plain > 0) return Math.round(plain * 1000)

    return -1
}

/**
 * Format milliseconds as a compact target string for display in the dialog.
 * e.g. 5000 → "5s", 90000 → "1m30s", 3600000 → "1h"
 */
function fmtTarget(ms: number): string {
    if (ms <= 0) return ''
    const totalSecs = Math.round(ms / 1000)
    const h = Math.floor(totalSecs / 3600)
    const m = Math.floor((totalSecs % 3600) / 60)
    const s = totalSecs % 60
    let out = ''
    if (h) out += `${h}h`
    if (m) out += `${m}m`
    if (s || !out) out += `${s}s`
    return out
}

// ---------------------------------------------------------------------------
// Dialog — task editor
// ---------------------------------------------------------------------------
interface TaskTimerDialogProps {
    tasks: TimerTask[]
    onSave: (tasks: TimerTask[]) => void
    onClose: () => void
}

function TaskTimerDialog({ tasks, onSave, onClose }: TaskTimerDialogProps) {
    const [draft, setDraft] = useState<TimerTask[]>(tasks.map(t => ({ ...t })))
    // Raw target strings per task id (what the user is typing)
    const [targetInputs, setTargetInputs] = useState<Record<string, string>>(
        () => Object.fromEntries(tasks.map(t => [t.id, t.target > 0 ? fmtTarget(t.target) : '']))
    )
    const [newName, setNewName] = useState('')
    const [newTarget, setNewTarget] = useState('')
    const dragIdx = useRef<number | null>(null)
    const dragOverIdx = useRef<number | null>(null)

    const addTask = () => {
        const name = newName.trim()
        if (!name) return
        const id = genId()
        const target = parseTarget(newTarget)
        setDraft(d => [...d, { id, name, elapsed: 0, done: false, best: -1, target }])
        setTargetInputs(ti => ({ ...ti, [id]: newTarget.trim() }))
        setNewName('')
        setNewTarget('')
    }

    const removeTask = (id: string) => {
        setDraft(d => d.filter(t => t.id !== id))
        setTargetInputs(ti => { const next = { ...ti }; delete next[id]; return next })
    }

    const renameTask = (id: string, name: string) =>
        setDraft(d => d.map(t => (t.id === id ? { ...t, name } : t)))

    const setTaskTarget = (id: string, raw: string) => {
        setTargetInputs(ti => ({ ...ti, [id]: raw }))
        setDraft(d => d.map(t => (t.id === id ? { ...t, target: parseTarget(raw) } : t)))
    }

    const moveUp = (i: number) => {
        if (i === 0) return
        setDraft(d => {
            const next = [...d]
                ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
            return next
        })
    }

    const moveDown = (i: number) => {
        setDraft(d => {
            if (i === d.length - 1) return d
            const next = [...d]
                ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
            return next
        })
    }

    const clearBest = (id: string) =>
        setDraft(d => d.map(t => (t.id === id ? { ...t, best: -1 } : t)))

    const handleDragStart = (i: number) => { dragIdx.current = i }
    const handleDragOver = (e: React.DragEvent, i: number) => {
        e.preventDefault()
        dragOverIdx.current = i
    }
    const handleDrop = () => {
        const from = dragIdx.current
        const to = dragOverIdx.current
        if (from === null || to === null || from === to) return
        setDraft(d => {
            const next = [...d]
            const [item] = next.splice(from, 1)
            next.splice(to, 0, item)
            return next
        })
        dragIdx.current = null
        dragOverIdx.current = null
    }

    return (
        <div className="flex flex-col h-full min-h-0" style={{ textShadow: TEXT_OUTLINE }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--chat-border))]">
                <div className="flex items-center gap-2">
                    <ListChecks className="w-5 h-5 text-primary" />
                    <h2 className="text-base font-semibold tracking-tight">Edit Tasks</h2>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Column headers */}
            {draft.length > 0 && (
                <div className="flex items-center px-6 pt-2 pb-0.5 gap-2">
                    <span className="w-3.5 shrink-0" />
                    <span className="w-5 shrink-0" />
                    <span className="flex-1 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Task name</span>
                    <span className="w-[72px] shrink-0 text-[10px] text-muted-foreground uppercase tracking-wide font-medium flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" /> Target
                    </span>
                    <span className="w-[60px] shrink-0" />
                </div>
            )}

            {/* Task list */}
            <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1.5 min-h-0">
                {draft.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-8">
                        No tasks yet — add one below!
                    </p>
                )}
                {draft.map((task, i) => (
                    <div
                        key={task.id}
                        draggable
                        onDragStart={() => handleDragStart(i)}
                        onDragOver={e => handleDragOver(e, i)}
                        onDrop={handleDrop}
                        className="group flex items-center gap-2 rounded-md border border-[hsl(var(--chat-border))] bg-background px-2 py-1.5 hover:border-primary/30 transition-colors"
                    >
                        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 cursor-grab shrink-0" />
                        <span className="text-xs text-muted-foreground w-5 text-right shrink-0">
                            {i + 1}.
                        </span>
                        <input
                            value={task.name}
                            onChange={e => renameTask(task.id, e.target.value)}
                            className="flex-1 bg-transparent text-sm text-foreground focus:outline-none min-w-0"
                            placeholder="Task name…"
                            style={{ textShadow: TEXT_OUTLINE }}
                        />

                        {/* Target input */}
                        <input
                            value={targetInputs[task.id] ?? ''}
                            onChange={e => setTaskTarget(task.id, e.target.value)}
                            placeholder="e.g. 5m"
                            title="Target duration (e.g. 30s, 5m, 1h30m)"
                            className={clsx(
                                'w-[72px] shrink-0 bg-transparent text-xs font-mono focus:outline-none text-right rounded px-1 py-0.5 border',
                                task.target > 0
                                    ? 'border-amber-500/40 text-amber-400'
                                    : 'border-[hsl(var(--chat-border))] text-muted-foreground'
                            )}
                            style={{ textShadow: TEXT_OUTLINE }}
                        />

                        {task.best >= 0 && (
                            <span className="text-xs text-emerald-400 font-mono shrink-0" title="Best time">
                                ★ {fmt(task.best, false)}
                            </span>
                        )}
                        {task.best >= 0 && (
                            <button
                                onClick={() => clearBest(task.id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-amber-400 shrink-0"
                                title="Clear best"
                            >
                                <Flag className="w-3 h-3" />
                            </button>
                        )}
                        <div className="flex items-center shrink-0">
                            <button
                                onClick={() => moveUp(i)}
                                disabled={i === 0}
                                className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={() => moveDown(i)}
                                disabled={i === draft.length - 1}
                                className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        <button
                            onClick={() => removeTask(task.id)}
                            className="text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                ))}
            </div>

            {/* Add task */}
            <div className="px-6 py-3 border-t border-[hsl(var(--chat-border))]">
                <div className="flex gap-2">
                    <input
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addTask()}
                        placeholder="New task name…"
                        className="flex-1 rounded-md border border-[hsl(var(--chat-border))] bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                        style={{ textShadow: TEXT_OUTLINE }}
                    />
                    <input
                        value={newTarget}
                        onChange={e => setNewTarget(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addTask()}
                        placeholder="Target…"
                        title="Target duration (e.g. 30s, 5m, 1h30m)"
                        className="w-[80px] shrink-0 rounded-md border border-[hsl(var(--chat-border))] bg-background px-2 py-1.5 text-sm font-mono text-amber-400 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                        style={{ textShadow: TEXT_OUTLINE }}
                    />
                    <Button onClick={addTask} className="gap-1 px-3 text-sm">
                        <Plus className="w-4 h-4" />
                        Add
                    </Button>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                    Target formats: <span className="font-mono text-amber-400/70">30s · 5m · 1h30m · 1:30</span>
                </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-[hsl(var(--chat-border))]">
                <Button variant="secondary" onClick={onClose} className="text-sm">
                    Cancel
                </Button>
                <Button
                    onClick={() => {
                        onSave(draft.filter(t => t.name.trim()))
                        onClose()
                    }}
                    className="text-sm"
                >
                    Save Tasks
                </Button>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Overlay widget
// ---------------------------------------------------------------------------
export function TaskTimerWidget() {
    const appId = useContext(AppIdContext);
    const DIALOG_EVENT = appId + '-task-timer-dialog'
    const [dialog, setDialog] = useGlobal<string>('overlay-app-dialog', { initialValue: '' })

    const [tasks, setTasks] = useDatabase<TimerTask[]>(appId + '-task-list-timer-tasks', { initialValue: [] })
    const [currentIdx, setCurrentIdx] = useGlobal<number>(appId + '-task-list-timer-idx', { initialValue: 0 })
    const [timerState, setTimerState] = useGlobal<TimerState>(appId + '-task-list-timer-state', { initialValue: 'idle' })
    const [totalElapsed, setTotalElapsed] = useGlobal<number>(appId + '-task-list-timer-total', { initialValue: 0 })

    // Live tick refs
    const rafRef = useRef<number | null>(null)
    const tickStartRef = useRef<number>(0)
    const taskStartRef = useRef<number>(0)
    // Accumulated before pause
    const totalAccRef = useRef<number>(totalElapsed)
    const taskAccRef = useRef<number>(0)

    // Display state (updated every raf)
    const [displayTotal, setDisplayTotal] = useState(totalElapsed)
    const [displayTask, setDisplayTask] = useState(0)

    // Sync accumulated from global on mount / change
    useEffect(() => {
        totalAccRef.current = totalElapsed
    }, [totalElapsed])

    const tick = useCallback(() => {
        const now = performance.now()
        const dt = now - tickStartRef.current
        const t = totalAccRef.current + dt
        const k = taskAccRef.current + (now - taskStartRef.current)
        setDisplayTotal(t)
        setDisplayTask(k)
        rafRef.current = requestAnimationFrame(tick)
    }, [])

    const stopRaf = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
        }
    }, [])

    const startRaf = useCallback(() => {
        stopRaf()
        rafRef.current = requestAnimationFrame(tick)
    }, [tick, stopRaf])

    useEffect(() => {
        if (dialog === DIALOG_EVENT) {
            // handled inline below
        }
    }, [dialog])

    const handleStart = () => {
        if (tasks.length === 0) return
        const now = performance.now()
        tickStartRef.current = now
        taskStartRef.current = now
        taskAccRef.current = 0
        setTimerState('running')
        setTotalElapsed(0)
        setDisplayTotal(0)
        setDisplayTask(0)
        setCurrentIdx(0)
        startRaf()
    }

    const handlePause = () => {
        stopRaf()
        const now = performance.now()
        totalAccRef.current += now - tickStartRef.current
        taskAccRef.current += now - taskStartRef.current
        const snap = totalAccRef.current
        setTotalElapsed(snap)
        setDisplayTotal(snap)
        setTimerState('paused')
    }

    const handleResume = () => {
        const now = performance.now()
        tickStartRef.current = now
        taskStartRef.current = now
        setTimerState('running')
        startRaf()
    }

    const handleSplit = () => {
        if (timerState !== 'running') return
        const now = performance.now()
        const taskElapsed = taskAccRef.current + (now - taskStartRef.current)

        setTasks((prev: TimerTask[]) =>
            prev.map((t, i) => {
                if (i !== currentIdx) return t
                const best = t.best < 0 ? taskElapsed : Math.min(t.best, taskElapsed)
                return { ...t, elapsed: taskElapsed, done: true, best }
            })
        )

        const nextIdx = currentIdx + 1
        if (nextIdx >= tasks.length) {
            stopRaf()
            const finalTotal = totalAccRef.current + (now - tickStartRef.current)
            totalAccRef.current = finalTotal
            setTotalElapsed(finalTotal)
            setDisplayTotal(finalTotal)
            setCurrentIdx(tasks.length)
            setTimerState('finished')
        } else {
            setCurrentIdx(nextIdx)
            taskStartRef.current = now
            taskAccRef.current = 0
            setDisplayTask(0)
        }
    }

    const handleReset = () => {
        stopRaf()
        totalAccRef.current = 0
        taskAccRef.current = 0
        setTotalElapsed(0)
        setDisplayTotal(0)
        setDisplayTask(0)
        setCurrentIdx(0)
        setTimerState('idle')
        setTasks((prev: TimerTask[]) => prev.map(t => ({ ...t, elapsed: 0, done: false })))
    }

    useEffect(() => () => stopRaf(), [stopRaf])

    const isRunning = timerState === 'running'
    const isPaused = timerState === 'paused'
    const isIdle = timerState === 'idle'
    const isFinished = timerState === 'finished'

    const currentTask = tasks[currentIdx] ?? null

    return (
        <div
            className="select-none font-mono"
            style={{
                background: 'transparent',
                border: 'none',
                borderRadius: 10,
                minWidth: 260,
                maxWidth: 340,
                height: '400px',
                overflow: 'visible',
                textShadow: TEXT_OUTLINE,
            }}
        >
            {/* ---- Dialog for editing tasks ---- */}
            <DialogUI
                open={dialog === DIALOG_EVENT}
                onOpenChange={open => { if (!open) setDialog('') }}
            >
                <DialogContent className="max-w-lg h-[70vh] flex flex-col border-accent/20 bg-card p-0 overflow-hidden shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="hidden">Task List Timer</DialogTitle>
                    </DialogHeader>
                    <TaskTimerDialog
                        tasks={tasks}
                        onSave={newTasks => {
                            handleReset()
                            setTasks(newTasks)
                        }}
                        onClose={() => setDialog('')}
                    />
                </DialogContent>
            </DialogUI>

            {/* ---- Total time ---- */}
            <div style={{ padding: '10px 14px 6px', textAlign: 'center' }}>
                <div
                    style={{
                        fontSize: 38,
                        fontWeight: 700,
                        letterSpacing: '-0.02em',
                        color: isFinished ? '#4ade80' : '#ffffff',
                        lineHeight: 1,
                        transition: 'color 0.2s',
                        fontVariantNumeric: 'tabular-nums',
                    }}
                >
                    {fmt(displayTotal)}
                </div>
                {isFinished && (
                    <div
                        style={{
                            marginTop: 4,
                            fontSize: 11,
                            color: '#4ade80',
                            fontFamily: 'sans-serif',
                            fontWeight: 600,
                        }}
                    >
                        ✓ Finished!
                    </div>
                )}
            </div>

            {/* ---- Task list ---- */}
            {tasks.length > 0 && (
                <div style={{ overflowY: 'auto', margin: '6px 10px' }}>
                    {tasks.map((task, i) => {
                        const isCurrent = i === currentIdx && !isFinished
                        const isDone = task.done
                        const hasBest = task.best >= 0
                        const showDelta = isDone && hasBest && task.elapsed > 0
                        const delta = showDelta ? diff(task.elapsed, task.best) : null

                        // Determine live task elapsed for this row
                        const liveMs = isCurrent && isRunning ? displayTask : task.elapsed

                        // Over-target detection
                        const hasTarget = task.target > 0
                        const overTarget = hasTarget && liveMs > task.target && (isCurrent || isDone)

                        // Color for the time display
                        const timeColor = overTarget
                            ? '#f87171'                       // red when over target
                            : isDone
                                ? 'rgba(255,255,255,1)'
                                : isCurrent
                                    ? '#a78bfa'
                                    : undefined

                        return (
                            <div
                                key={task.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '5px 10px',
                                    background: overTarget && isCurrent
                                        ? 'rgba(248,113,113,1)'   // subtle red tint on current over-target row
                                        : 'transparent',
                                    borderRadius: 6,
                                    transition: 'background 0.3s',
                                }}
                            >
                                {/* Index / checkmark */}
                                <span
                                    style={{
                                        width: 18,
                                        fontSize: 14,
                                        color: isDone ? '#4ade80' : isCurrent ? '#a78bfa' : 'rgba(255,255,255,1)',
                                        fontWeight: isCurrent ? 700 : 400,
                                        textAlign: 'center',
                                        flexShrink: 0,
                                    }}
                                >
                                    {isDone ? '✓' : i + 1}
                                </span>

                                {/* Task name */}
                                <span
                                    className='shadow-md'
                                    style={{
                                        flex: 1,
                                        fontSize: 16,
                                        color: isDone
                                            ? 'rgba(255,255,255,1)'
                                            : isCurrent
                                                ? '#ffffff'
                                                : 'rgba(158,158,158,1)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        marginLeft: 6,
                                        fontFamily: 'sans-serif',
                                        fontWeight: isCurrent ? 600 : 400,
                                    }}
                                >
                                    {task.name}
                                </span>

                                {/* Time column */}
                                <div
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'flex-end',
                                        marginLeft: 8,
                                        flexShrink: 0,
                                    }}
                                >
                                    {/* Live/elapsed time */}
                                    {(isCurrent && isRunning) || isDone ? (
                                        <span
                                            style={{
                                                fontSize: 11,
                                                color: timeColor,
                                                fontVariantNumeric: 'tabular-nums',
                                                transition: 'color 0.3s',
                                            }}
                                        >
                                            {fmt(liveMs, false)}
                                        </span>
                                    ) : null}

                                    {/* Target label (shown when not running / idle) */}
                                    {hasTarget && !isDone && !isRunning && (
                                        <span
                                            style={{
                                                fontSize: 9,
                                                color: 'rgba(251,191,36,1)',
                                                fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            ⏱{fmtTarget(task.target)}
                                        </span>
                                    )}

                                    {/* Target label during run for non-current tasks */}
                                    {hasTarget && !isDone && isRunning && !isCurrent && (
                                        <span
                                            style={{
                                                fontSize: 9,
                                                color: 'rgba(251,191,36,1)',
                                                fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            ⏱{fmtTarget(task.target)}
                                        </span>
                                    )}

                                    {/* Remaining / over indicator for current running task */}
                                    {isCurrent && isRunning && hasTarget && (
                                        <span
                                            style={{
                                                fontSize: 9,
                                                color: overTarget ? '#f87171' : 'rgba(251,191,36,1)',
                                                fontVariantNumeric: 'tabular-nums',
                                                fontWeight: 600,
                                            }}
                                        >
                                            {overTarget
                                                ? `+${fmt(liveMs - task.target, false)}`
                                                : `${fmt(task.target - liveMs, false)} left`}
                                        </span>
                                    )}

                                    {/* Best delta */}
                                    {delta && (
                                        <span
                                            style={{
                                                fontSize: 9,
                                                color: delta.positive ? '#4ade80' : '#f87171',
                                                fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            {delta.sign}{delta.text}
                                        </span>
                                    )}

                                    {/* Best time for upcoming tasks */}
                                    {!isDone && !isCurrent && task.best >= 0 && (
                                        <span
                                            style={{
                                                fontSize: 9,
                                                color: 'rgba(255,255,255,1)',
                                                fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            ★{fmt(task.best, false)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {tasks.length === 0 && (
                <div
                    style={{
                        padding: '12px 14px',
                        textAlign: 'center',
                        color: 'rgba(255,255,255,1)',
                        fontSize: 11,
                        fontFamily: 'sans-serif',
                    }}
                >
                    Click "Edit" to add tasks
                </div>
            )}

            {/* ---- Controls ---- */}
            <div
                data-tauri-cursor-region={true}
                style={{ display: 'flex', gap: 6, padding: '8px 10px 10px' }}
            >
                {(isIdle || isFinished) && (
                    <button
                        onClick={() => {
                            setTasks(prev => prev.map(t => ({ ...t, best: -1 })));
                            handleReset();
                            if(!isFinished) handleStart();
                        }}
                        disabled={tasks.length === 0}
                        style={btnStyle('#7c3aed', '#6d28d9', tasks.length === 0)}
                    >
                        <Play style={{ width: 13, height: 13 }} />
                        {isFinished ? 'Reset' : 'Start'}
                    </button>
                )}

                {isRunning && (
                    <>
                        <button onClick={handleSplit} style={btnStyle('#059669', '#047857', false)}>
                            <Flag style={{ width: 13, height: 13 }} />
                            Split
                        </button>
                        <button onClick={handlePause} style={btnStyle('rgba(19, 19, 19, 1)', 'rgba(255,255,255,1)', false)}>
                            <Pause style={{ width: 13, height: 13 }} />
                        </button>
                    </>
                )}

                {isPaused && (
                    <button onClick={handleResume} style={btnStyle('#7c3aed', '#6d28d9', false)}>
                        <Play style={{ width: 13, height: 13 }} />
                        Resume
                    </button>
                )}

                {isFinished && (
                    <button
                        onClick={handleStart}
                        style={{ ...btnStyle('rgba(19, 19, 19, 1)', 'rgba(255,255,255,1)', false), marginLeft: 'auto' }}
                    >
                        <RotateCcw style={{ width: 12, height: 12 }} />
                    </button>
                )}
            </div>
        </div>
    )
}

function btnStyle(bg: string, hover: string, disabled: boolean): React.CSSProperties {
    return {
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        padding: '6px 10px',
        borderRadius: 6,
        border: '1px solid rgba(255,255,255, 0.2)',
        background: disabled ? 'rgba(85,85,85,1)' : bg,
        color: disabled ? 'rgba(255,255,255,1)' : '#ffffff',
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'sans-serif',
        letterSpacing: '0.02em',
        transition: 'background 0.15s',
    }
}

// ---------------------------------------------------------------------------
// AppRegistry entry for ContainerOverlayApp
// ---------------------------------------------------------------------------
export const TaskTimerRegistryEntry = {
    name: 'Task Timer',
    dialogLabel: 'Edit Tasks',
    dialogEvent: 'task-timer-dialog',
    App: TaskTimerWidget,
    Icon: <ListChecks size={16} />,
}