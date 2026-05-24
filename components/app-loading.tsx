import { Copy, Minus, X } from "lucide-react";
import Topbar from "./topbar";
import { Spinner } from "./ui/spinner";
import { motion } from "motion/react";

export interface StartupStatus {
    is_ready: boolean;
    current_task: string;
    progress: number;
    error?: string;
}

export default function AppLoading({ status }: { status?: StartupStatus | null }) {
    return <div className="absolute w-full h-full flex flex-col items-center justify-center overflow-hidden bg-card">
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col items-center gap-6"
        >
            <div className="relative">
                <Spinner className="h-12 w-12 text-primary" />
                {status && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-muted-foreground"
                    >
                        {Math.round(status.progress)}% {status.current_task}
                    </motion.div>
                )}
            </div>
            {status?.error && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-xs text-destructive mt-4 font-mono"
                >
                    Error: {status.error}
                </motion.div>
            )}
        </motion.div>
        <div data-tauri-drag-region className='absolute top-0 w-full h-[4vh] left-0 bg-transparent' style={{ zIndex: 10 }} />
        <div className="absolute z-90 top-[-0.2px] -right-1 p-3 pr-5" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}>
            <X className="cursor-pointer" onClick={() => {
                if ((window as any).__TAURI__) {
                    (window as any).__TAURI__.window.getCurrentWindow().close()
                }
            }} />
        </div>
    </div>
}