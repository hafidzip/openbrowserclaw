import { useDatabase, useEvent } from "openchad-react";
import { useState } from "react";
import { Dialog as DialogUI, DialogContent, DialogHeader, DialogTitle } from "openchad-react/components/ui/dialog";
import { useGlobal } from "openchad-react/components/useGlobal";

export default function OverlayApp() {
    const [counter, setCounter] = useDatabase("counter", {
        initialValue: { currentValue: 0 },
    });

    const [dialog, setDialog] = useGlobal<string>("overlay-app-dialog", { initialValue: '' })

    useEvent("open-counter-dialog", () => {
        setDialog("open-counter-dialog");
    })

    return (
            <div className="bg-bg w-fit h-fit border border-[hsl(var(--border))] p-4" data-tauri-cursor-region={true}>

                <DialogUI open={dialog === "open-counter-dialog"} onOpenChange={(open) => {
                    if(!open) {
                        setDialog('') 
                    }
                }}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle></DialogTitle>
                        </DialogHeader>
                    </DialogContent>
                </DialogUI>

                {/* Header */}
                <div className="mb-8 border-b border-zinc-800 pb-4">
                    <p className="text-xs text-zinc-500 uppercase tracking-[0.2em] mb-1">Overlay App</p>
                    <input/>
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
        
    );
}