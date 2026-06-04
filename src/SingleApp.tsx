import { Book } from "lucide-react";
import { useDatabase,useGlobal } from "openchad-react";
import { openUrl } from '@tauri-apps/plugin-opener'
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;

export default function SingleApp() {
    const [counter, setCounter] = useDatabase("counter", {
        initialValue: { currentValue: 0 },
    });

    const [showMcpDialog, setShowMcpDialog] = useGlobal('showMcpDialog', {initialValue: false})
    const [showCredentialsDialog, setShowCredentialsDialog] = useGlobal('showCredentialsDialog', {initialValue: false})
    const [showLocalModelDialog, setShowLocalModelDialog] = useGlobal('showLocalModelDialog', {initialValue: false})
    const [showCustomEndpointDialog, setShowCustomEndpointDialog] = useGlobal('showCustomEndpointDialog', {initialValue: false})

    const dialogs = [
        {
            label: "Credentials",
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
            ),
            action: () => setShowCredentialsDialog(true),
        },
        {
            label: "Custom Endpoint",
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
            ),
            action: () => setShowCustomEndpointDialog(true),
        },
        {
            label: "Local Model",
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
            ),
            action: () => setShowLocalModelDialog(true),
        },
        {
            label: "MCP",
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
            ),
            action: () => setShowMcpDialog(true),
        },
        {
            label: "Docs",
            icon: (
                <Book size={14} />
            ),
            action: () => {
                if (isTauri) {
                    openUrl('https://openchad.github.io/docs')
                } else {
                    window.open('https://openchad.github.io/docs', '_blank')
                }
            },
        },
    ];

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono flex items-center justify-center p-6">
            <div className="w-full max-w-sm">

                {/* Header */}
                <div className="mb-8 border-b border-zinc-800 pb-4">
                    <p className="text-xs text-zinc-500 uppercase tracking-[0.2em] mb-1">Single App</p>
                </div>

                {/* Dialog Buttons */}
                <div className="mb-8 space-y-2">
                    <p className="text-xs text-zinc-600 uppercase tracking-widest mb-3">Configuration</p>
                    {dialogs.map(({ label, icon, action }) => (
                        <button
                            key={label}
                            onClick={action}
                            className="
                w-full flex items-center gap-3 px-4 py-3
                bg-zinc-900 border border-zinc-800
                hover:bg-zinc-800 hover:border-zinc-600
                active:scale-[0.98]
                transition-all duration-150
                text-sm text-zinc-300 hover:text-white
                rounded
                group
              "
                        >
                            <span className="text-zinc-500 group-hover:text-zinc-300 transition-colors">{icon}</span>
                            <span>{label}</span>
                            <svg
                                className="w-3 h-3 ml-auto text-zinc-700 group-hover:text-zinc-400 transition-colors"
                                fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    ))}
                </div>

                {/* Counter */}
                <div className="border border-zinc-800 rounded bg-zinc-900">
                    <div className="px-4 pt-4 pb-2">
                        <p className="text-xs text-zinc-600 uppercase tracking-widest mb-3">Counter</p>
                        <div className="flex items-center justify-between">
                            <span className="text-5xl font-bold text-white tabular-nums">
                                {counter.currentValue}
                            </span>
                            <div className="flex flex-col items-end gap-1">
                                <span className="text-xs text-zinc-700">current value</span>
                                <div className="h-1 w-12 bg-zinc-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-zinc-400 rounded-full transition-all duration-300"
                                        style={{ width: `${Math.min((counter.currentValue % 10) * 10, 100)}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="px-4 pb-4 pt-2 border-t border-zinc-800 mt-2 flex items-center gap-2">
                        <button
                            onClick={() => setCounter({ currentValue: counter.currentValue + 1 })}
                            className="
                flex-1 flex items-center justify-center gap-2
                bg-white text-zinc-950
                hover:bg-zinc-200
                active:scale-[0.97]
                transition-all duration-150
                py-2.5 px-4 rounded
                text-sm font-semibold
              "
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                            Increment
                        </button>
                        <button
                            onClick={() => setCounter({ currentValue: 0 })}
                            className="
                flex items-center justify-center
                border border-zinc-700 text-zinc-500
                hover:border-zinc-500 hover:text-zinc-300
                active:scale-[0.97]
                transition-all duration-150
                py-2.5 px-3 rounded
                text-sm
              "
                            title="Reset"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}