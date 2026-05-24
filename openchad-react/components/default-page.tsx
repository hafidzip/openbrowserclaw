import Composer from "./composer";
import { useRef, useLayoutEffect, useState, useEffect } from "react";
import useElementSize from "./hooks/useElementSize";
import clsx from "clsx";
import type { AppInfo } from "../utils/utils";
import { usePython } from "./usePython";
import MessageContainer from "./message-container";
import { sha256 } from "js-sha256";
import ModelSelection from "./model-selection";
import { ArrowDown } from "lucide-react";
import { generateIdFromString } from "../index";

export interface MessageState {
    title: string | null;
    activeId: string;
    errorMsg: string;
    isStreaming: boolean;
    initialized: boolean;
    context: string;
}


export default function DefaultPage(AppInfo: AppInfo) {
    const { layout } = AppInfo.useTheme();
    const { workspace } = AppInfo.useWorkspace();
    const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
    const msgBottomRef = useRef<HTMLDivElement>(null);
    const [scrollContainerRef] = useElementSize<HTMLDivElement>();
    const [model, setModel] = AppInfo.useModel();
    const tabId = AppInfo.tabId;
    const activeId = AppInfo.useActiveTabId();
    const [messageState, setMessageState] = AppInfo.useTabDatabase<MessageState>("message_state", {
        initialValue: {
            title: null,
            activeId: "",
            errorMsg: "",
            initialized: false,
            isStreaming: false,
            context: "",
        },
    });
    const { pyInvoke } = usePython();
    const [containerRef, { width, height }] = useElementSize<HTMLDivElement>();
    const [mounted, setMounted] = useState(false);
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const [showScrollBottom, setShowScrollBottom] = useState(false);
    const isStreamingRef = useRef(messageState.isStreaming);
    const wasNearBottomRef = useRef(true);
    const [justOpen, setJustOpen] = useState(true);
    const title = AppInfo.useTitle();
    const currentTab = AppInfo.useTab()
    useEffect(() => {
        if (title) return;
        const _t = messageState.title;
        if (mounted && _t && typeof currentTab?.childrenProps !== "undefined") {
            AppInfo.setTitle(_t);
        }
    }, [messageState.title, title, mounted]);
    useEffect(() => {
        if (mounted) {
            (async () => {
                const check = await pyInvoke("v1/check");
                if (check.result) {
                    const tb = generateIdFromString(tabId + "/" + "message_state");
                    await pyInvoke('sqlite', {
                        command: 'query',
                        db: workspace,
                        table: tb,
                        sql: `UPDATE ${tb} SET _v = 'false' WHERE id = 'isStreaming'`
                    });
                }
            })();
        }
    }, [mounted]);
    useEffect(() => {
        if (activeId == tabId) {
            setTimeout(() => {
                scrollToBottom('instant');
                setJustOpen(false);
            }, 100);
        } else {
            setJustOpen(true);
        }
    }, [activeId]);
    useEffect(() => {
        isStreamingRef.current = messageState.isStreaming;
    }, [messageState.isStreaming]);
    const checkScrollBottom = () => {
        if (!scrollAreaRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollAreaRef.current;
        const isScrollable = scrollHeight > clientHeight + 1;
        const isNearBottom = !isScrollable || scrollHeight - scrollTop - clientHeight < 150;
        setShowScrollBottom(!isNearBottom);
        wasNearBottomRef.current = isNearBottom;
    };
    const handleScroll = () => {
        checkScrollBottom();
    };
    const scrollToBottom = (behavior?: "smooth" | "instant" | "auto") => {
        if (!scrollAreaRef.current) return;
        scrollAreaRef.current.scrollTo({
            top: scrollAreaRef.current.scrollHeight,
            behavior: behavior || "smooth"
        });
    };
    useEffect(() => {
        if (messageState.isStreaming || messageState.initialized) {
            setTimeout(() => {
                if (scrollAreaRef.current) {
                    scrollAreaRef.current.scrollTo({
                        top: scrollAreaRef.current.scrollHeight,
                        behavior: "smooth"
                    });
                }
            }, 100);
        }
    }, [messageState.isStreaming, messageState.initialized]);
    async function request(query: string, targetTable: string, branchId: string, index: number | string, response_branch: number) {
        const activeId = AppInfo.tabId + "_response_" + branchId + "_" + response_branch + "_" + index;
        if (messageState.activeId === activeId) {
            return;
        }
        setMessageState(prev => ({
            ...prev,
            activeId: activeId,
            isStreaming: true,
            initialized: true
        }));
        try {
            const streamRes = await pyInvoke("v1/chat/completions", {
                id: activeId,
                query: query,
                stream: true,
                model: model.id,
                tab_id: AppInfo.tabId,
                branch_id: branchId,
                index: index,
                response_branch: response_branch,
                tb: targetTable,
                workspace: workspace,
                app_name: AppInfo.appname,
                pipeline: AppInfo.settings["Others/app_settings/string.pipeline"]?.value || "openchad/chat"
            });
            if (streamRes && typeof streamRes === 'object' && Symbol.asyncIterator in streamRes) {
                var iter = 0;
                for await (const _ of streamRes as any) {
                    iter++;
                }
            }
        } catch (error) {
            setMessageState(prev => ({
                ...prev,
                isStreaming: false,
                errorMsg: (error as Error)?.message || "Unknown error"
            }));
        }
    }
    useEffect(() => {
        setMounted(true);
    }, []);
    useLayoutEffect(() => {
        if (!mounted) return;
        const updateHeight = () => {
            const emptyContainer = document.getElementById(AppInfo.tabId + "_empty_message_container");
            if (!emptyContainer || !msgBottomRef.current) return;
            const lastValidIndex = emptyContainer.getAttribute("data-last-valid-index");
            if (!lastValidIndex) return;
            const messageElement = document.getElementById("container_" + lastValidIndex);
            if (!messageElement) return;
            const messageHeight = messageElement.offsetHeight;
            if (messageHeight === 0) return;
            const extraSpace = 150;
            const finalHeight = messageHeight + (messageState.isStreaming ? 15 : 0);
            const spacer = Math.max(0, height - finalHeight - extraSpace);
            msgBottomRef.current.style.height = `${spacer}px`;
        };
        const handleResize = () => {
            const wasNearBottom = wasNearBottomRef.current;
            updateHeight();
            if (wasNearBottom && scrollAreaRef.current) {
                scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
            }
            checkScrollBottom();
        };
        let resizeObserver: ResizeObserver | null = null;
        let mutationObserver: MutationObserver | null = null;
        let lastMessageObserver: ResizeObserver | null = null;
        let observedMessageId: string | null = null;
        let checkInterval: number | null = null;
        const observeLastMessage = () => {
            const emptyContainer = document.getElementById(AppInfo.tabId + "_empty_message_container");
            const idx = emptyContainer?.getAttribute("data-last-valid-index");
            if (!idx || idx === observedMessageId) return;
            const el = document.getElementById("container_" + idx);
            if (!el) return;
            lastMessageObserver?.disconnect();
            observedMessageId = idx;
            lastMessageObserver = new ResizeObserver(() => {
                handleResize();
            });
            lastMessageObserver.observe(el);
        };
        const setupObserver = () => {
            const containerEl = document.getElementById("messages-container");
            if (!containerEl) {
                if (!checkInterval) {
                    checkInterval = window.setInterval(() => {
                        setupObserver();
                    }, 50);
                }
                return;
            }
            if (checkInterval) {
                clearInterval(checkInterval);
                checkInterval = null;
            }
            mutationObserver = new MutationObserver(() => {
                observeLastMessage();
            });
            mutationObserver.observe(containerEl, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'data-last-valid-index'],
            });
            resizeObserver = new ResizeObserver(() => {
                handleResize();
            });
            handleResize();
            resizeObserver.observe(containerEl);
            observeLastMessage();
        };
        setupObserver();
        return () => {
            if (checkInterval) clearInterval(checkInterval);
            if (resizeObserver) resizeObserver.disconnect();
            if (mutationObserver) mutationObserver.disconnect();
            lastMessageObserver?.disconnect();
        };
    }, [mounted, height, messageState.initialized, messageState.isStreaming]);
    async function waitForElement(elementId: string, timeout: number = 5000): Promise<HTMLElement | null> {
        const startTime = Date.now();
        return new Promise((resolve, reject) => {
            const checkElement = () => {
                const el = document.getElementById(elementId);
                if (el) {
                    resolve(el);
                    return;
                }
                if (Date.now() - startTime > timeout) {
                    reject(new Error(`Element with id "${elementId}" not found within ${timeout}ms`));
                    return;
                }
                requestAnimationFrame(checkElement);
            };
            checkElement();
        });
    }
    return (
        <div
            ref={containerRef}
            className={clsx(
                "w-full h-full flex flex-col items-center absolute transition-opacity duration-300",
                ((width === 0 || height === 0) || justOpen) ? 'opacity-0' : 'opacity-100',
            )}
        >
            <ModelSelection
                model={model}
                setModel={setModel}
                layout={layout}
            />
            <div style={{
                height: width < 800 || height < 650 || messageState.initialized ? `${height}px` : `${height * 0.2}px`,
            }} className={clsx(
                "overflow-visible flex flex-col items-center absolute top-1/2 transform -translate-y-1/2",
                (width < 500 || height < 500) ? 'gap-1' : (width < 800 || height < 650 || messageState.initialized) ? 'gap-5' : 'gap-1',
                messageState.initialized && "w-full h-full",
            )}>
                <div
                    ref={scrollAreaRef}
                    onScroll={handleScroll}
                    className={clsx(
                        (width < 800 || height < 650 || messageState.initialized) ? messageState.initialized ? 'h-full' : 'flex-1 relative' : '',
                        'w-full overflow-y-auto flex pt-5',
                        messageState.initialized ? "items-start" : "text-center items-center justify-center",
                    )}
                >
                    {
                        messageState.initialized ?
                            <div className="relative w-full flex justify-center overflow-y-auto pb-25">
                                <div id="messages-container" className={clsx(
                                    "flex flex-col relative overflow-x-hidden pt-5 w-full px-2",
                                    width < 800 ? 'max-w-full small-content' : 'max-w-[40vw]',
                                )}>
                                    <MessageContainer
                                        workspace={workspace}
                                        isStreaming={messageState.isStreaming}
                                        request={request}
                                        activeId={messageState.isStreaming ? messageState.activeId : null}
                                        tabId={AppInfo.tabId}
                                        useDatabase={(tb, options) => {
                                            return AppInfo.useTabDatabase(tb, options);
                                        }}
                                        index={0}
                                        branch={sha256("0").slice(0, 32)}
                                    />
                                    {messageState.errorMsg.length > 0 && (
                                        <div className="bg-red-300 dark:bg-red-900 text-red-500 dark:text-red-300 p-2 rounded-md border border-red-500 mt-2 text-break break-all">
                                            {messageState.errorMsg}
                                        </div>
                                    )}
                                    <div
                                        ref={msgBottomRef}
                                        className="w-full flex-shrink-0"
                                        style={{ height: "0px" }}
                                        aria-hidden="true"
                                    />
                                </div>
                                <div className="fixed -top-1 w-[99%] h-17 bg-gradient-to-b from-card via-card via-70% to-transparent" />
                                <div className="fixed bottom-0 w-[99%] h-20 bg-gradient-to-t from-card via-card via-70% to-transparent" />
                            </div>
                            :
                            <h1 className={clsx("text-accent mb-4", (width < 500 || height < 500) ? 'text-lg' : (width < 800 || height < 650) ? 'text-3xl' : 'text-3xl absolute bottom-full')}>Hi, How can I help you?</h1>
                    }
                </div>
                {messageState.initialized && showScrollBottom && (
                    <button
                        onClick={() => { scrollToBottom(); }}
                        className={clsx(
                            "fixed z-40 p-2.5 rounded-full bg-card/95 dark:bg-zinc-900/95 border border-[hsl(var(--chat-border))] dark:border-zinc-800 shadow-md text-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-200 flex items-center justify-center cursor-pointer group",
                            width < 800 ? "bottom-24 left-1/2" : "bottom-32 left-1/2"
                        )}
                        style={{ transform: 'translateX(-50%)' }}
                    >
                        <ArrowDown className="w-4 h-4 group-hover:translate-y-0.5 transition-transform duration-200" />
                    </button>
                )}
                <Composer
                    workspace={workspace}
                    onSubmit={async (value: string) => {
                        if (messageState.isStreaming) {
                            await pyInvoke(
                                "v1/chat/stop",
                                { id: messageState.activeId }
                            );
                            setMessageState((prev) => ({
                                ...prev,
                                isStreaming: false,
                            }));
                        } else {
                            if (model.id && value.trim().length > 0) {
                                setMessageState((prev) => ({
                                    ...prev,
                                    errorMsg: "",
                                    isStreaming: true,
                                    initialized: true,
                                }));
                                const el = await waitForElement(AppInfo.tabId + "_empty_message_container");
                                const branchId = el?.getAttribute("data-branch-id");
                                const targetTable = el?.getAttribute("data-tb");
                                const branchIndex = Number(el?.getAttribute("data-branch-index") ?? 0);
                                if (typeof branchId === "string" && typeof targetTable === "string" && !isNaN(branchIndex)) {
                                    await request(value, targetTable, branchId, branchIndex, 0);
                                }
                            } else {
                                setMessageState((prev) => ({
                                    ...prev,
                                    errorMsg: "No Model Selected",
                                    initialized: true,
                                }));
                            }
                        }
                    }}
                    width={width}
                    height={height}
                    isStreaming={messageState.isStreaming}
                    style={{ maxWidth: `${width - 10}px` }}
                    ref={composerTextareaRef}
                    className={clsx(
                        "w-[768px] mx-auto z-30",
                        messageState.initialized ? 'absolute' : 'relative',
                        messageState.initialized
                            ? ((width < 500 || height < 500) ? "overflow-visible bottom-2" : (width < 800 || height < 650) ? 'bottom-2' : 'bottom-5')
                            : ((width < 500 || height < 500) ? "overflow-visible bottom-2" : (width < 800 || height < 650) ? 'bottom-2' : ''),
                    )}
                />
                <>
                    <div
                        ref={scrollContainerRef}
                        className={clsx(
                            `relative w-[768px] px-4 h-fit transition-opacity duration-200 `,
                            'flex items-center justify-center',
                            (width < 800 || height < 650 || messageState.initialized) && 'hidden pointer-events-none',
                        )}
                    >
                    </div>
                </>
            </div>
        </div>
    );
}