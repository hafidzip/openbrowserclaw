import React, { useState, useCallback, useRef, useContext } from 'react'
import { AppIdContext, useGlobal } from 'openchad-react'
import { Dialog as DialogUI, DialogContent, DialogHeader, DialogTitle } from 'openchad-react/components/ui/dialog'
import { Button } from 'openchad-react/components/ui/button'
import { MessageSquare, X, Link, AlertCircle, Tv2 } from 'lucide-react'
import { useDatabase } from 'openchad-react'
import clsx from 'clsx'

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------
const TEXT_OUTLINE = '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Platform = 'youtube' | 'twitch' | 'kick'
export type LiveChatConfig = { url: string }



const PLATFORM_COLOR: Record<Platform, string> = {
    youtube: 'text-red-400',
    twitch:  'text-purple-400',
    kick:    'text-green-400',
}

const PLATFORM_LABEL: Record<Platform, string> = {
    youtube: 'YouTube',
    twitch:  'Twitch',
    kick:    'Kick',
}

// ---------------------------------------------------------------------------
// Parse: detect platform + extract channel/video-ID in one pass
// ---------------------------------------------------------------------------
type Parsed = { platform: Platform; channelId: string }

function parse(input: string): Parsed | null {
    const s = input.trim()
    if (!s) return null

    try {
        const url = new URL(s)
        const h   = url.hostname

        if (h.includes('youtube.com') || h.includes('youtu.be')) {
            const id = extractYouTubeId(s)
            return id ? { platform: 'youtube', channelId: id } : null
        }
        if (h.includes('twitch.tv')) {
            const ch = extractTwitchChannel(s)
            return ch ? { platform: 'twitch', channelId: ch } : null
        }
        if (h.includes('kick.com')) {
            const ch = extractKickChannel(s)
            return ch ? { platform: 'kick', channelId: ch } : null
        }
        // Unknown hostname
        return null
    } catch {
        // Not a URL — only match bare YouTube video IDs (11-char specific pattern)
        if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return { platform: 'youtube', channelId: s }
        return null
    }
}

// ---------------------------------------------------------------------------
// Per-platform extractors
// ---------------------------------------------------------------------------
function extractYouTubeId(input: string): string | null {
    const s = input.trim()
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s
    try {
        const url = new URL(s)
        if (url.pathname === '/live_chat') return url.searchParams.get('v')
        const v = url.searchParams.get('v')
        if (v) return v
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts.length > 0) {
            const last = parts[parts.length - 1]
            if (/^[a-zA-Z0-9_-]{11}$/.test(last)) return last
        }
    } catch {
        const m = s.match(/(?:v=|youtu\.be\/|\/live\/)([a-zA-Z0-9_-]{11})/)
        if (m) return m[1]
    }
    return null
}

function extractTwitchChannel(input: string): string | null {
    try {
        const url   = new URL(input)
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts.length > 0 && /^[a-zA-Z0-9_]{3,25}$/.test(parts[0])) return parts[0].toLowerCase()
    } catch {}
    return null
}

function extractKickChannel(input: string): string | null {
    try {
        const url  = new URL(input)
        const skip = new Set(['embed', 'popout', 'chat'])
        const ch   = url.pathname.split('/').filter(Boolean).find(p => !skip.has(p))
        if (ch && /^[a-zA-Z0-9_-]{3,30}$/.test(ch)) return ch.toLowerCase()
    } catch {}
    return null
}

// ---------------------------------------------------------------------------
// Build embed URL from a parsed result
// ---------------------------------------------------------------------------
function buildEmbedUrl({ platform, channelId }: Parsed): string {
    const hostname =
        typeof window !== 'undefined'
            ? window.location.hostname || 'localhost'
            : 'localhost'

    switch (platform) {
        case 'youtube':
            return `https://www.youtube.com/live_chat?v=${channelId}&embed_domain=${hostname}&dark_theme=1`
        case 'twitch':
            return `https://www.twitch.tv/embed/${channelId}/chat?parent=${hostname}&darkpopout`
        case 'kick':
            return `https://kick.com/popout/${channelId}/chat`
    }
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------
interface LiveChatDialogProps {
    config: LiveChatConfig
    onSave: (config: LiveChatConfig) => void
    onClose: () => void
}

function LiveChatDialog({ config, onSave, onClose }: LiveChatDialogProps) {
    const [urlInput, setUrlInput] = useState(config.url)

    const parsed  = parse(urlInput)
    const isValid = !!parsed

    const handleSave = () => {
        if (!parsed) return
        onSave({ url: urlInput.trim() })
        onClose()
    }

    return (
        <div className="flex flex-col h-full min-h-0" style={{ textShadow: TEXT_OUTLINE }}>

            {/* Body */}
            <div className="flex-1 px-6 py-5 flex flex-col gap-5 min-h-0 overflow-y-auto">

                {/* URL input */}
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Stream URL
                    </label>
                    <div className="relative">
                        <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <input
                            value={urlInput}
                            onChange={e => setUrlInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSave()}
                            placeholder="Paste a YouTube, Twitch, or Kick URL…"
                            className={clsx(
                                'w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm text-foreground',
                                'placeholder:text-muted-foreground focus:outline-none focus:ring-1 transition-colors',
                                isValid
                                    ? 'border-emerald-500/50 focus:ring-emerald-500/30'
                                    : 'border-[hsl(var(--chat-border))] focus:ring-white/10'
                            )}
                            style={{ textShadow: TEXT_OUTLINE }}
                            autoFocus
                        />
                    </div>

                    {/* Detection feedback */}
                    {urlInput && !isValid && (
                        <div className="flex items-center gap-1.5 text-xs text-red-400 mt-0.5">
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            Couldn't detect a supported platform — paste a YouTube, Twitch, or Kick URL.
                        </div>
                    )}
                    {isValid && (
                        <div className={clsx('flex items-center gap-1.5 text-xs mt-0.5', PLATFORM_COLOR[parsed.platform])}>
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
                            <span className="flex items-center gap-1">
                                {PLATFORM_LABEL[parsed.platform]}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <span className="font-mono">{parsed.channelId}</span>
                        </div>
                    )}
                </div>

            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-[hsl(var(--chat-border))]">
                <Button variant="secondary" onClick={onClose} className="text-sm">Cancel</Button>
                <Button onClick={handleSave} disabled={!isValid} className="text-sm gap-1.5">
                    <Tv2 className="w-3.5 h-3.5" />
                    Load Chat
                </Button>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------
export function LiveChatWidget() {
    const id = useContext(AppIdContext);
    const DIALOG_EVENT = id + '-overlay-app-dialog'
    const [dialog, setDialog] = useGlobal<string>(DIALOG_EVENT, { initialValue: '' })
    const [config, setConfig] = useDatabase<LiveChatConfig>(id + '-live-chat-widget-config', {
        initialValue: { url: '' },
    })
    const [reloadKey, setReloadKey] = useState(0)
    const iframeRef = useRef<HTMLIFrameElement>(null)

    const parsed = parse(config.url)
    const embedUrl = parsed ? buildEmbedUrl(parsed) : null

    const handleReload = useCallback(() => setReloadKey(k => k + 1), [])

    const handleOpenExternal = useCallback(() => {
        if (!parsed) return
        const urls: Record<Platform, string> = {
            youtube: `https://www.youtube.com/watch?v=${parsed.channelId}`,
            twitch:  `https://www.twitch.tv/${parsed.channelId}`,
            kick:    `https://kick.com/${parsed.channelId}`,
        }
        const url = urls[parsed.platform]
        if (typeof window !== 'undefined' && (window as any).__TAURI__) {
            import('@tauri-apps/plugin-opener')
                .then(({ openUrl }) => openUrl(url))
                .catch(() => window.open(url, '_blank'))
        } else {
            window.open(url, '_blank')
        }
    }, [parsed])

    return (
        <div
            className="select-none font-mono flex flex-col"
            style={{
                background: 'transparent',
                border: 'none',
                borderRadius: 10,
                width: 320,
                height: 700,
                overflow: 'hidden',
                textShadow: TEXT_OUTLINE,
            }}
        >
            {/* Config dialog */}
            <DialogUI
                open={dialog === DIALOG_EVENT}
                onOpenChange={open => { if (!open) setDialog('') }}
            >
                <DialogContent className="max-w-lg h-auto flex flex-col border-accent/20 bg-card p-0 overflow-hidden shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="hidden">Live Chat Configuration</DialogTitle>
                    </DialogHeader>
                    <LiveChatDialog
                        config={config}
                        onSave={newConfig => setConfig(newConfig)}
                        onClose={() => setDialog('')}
                    />
                </DialogContent>
            </DialogUI>

            {/* Chat iframe / empty state */}
            <div
                style={{
                    flex: 1,
                    borderRadius: '0 0 10px 10px',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    background: 'transparent',
                }}
            >
                {embedUrl ? (
                    <>
                        <svg width="0" height="0" style={{ position: 'absolute' }}>
                            <filter id="luma-key">
                                <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="luma" />
                                <feComponentTransfer in="luma" result="alpha_thresholded">
                                    <feFuncA type="linear" slope="10" intercept="-1" />
                                </feComponentTransfer>
                                <feComposite in="SourceGraphic" in2="alpha_thresholded" operator="in" result="keyed" />
                                <feDropShadow in="keyed" dx="0" dy="1" stdDeviation="1.5" floodColor="black" floodOpacity="0.8" />
                            </filter>
                        </svg>
                        <iframe
                            key={reloadKey}
                            ref={iframeRef}
                            src={embedUrl}
                            allow="autoplay; encrypted-media"
                            style={{
                                width: '100%',
                                height: '100%',
                                border: 'none',
                                display: 'block',
                                pointerEvents: 'none',
                                filter: 'url(#luma-key)',
                            }}
                            title="Live Chat"
                            allowTransparency={true}
                        />
                    </>
                ) : (
                    <div
                        style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 12,
                            padding: 24,
                        }}
                    >
                        <div
                            style={{
                                width: 48,
                                height: 48,
                                borderRadius: 12,
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <MessageSquare style={{ width: 22, height: 22, color: 'rgba(255,255,255,0.3)' }} />
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <p style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontFamily: 'sans-serif', margin: 0, marginBottom: 4 }}>
                                No stream set
                            </p>
                            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontFamily: 'sans-serif', margin: 0, lineHeight: 1.5 }}>
                                Right-click and choose{' '}
                                <span style={{ color: 'rgba(255,255,255,0.7)' }}>"Configure Chat"</span>{' '}
                                to enter a stream URL.
                            </p>
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                @keyframes livePulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50%       { opacity: 0.4; transform: scale(0.8); }
                }
            `}</style>
        </div>
    )
}

// ---------------------------------------------------------------------------
// AppRegistry entry
// ---------------------------------------------------------------------------
export const LiveChatRegistryEntry = {
    name: 'Live Chat',
    dialogLabel: 'Configure Chat',
    dialogEvent: 'live-chat-widget-dialog',
    App: LiveChatWidget,
    Icon: <MessageSquare size={16} />,
}