import Composer from "./composer";
import { useRef, useLayoutEffect, useState, useEffect, useCallback } from "react";
import useElementSize from "./hooks/useElementSize";
import clsx from "clsx";
import type { AppInfo } from "../utils/utils";
import { sanitizeTauriEvent } from "../utils/utils";
import { usePython } from "./usePython";
import MessageContainer, { QueryContent } from "./message-container";
import { sha256 } from "js-sha256";
import ModelSelection from "./model-selection";
import { ArrowDown } from "lucide-react";
import { generateIdFromString, useAvailableAgents, useGlobal, type IAgent } from "../index";
import type { SelectionMode } from "./composer";
import { setMenuBarAppId } from "openchad-react/utils/state";
import { useDatabaseImpl } from "./useDatabase";

export interface MessageState {
    title: string | null;
    activeId: string;
    errorMsg: string;
    isStreaming: boolean;
    initialized: boolean;
    dontStop: boolean;
    context: string;
}

export default function DefaultPage(AppInfo: AppInfo) {
    const { layout } = AppInfo.useTheme();
    const { workspace } = AppInfo.useWorkspace();
    const workspaceRef = useRef(workspace);
    const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
    const msgBottomRef = useRef<HTMLDivElement>(null);
    const [scrollContainerRef] = useElementSize<HTMLDivElement>();
    const [model, setModel] = AppInfo.useModel();
    const tabId = AppInfo.tabId;
    const appId = AppInfo.appId;
    const [selectedAgent, setSelectedAgent] = useDatabaseImpl<IAgent>(`selected-agent-${tabId}`, { initialValue: { name: null, id: null } });
    const [selectionMode] = useState<SelectionMode>('agent');
    const { agents: availableAgents, isLoading: isAgentsLoading } = useAvailableAgents();
    const availableAgentsRef = useRef(availableAgents);
    availableAgentsRef.current = availableAgents;
    const activeId = AppInfo.useActiveTabId();
    const [messageState, setMessageState, { ready }] = AppInfo.useTabDatabase<MessageState>("message_state", {
        initialValue: {
            title: null,
            activeId: "",
            errorMsg: "",
            initialized: false,
            isStreaming: false,
            dontStop: false,
            context: "",
        },
    });
    const readyRef = useRef(ready);
    readyRef.current = ready;
    const messageStateRef = useRef(messageState);
    messageStateRef.current = messageState;
    const { pyInvoke } = usePython();
    const [containerRef, { width, height }] = useElementSize<HTMLDivElement>();
    const [mounted, setMounted] = useState(false);
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const [showScrollBottom, setShowScrollBottom] = useState(false);
    const isStreamingRef = useRef(messageState.isStreaming);
    const wasNearBottomRef = useRef(true);
    const [justOpen, setJustOpen] = useState(true);
    const title = AppInfo.useTitle();
    const currentTab = AppInfo.useTab();

    const [loadedMessages, setLoadedMessages] = useState<any[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const loadedMessagesLengthRef = useRef(0);
    const hasMoreRef = useRef(false);
    const loadingRef = useRef(false);
    const loadMoreRef = useRef<(() => Promise<void>) | null>(null);

    const isInitialized = messageState.initialized || loadedMessages.length > 0;

    const [pendingMessage, setPendingMessage] = useState<{ query: string, childBranchId: string } | null>(null);
    const [loadAgentFromTask, setLoadAgentFromTask] = useState(false);
    const loadAgentFromTaskRef = useRef(loadAgentFromTask);
    loadAgentFromTaskRef.current = loadAgentFromTask;

    async function syncAgentFromTask() {
        const oldData: any = await pyInvoke('sqlite', {
            db: workspaceRef.current ?? "global",
            command: "query",
            sql: `SELECT * FROM tasks WHERE id = ?`,
            params: [tabId],
        });
        if (oldData && oldData.data[0] && availableAgentsRef.current) {
            try {
                const data = JSON.parse(oldData.data[0].metadata);
                if (data.agent) {
                    setSelectedAgent({ id: data.agent, name: availableAgentsRef.current.find((a) => a.id === data.agent)?.name ?? null });
                }
            } catch (e) {
                console.error(e);
            }
        }
    }

    useEffect(() => {
        if (!loadAgentFromTask && availableAgents.length > 0) {
            setLoadAgentFromTask(true);
            (async () => {
                await syncAgentFromTask()
            })()
        }
    }, [loadAgentFromTask, availableAgents])

    useEffect(() => {
        if (selectedAgent.id && loadAgentFromTaskRef.current) {
            (async () => {
                const oldData: any = await pyInvoke('sqlite', {
                    db: workspaceRef.current ?? "global",
                    command: "query",
                    sql: `SELECT * FROM tasks WHERE id = ?`,
                    params: [tabId],
                });
                if (oldData && oldData.data[0]) {
                    try {
                        const data = JSON.parse(oldData.data[0].metadata);
                        await pyInvoke('sqlite', {
                            db: workspaceRef.current ?? "global",
                            command: "execute",
                            sql: `INSERT OR REPLACE INTO tasks (id, metadata) VALUES (?, ?)`,
                            params: [tabId, JSON.stringify({
                                icon: data.icon,
                                query: data.query,
                                interval: data.interval,
                                agent: selectedAgent.id,
                                timestamp: Date.now(),
                            })],
                        });
                    } catch (e) {
                        console.error(e);
                    }
                }
            })()
        }
    }, [selectedAgent]);


    useEffect(() => {
        if (pendingMessage) {
            const exists = loadedMessages.some(m => m.childBranchId === pendingMessage.childBranchId);
            if (exists) {
                setPendingMessage(null);
            }
        }
    }, [loadedMessages, pendingMessage]);

    useEffect(() => {
        loadedMessagesLengthRef.current = loadedMessages.length;
    }, [loadedMessages.length]);

    useEffect(() => {
        hasMoreRef.current = hasMore;
    }, [hasMore]);

    useEffect(() => {
        loadingRef.current = loading;
    }, [loading]);

    useEffect(() => {
        if (activeId == tabId && currentTab && currentTab.children[0] == appId) {
            setMenuBarAppId('');
        }
    }, [activeId]);

    useEffect(() => {
        if (activeId == tabId) {
            scrollToBottom('instant');
            setJustOpen(false);
        } else {
            setJustOpen(true);
        }
    }, [activeId]);

    useEffect(() => {
        isStreamingRef.current = messageState.isStreaming;
    }, [messageState.isStreaming]);

    const checkScrollBottom = () => {
        if (!scrollAreaRef.current) return;
        const { scrollTop } = scrollAreaRef.current;
        // In column-reverse layout, scrollTop is 0 at the bottom (most recent messages)
        const isNearBottom = Math.abs(scrollTop) < 150;
        setShowScrollBottom(!isNearBottom);
        wasNearBottomRef.current = isNearBottom;
    };

    const handleScroll = () => {
        checkScrollBottom();
    };

    const scrollToBottom = (behavior?: "smooth" | "instant" | "auto") => {
        if (!scrollAreaRef.current) return;
        scrollAreaRef.current.scrollTo({
            top: 0,
            behavior: behavior || "smooth"
        });
    };

    useEffect(() => {
        const tabUpdate = (event: Event) => {
            const { tabId: targetTabId, title: newTitle, icon: newIcon } = (event as CustomEvent).detail;
            (async () => {
                if (workspaceRef.current && newTitle && targetTabId && newIcon && targetTabId === tabId) {
                    const oldData: any = await pyInvoke('sqlite', {
                        db: workspaceRef.current ?? "global",
                        command: "query",
                        sql: `SELECT * FROM tasks WHERE id = ?`,
                        params: [tabId],
                    });
                    if (oldData && oldData.data[0]) {
                        try {
                            if (readyRef.current) {
                                console.log("newtitle", newTitle)
                                setMessageState(prev => ({
                                    ...prev,
                                    title: newTitle,
                                }));
                            }
                            const data = JSON.parse(oldData.data[0].metadata);
                            await pyInvoke('sqlite', {
                                db: workspaceRef.current ?? "global",
                                command: "execute",
                                sql: `INSERT OR REPLACE INTO tasks (id, metadata) VALUES (?, ?)`,
                                params: [tabId, JSON.stringify({
                                    icon: newIcon,
                                    query: data.query,
                                    interval: data.interval,
                                    agent: data.agent,
                                    timestamp: Date.now(),
                                })],
                            });
                        } catch (e) {
                            console.error(e);
                        }
                    }
                }
            })();
        };
        window.addEventListener('tab-update', tabUpdate);
        window.addEventListener('agent-update', syncAgentFromTask);
        return () => {
            window.removeEventListener('tab-update', tabUpdate);
            window.removeEventListener('agent-update', syncAgentFromTask);
        };
    }, []);

    useEffect(() => {
        if (messageState.isStreaming || messageState.initialized) {
            setTimeout(() => {
                if (scrollAreaRef.current) {
                    scrollAreaRef.current.scrollTo({
                        top: 0,
                        behavior: "smooth"
                    });
                }
            }, 100);
        }
    }, [messageState.isStreaming, messageState.initialized]);

    async function request(query: string, targetTable: string, branchId: string, index: number | string, response_branch: number) {
        const activeId = AppInfo.tabId + "_response_" + branchId + "_" + response_branch + "_" + index;
        let errorlog: string | null = null;
        if (messageState.activeId === activeId) {
            return;
        }
        setMessageState(prev => ({
            ...prev,
            activeId: activeId,
            isStreaming: true,
            initialized: true,
            errorMsg: ''
        }));
        try {
            const streamRes = await pyInvoke("v1/chat/completions", {
                id: activeId,
                query: query,
                stream: true,
                ...(selectionMode === 'agent' && selectedAgent
                    ? { agent: selectedAgent.id }
                    : { model: model.id }),
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
            errorlog = JSON.stringify(error);
        } finally {
            refreshActiveMessages()
            setMessageState(prev => ({
                ...prev,
                activeId: '',
                isStreaming: false,
                ...(errorlog && { errorMsg: errorlog })
            }));
        }
    }

    // Keyset Recursive CTE Pagination
    const refreshActiveMessages = useCallback(async (customLimit?: number) => {
        if (!workspace || !tabId) {
            return;
        }
        const messagesTable = generateIdFromString(tabId + "/messages");
        const branchesTable = generateIdFromString(tabId + "/conversation_branches");
        const rootParent = sha256("0").slice(0, 32);

        const findLeafSql = `
          WITH SiblingNumbered AS (
              SELECT 
                  parent_branch_id, 
                  child_branch_id, 
                  msg_index, 
                  ROW_NUMBER() OVER (PARTITION BY parent_branch_id ORDER BY timestamp ASC) - 1 AS sibling_idx
              FROM \`${messagesTable}\`
          ),
          ActiveChain AS (
              SELECT 
                  s.parent_branch_id, 
                  s.child_branch_id, 
                  s.msg_index,
                  s.sibling_idx
              FROM SiblingNumbered s
              LEFT JOIN \`${branchesTable}\` b 
                ON s.parent_branch_id = b.parent_branch_id AND s.msg_index = b.msg_index
              WHERE (s.parent_branch_id = ? OR s.parent_branch_id = ? || '_0')
                AND s.sibling_idx = COALESCE(b.selected_branch_index, 0)

              UNION ALL

              SELECT 
                  s.parent_branch_id, 
                  s.child_branch_id, 
                  s.msg_index,
                  s.sibling_idx
              FROM SiblingNumbered s
              JOIN ActiveChain a ON s.parent_branch_id = (a.child_branch_id || '_' || a.sibling_idx)
              LEFT JOIN \`${branchesTable}\` b 
                ON s.parent_branch_id = b.parent_branch_id AND s.msg_index = b.msg_index
              WHERE s.sibling_idx = COALESCE(b.selected_branch_index, 0)
          )
          SELECT child_branch_id FROM ActiveChain ORDER BY msg_index DESC LIMIT 1;
        `;

        try {
            const leafRowsRaw: any = await pyInvoke('sqlite', {
                db: workspace,
                table: messagesTable,
                command: 'query',
                sql: findLeafSql,
                params: [rootParent, rootParent]
            });

            const leafRows = Array.isArray(leafRowsRaw) ? leafRowsRaw : (leafRowsRaw?.data || []);

            if (!leafRows || leafRows.length === 0) {
                setActiveLeafId(null);
                setLoadedMessages([]);
                setHasMore(false);
                return;
            }

            const leafId = leafRows[0].child_branch_id;
            setActiveLeafId(leafId);

            const queryLimit = customLimit || Math.max(20, loadedMessagesLengthRef.current);

            const fetchChainSql = `
              WITH RECURSIVE chat_chain AS (
                  SELECT parent_branch_id, child_branch_id, msg_index, query, responses, response_branch, timestamp, 1 as depth
                  FROM \`${messagesTable}\`
                  WHERE child_branch_id = ?
                  
                  UNION ALL
                  
                  SELECT m.parent_branch_id, m.child_branch_id, m.msg_index, m.query, m.responses, m.response_branch, m.timestamp, c.depth + 1
                  FROM \`${messagesTable}\` m
                  JOIN chat_chain c ON m.child_branch_id = SUBSTR(c.parent_branch_id, 1, 32)
                  WHERE c.depth < ?
              )
              SELECT parent_branch_id, child_branch_id, msg_index, query, responses, response_branch, timestamp FROM chat_chain;
            `;

            const chainRowsRaw: any = await pyInvoke('sqlite', {
                db: workspace,
                table: messagesTable,
                command: 'query',
                sql: fetchChainSql,
                params: [leafId, queryLimit]
            });

            const chainRows = Array.isArray(chainRowsRaw) ? chainRowsRaw : (chainRowsRaw?.data || []);

            if (!chainRows || chainRows.length === 0) {
                setLoadedMessages([]);
                setHasMore(false);
                return;
            }

            const parentIds = chainRows.map((r: any) => r.parent_branch_id);
            const uniqueParentIds = Array.from(new Set(parentIds)).filter(Boolean);

            let siblingsGrouped: Record<string, string[]> = {};
            if (uniqueParentIds.length > 0) {
                const placeholders = uniqueParentIds.map(() => '?').join(',');
                const fetchSiblingsSql = `
                  SELECT parent_branch_id, child_branch_id, timestamp
                  FROM \`${messagesTable}\`
                  WHERE parent_branch_id IN (${placeholders})
                  ORDER BY timestamp ASC;
                `;

                const siblingRowsRaw: any = await pyInvoke('sqlite', {
                    db: workspace,
                    table: messagesTable,
                    command: 'query',
                    sql: fetchSiblingsSql,
                    params: uniqueParentIds
                });

                const siblingRows = Array.isArray(siblingRowsRaw) ? siblingRowsRaw : (siblingRowsRaw?.data || []);

                if (Array.isArray(siblingRows)) {
                    siblingRows.forEach((sRow: any) => {
                        const pid = sRow.parent_branch_id;
                        if (!siblingsGrouped[pid]) {
                            siblingsGrouped[pid] = [];
                        }
                        siblingsGrouped[pid].push(sRow.child_branch_id);
                    });
                }
            }

            const parsedMessages = chainRows.map((row: any) => {
                const pBranchId = row.parent_branch_id;
                const cBranchId = row.child_branch_id;
                const siblings = siblingsGrouped[pBranchId] || [cBranchId];
                const siblingIndex = siblings.indexOf(cBranchId);
                const totalSiblings = siblings.length;

                let parsedResp = [];
                if (row.responses) {
                    if (typeof row.responses === 'string') {
                        try {
                            parsedResp = JSON.parse(row.responses);
                        } catch {
                            parsedResp = [];
                        }
                    } else if (Array.isArray(row.responses)) {
                        parsedResp = row.responses;
                    }
                }

                return {
                    parentBranchId: pBranchId,
                    childBranchId: cBranchId,
                    msg_index: row.msg_index,
                    query: row.query || "",
                    responses: parsedResp,
                    responseBranch: row.response_branch ?? 0,
                    siblingIndex: siblingIndex >= 0 ? siblingIndex : 0,
                    totalSiblings: totalSiblings,
                };
            });

            parsedMessages.sort((a: any, b: any) => b.msg_index - a.msg_index);
            setLoadedMessages(parsedMessages);

            const oldestMsg = parsedMessages[parsedMessages.length - 1];
            if (chainRows.length < queryLimit) {
                setHasMore(false);
            } else if (oldestMsg && oldestMsg.parentBranchId === rootParent) {
                setHasMore(false);
            } else {
                setHasMore(true);
            }

        } catch (error) {
            console.error("[DefaultPage] Failed to refresh active messages", error);
        }
    }, [workspace, tabId]);

    const loadMoreMessages = useCallback(async () => {
        if (loading || !hasMore || !workspace || !tabId || loadedMessages.length === 0) {
            return;
        }
        setLoading(true);

        const messagesTable = generateIdFromString(tabId + "/messages");
        const rootParent = sha256("0").slice(0, 32);
        const oldestMsg = loadedMessages[loadedMessages.length - 1];
        const anchorId = oldestMsg.parentBranchId.slice(0, 32);

        const fetchChainSql = `
          WITH RECURSIVE chat_chain AS (
              SELECT parent_branch_id, child_branch_id, msg_index, query, responses, response_branch, timestamp, 1 as depth
              FROM \`${messagesTable}\`
              WHERE child_branch_id = ?
              
              UNION ALL
              
              SELECT m.parent_branch_id, m.child_branch_id, m.msg_index, m.query, m.responses, m.response_branch, m.timestamp, c.depth + 1
              FROM \`${messagesTable}\` m
              JOIN chat_chain c ON m.child_branch_id = SUBSTR(c.parent_branch_id, 1, 32)
              WHERE c.depth < ?
          )
          SELECT parent_branch_id, child_branch_id, msg_index, query, responses, response_branch, timestamp FROM chat_chain;
        `;

        try {
            const chainRowsRaw: any = await pyInvoke('sqlite', {
                db: workspace,
                table: messagesTable,
                command: 'query',
                sql: fetchChainSql,
                params: [anchorId, 20]
            });

            const chainRows = Array.isArray(chainRowsRaw) ? chainRowsRaw : (chainRowsRaw?.data || []);

            if (!chainRows || chainRows.length === 0) {
                setHasMore(false);
                setLoading(false);
                return;
            }

            const parentIds = chainRows.map((r: any) => r.parent_branch_id);
            const uniqueParentIds = Array.from(new Set(parentIds)).filter(Boolean);

            let siblingsGrouped: Record<string, string[]> = {};
            if (uniqueParentIds.length > 0) {
                const placeholders = uniqueParentIds.map(() => '?').join(',');
                const fetchSiblingsSql = `
                  SELECT parent_branch_id, child_branch_id, timestamp
                  FROM \`${messagesTable}\`
                  WHERE parent_branch_id IN (${placeholders})
                  ORDER BY timestamp ASC;
                `;

                const siblingRowsRaw: any = await pyInvoke('sqlite', {
                    db: workspace,
                    table: messagesTable,
                    command: 'query',
                    sql: fetchSiblingsSql,
                    params: uniqueParentIds
                });

                const siblingRows = Array.isArray(siblingRowsRaw) ? siblingRowsRaw : (siblingRowsRaw?.data || []);

                if (Array.isArray(siblingRows)) {
                    siblingRows.forEach((sRow: any) => {
                        const pid = sRow.parent_branch_id;
                        if (!siblingsGrouped[pid]) {
                            siblingsGrouped[pid] = [];
                        }
                        siblingsGrouped[pid].push(sRow.child_branch_id);
                    });
                }
            }

            const parsedMessages = chainRows.map((row: any) => {
                const pBranchId = row.parent_branch_id;
                const cBranchId = row.child_branch_id;
                const siblings = siblingsGrouped[pBranchId] || [cBranchId];
                const siblingIndex = siblings.indexOf(cBranchId);
                const totalSiblings = siblings.length;

                let parsedResp = [];
                if (row.responses) {
                    if (typeof row.responses === 'string') {
                        try {
                            parsedResp = JSON.parse(row.responses);
                        } catch {
                            parsedResp = [];
                        }
                    } else if (Array.isArray(row.responses)) {
                        parsedResp = row.responses;
                    }
                }

                return {
                    parentBranchId: pBranchId,
                    childBranchId: cBranchId,
                    msg_index: row.msg_index,
                    query: row.query || "",
                    responses: parsedResp,
                    responseBranch: row.response_branch ?? 0,
                    siblingIndex: siblingIndex >= 0 ? siblingIndex : 0,
                    totalSiblings: totalSiblings,
                };
            });

            parsedMessages.sort((a: any, b: any) => b.msg_index - a.msg_index);

            setLoadedMessages(prev => {
                const combined = [...prev, ...parsedMessages];
                const seen = new Set();
                const filtered = combined.filter(m => {
                    if (seen.has(m.childBranchId)) return false;
                    seen.add(m.childBranchId);
                    return true;
                });
                return filtered;
            });

            const oldestNewMsg = parsedMessages[parsedMessages.length - 1];
            if (chainRows.length < 20) {
                setHasMore(false);
            } else if (oldestNewMsg && oldestNewMsg.parentBranchId === rootParent) {
                setHasMore(false);
            } else {
                setHasMore(true);
            }

        } catch (error) {
            console.error("[DefaultPage] Failed to load more messages", error);
        } finally {
            setLoading(false);
        }
    }, [loading, hasMore, workspace, tabId, loadedMessages]);

    // Keep the loadMore ref in sync
    useEffect(() => {
        loadMoreRef.current = loadMoreMessages;
    }, [loadMoreMessages]);

    // IntersectionObserver-based pagination — robust, graceful, no scroll-math needed
    useEffect(() => {
        const scrollContainer = scrollAreaRef.current;
        if (!scrollContainer) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry.isIntersecting && hasMoreRef.current && !loadingRef.current) {
                    loadMoreRef.current?.();
                }
            },
            {
                root: scrollContainer,
                // Trigger 300px before the sentinel becomes visible
                rootMargin: "300px 0px 300px 0px",
                threshold: 0,
            }
        );

        // Observe the sentinel once it appears in the DOM
        const sentinel = document.getElementById("scroll-sentinel");
        if (sentinel) {
            observer.observe(sentinel);
        }

        // Use a MutationObserver to catch sentinel mount/remount
        const mutObs = new MutationObserver(() => {
            const el = document.getElementById("scroll-sentinel");
            if (el) {
                observer.observe(el);
            }
        });
        mutObs.observe(scrollContainer, { childList: true, subtree: true });

        return () => {
            observer.disconnect();
            mutObs.disconnect();
        };
    }, [isInitialized]);

    // Message branch & content change handlers
    const handleSiblingChange = useCallback(async (parentBranchId: string, msgIndex: number, newSiblingIndex: number) => {
        if (!workspace || !tabId) return;
        const branchesTable = generateIdFromString(tabId + "/conversation_branches");
        const sql = `INSERT OR REPLACE INTO \`${branchesTable}\` (parent_branch_id, msg_index, selected_branch_index) VALUES (?, ?, ?)`;
        try {
            await pyInvoke('sqlite', {
                db: workspace,
                table: branchesTable,
                command: 'execute',
                sql: sql,
                params: [parentBranchId, msgIndex, newSiblingIndex]
            });
        } catch (error) {
            console.error("Failed to change sibling index", error);
        }
    }, [workspace, tabId]);

    const handleResponseBranchChange = useCallback(async (childBranchId: string, newResponseBranch: number) => {
        if (!workspace || !tabId) return;
        const messagesTable = generateIdFromString(tabId + "/messages");
        const sql = `UPDATE \`${messagesTable}\` SET response_branch = ? WHERE child_branch_id = ?`;
        try {
            await pyInvoke('sqlite', {
                db: workspace,
                table: messagesTable,
                command: 'execute',
                sql: sql,
                params: [newResponseBranch, childBranchId]
            });
        } catch (error) {
            console.error("Failed to change response branch", error);
        }
    }, [workspace, tabId]);

    const handleEditSubmit = useCallback(async (newQuery: string, siblingIndex: number, parentBranchId: string, msgIndex: number) => {
        if (newQuery.trim().length === 0 || !workspace || !tabId) return;

        const messagesTable = generateIdFromString(tabId + "/messages");
        const branchesTable = generateIdFromString(tabId + "/conversation_branches");

        try {
            const countSql = `SELECT COUNT(*) as count FROM \`${messagesTable}\` WHERE parent_branch_id = ?`;
            const countResRaw: any = await pyInvoke('sqlite', {
                db: workspace,
                table: messagesTable,
                command: 'query',
                sql: countSql,
                params: [parentBranchId]
            });
            const countRes = Array.isArray(countResRaw) ? countResRaw : (countResRaw?.data || []);
            const newSiblingIndex = countRes?.[0]?.count ?? 0;

            const newChildBranchId = sha256(parentBranchId + "_" + newSiblingIndex).slice(0, 32);

            const insertSql = `
                INSERT INTO \`${messagesTable}\` (parent_branch_id, child_branch_id, msg_index, query, responses, response_branch, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            await pyInvoke('sqlite', {
                db: workspace,
                table: messagesTable,
                command: 'execute',
                sql: insertSql,
                params: [parentBranchId, newChildBranchId, msgIndex, newQuery, '[]', 0, Date.now()]
            });

            const branchSql = `INSERT OR REPLACE INTO \`${branchesTable}\` (parent_branch_id, msg_index, selected_branch_index) VALUES (?, ?, ?)`;
            await pyInvoke('sqlite', {
                db: workspace,
                table: branchesTable,
                command: 'execute',
                sql: branchSql,
                params: [parentBranchId, msgIndex, newSiblingIndex]
            });

            setPendingMessage({ query: newQuery, childBranchId: newChildBranchId });
            const targetTable = `tb_${parentBranchId}_${msgIndex}`;
            await request(newQuery, targetTable, newChildBranchId, newSiblingIndex, 0);

        } catch (error) {
            console.error("Failed to edit and submit query", error);
        }
    }, [workspace, tabId, request]);

    const handleRegenerate = useCallback(async (query: string, parentBranchId: string, childBranchId: string, siblingIndex: number, responsesLength: number) => {
        if (!workspace || !tabId) return;
        const msg = loadedMessages.find(m => m.childBranchId === childBranchId);
        const msgIndex = msg ? msg.msg_index : 0;
        const targetTable = `tb_${parentBranchId}_${msgIndex}`;
        await request(query, targetTable, childBranchId, siblingIndex, responsesLength);
    }, [workspace, tabId, request, loadedMessages]);

    // Database Change Listeners
    useEffect(() => {
        if (!ready || !workspace || !tabId) return;

        refreshActiveMessages(20);

        const messagesTable = generateIdFromString(tabId + "/messages");
        const branchesTable = generateIdFromString(tabId + "/conversation_branches");

        let tauriUnlistenMessages: (() => void) | undefined;
        let tauriUnlistenBranches: (() => void) | undefined;

        let lastRefresh = 0;
        let pendingRefreshTimer: ReturnType<typeof setTimeout> | null = null;

        const handleDbChange = (eventInfo?: any) => {
            if (!messageStateRef.current.isStreaming) {
                if (pendingRefreshTimer) {
                    clearTimeout(pendingRefreshTimer);
                    pendingRefreshTimer = null;
                }
                refreshActiveMessages();
                return;
            }

            const now = Date.now();
            if (now - lastRefresh >= 100) {
                if (pendingRefreshTimer) {
                    clearTimeout(pendingRefreshTimer);
                    pendingRefreshTimer = null;
                }
                lastRefresh = now;
                refreshActiveMessages();
            } else if (!pendingRefreshTimer) {
                const remaining = 100 - (now - lastRefresh);
                pendingRefreshTimer = setTimeout(() => {
                    pendingRefreshTimer = null;
                    lastRefresh = Date.now();
                    refreshActiveMessages();
                }, remaining);
            }
        };

        const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;
        const msgEvent = `db_changed:${workspace}.${messagesTable}`;
        const branchEvent = `db_changed:${workspace}.${branchesTable}`;

        // Subscribe to database changes in the backend
        pyInvoke('db_subscribe', { db: workspace, table: messagesTable }).catch((err) => console.error("Subscribe messages failed", err));
        pyInvoke('db_subscribe', { db: workspace, table: branchesTable }).catch((err) => console.error("Subscribe branches failed", err));

        const wrapMsgChange = () => handleDbChange({ event: msgEvent });
        const wrapBranchChange = () => handleDbChange({ event: branchEvent });

        if (isTauri) {
            import("@tauri-apps/api/event").then(({ listen }) => {
                listen<{ timestamp: number }>(sanitizeTauriEvent(msgEvent), (e) => handleDbChange({ event: msgEvent, detail: e.payload }))
                    .then((fn) => { tauriUnlistenMessages = fn; })
                    .catch((err) => console.error("Tauri listen failed", err));

                listen<{ timestamp: number }>(sanitizeTauriEvent(branchEvent), (e) => handleDbChange({ event: branchEvent, detail: e.payload }))
                    .then((fn) => { tauriUnlistenBranches = fn; })
                    .catch((err) => console.error("Tauri listen failed", err));
            });
        } else {
            window.addEventListener(msgEvent, wrapMsgChange);
            window.addEventListener(branchEvent, wrapBranchChange);
        }

        return () => {
            if (pendingRefreshTimer) {
                clearTimeout(pendingRefreshTimer);
            }
            // Unsubscribe in the backend
            pyInvoke('db_unsubscribe', { db: workspace, table: messagesTable }).catch((err) => console.error("Unsubscribe messages failed", err));
            pyInvoke('db_unsubscribe', { db: workspace, table: branchesTable }).catch((err) => console.error("Unsubscribe branches failed", err));

            if (isTauri) {
                tauriUnlistenMessages?.();
                tauriUnlistenBranches?.();
            } else {
                window.removeEventListener(msgEvent, wrapMsgChange);
                window.removeEventListener(branchEvent, wrapBranchChange);
            }
        };
    }, [workspace, tabId, ready, refreshActiveMessages]);

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
            const composerEl = document.querySelector(".composer-container");
            const composerHeight = composerEl ? (composerEl as HTMLElement).offsetHeight : 100;
            const extraSpace = composerHeight + 80;
            const finalHeight = messageHeight + (messageState.isStreaming ? 15 : 0);
            const spacer = Math.max(0, height - finalHeight - extraSpace);
            msgBottomRef.current.style.height = `${spacer}px`;
        };
        const handleResize = () => {
            const wasNearBottom = wasNearBottomRef.current;
            updateHeight();
            if (wasNearBottom && scrollAreaRef.current) {
                scrollAreaRef.current.scrollTop = 0;
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
    }, [mounted, height, isInitialized, messageState.isStreaming]);

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
        <div className='w-full h-full flex flex-col items-center absolute bg-card'>
            <div
                ref={containerRef}
                className={clsx(
                    "w-full h-full relative transition-opacity duration-300",
                    ((width === 0 || height === 0) || justOpen) ? 'opacity-0' : 'opacity-100',
                )}
            >
                <ModelSelection
                    model={model}
                    setModel={setModel}
                    layout={layout}
                    selectionMode={selectionMode}
                    agent={selectedAgent}
                    setAgent={setSelectedAgent}
                />
                <div style={{
                    height: width < 800 || height < 650 || isInitialized ? `${height}px` : `${height * 0.2}px`,
                }} className={clsx(
                    "overflow-visible flex flex-col items-center absolute top-1/2 transform -translate-y-1/2",
                    (width < 500 || height < 500) ? 'gap-1' : (width < 800 || height < 650 || isInitialized) ? 'gap-5' : 'gap-1',
                    isInitialized ? "w-full h-full" : "w-full",
                )}>
                    <div
                        ref={scrollAreaRef}
                        onScroll={handleScroll}
                        className={clsx(
                            (width < 800 || height < 650 || isInitialized) ? isInitialized ? 'h-full' : 'flex-1 relative' : '',
                            'w-full overflow-y-auto flex pt-5',
                            isInitialized ? "flex-col-reverse items-start" : "text-center items-center justify-center",
                        )}
                    >
                        {
                            isInitialized ?
                                <div className="relative w-full flex justify-center pb-25">
                                    <div id="messages-container" className={clsx(
                                        "flex flex-col-reverse relative overflow-x-hidden pt-5 w-full px-2",
                                        width < 800 ? 'max-w-full small-content' : 'max-w-[40vw]',
                                    )}>
                                        {/* Empty message container for next turn */}
                                        {(() => {
                                            const rootParent = sha256("0").slice(0, 32);
                                            const lastMsg = loadedMessages[0];
                                            const nextParentId = lastMsg ? (lastMsg.childBranchId + "_" + (lastMsg.siblingIndex ?? 0)) : rootParent;
                                            const nextMsgIndex = lastMsg ? lastMsg.msg_index + 1 : 0;
                                            const targetTable = `tb_${nextParentId}_${nextMsgIndex}`;
                                            return (
                                                <div
                                                    key="empty-container"
                                                    id={AppInfo.tabId + "_empty_message_container"}
                                                    data-branch-id={sha256(nextParentId).slice(0, 32)}
                                                    data-branch-index={0}
                                                    data-tb={targetTable}
                                                    data-last-valid-index={lastMsg ? lastMsg.msg_index : ""}
                                                    className="h-0 w-0 opacity-0 pointer-events-none"
                                                />
                                            );
                                        })()}
                                        <div
                                            ref={msgBottomRef}
                                            className="w-full flex-shrink-0"
                                            style={{ height: "0px" }}
                                            aria-hidden="true"
                                        />

                                        {messageState.errorMsg.length > 0 && (
                                            <div className="bg-red-300 dark:bg-red-900 text-red-500 dark:text-red-300 p-2 rounded-md border border-red-500 mt-2 text-break break-all">
                                                {messageState.errorMsg}
                                            </div>
                                        )}

                                        {pendingMessage && (
                                            <div className="pt-4 w-full flex flex-col gap-2 items-end">
                                                <div className={clsx(
                                                    "rounded-4xl bg-accent/5 border border-[hsl(var(--chat-border))] px-4 select-text relative",
                                                    "py-2 max-h-[148px] overflow-hidden",
                                                    "w-fit 2xl:max-w-[500px] lg:max-w-[350px]"
                                                )}>
                                                    <span key="display">
                                                        <QueryContent query={pendingMessage.query} />
                                                    </span>
                                                </div>
                                                <div className="w-full flex justify-start pl-2 pt-2 pb-2">
                                                    <div className="w-2.5 h-2.5 rounded-full bg-accent animate-scale" />
                                                </div>
                                            </div>
                                        )}

                                        {/* Flat message list */}
                                        {loadedMessages.map((msg) => (
                                            <MessageContainer
                                                key={msg.childBranchId}
                                                request={request}
                                                tabId={AppInfo.tabId}
                                                activeId={messageState.isStreaming ? messageState.activeId : null}
                                                childBranchId={msg.childBranchId}
                                                parentBranchId={msg.parentBranchId}
                                                query={msg.query}
                                                responses={msg.responses}
                                                responseBranch={msg.responseBranch}
                                                siblingIndex={msg.siblingIndex}
                                                totalSiblings={msg.totalSiblings}
                                                index={msg.msg_index}
                                                isStreaming={messageState.isStreaming}
                                                workspace={workspace}
                                                scrollToBottom={() => scrollToBottom('instant')}
                                                onSiblingChange={handleSiblingChange}
                                                onResponseBranchChange={handleResponseBranchChange}
                                                onEditSubmit={handleEditSubmit}
                                                onRegenerate={handleRegenerate}
                                            />
                                        ))}

                                        {/* Sentinel for IntersectionObserver — always rendered for observer stability, visibility controlled by hasMore */}
                                        <div
                                            id="scroll-sentinel"
                                            className="w-full flex-shrink-0"
                                            style={{ height: hasMore ? '40px' : '0px', opacity: 0, pointerEvents: 'none' }}
                                        >
                                            {loading && hasMore && (
                                                <div className="flex justify-center py-2">
                                                    <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                                                </div>
                                            )}
                                        </div>

                                    </div>
                                    <div className="fixed -top-1 w-[99%] h-15 bg-gradient-to-b from-card via-card via-70% to-transparent pointer-events-none" />
                                    <div className="fixed bottom-0 w-[99%] h-20 bg-gradient-to-t from-card via-card via-70% to-transparent pointer-events-none" />
                                </div>
                                :
                                <h1 className={clsx("text-accent mb-4", (width < 500 || height < 500) ? 'text-lg' : (width < 800 || height < 650) ? 'text-3xl' : 'text-3xl absolute bottom-full')}>Hi, How can I help you?</h1>
                        }
                    </div>
                    {isInitialized && showScrollBottom && (
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
                        name={tabId}
                        tabId={tabId}
                        activeId={activeId}
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
                                    activeId: "",
                                }));
                            } else {
                                scrollToBottom('instant');
                                if ((selectionMode === 'model' ? model.id : selectedAgent?.id) && value.trim().length > 0) {
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
                                        setPendingMessage({ query: value, childBranchId: branchId });
                                        await request(value, targetTable, branchId, branchIndex, 0);
                                    }
                                } else {
                                    setMessageState((prev) => ({
                                        ...prev,
                                        errorMsg: selectionMode === 'model' ? "No Model Selected" : "No Agent Selected",
                                        initialized: true,
                                        activeId: '',
                                    }));
                                }
                            }
                        }}
                        width={width}
                        height={height}
                        isStreaming={messageState.isStreaming}
                        model={model}
                        setModel={setModel}
                        agent={selectedAgent}
                        setAgent={setSelectedAgent}
                        selectionMode={selectionMode}
                        isAgentsLoading={isAgentsLoading}
                        style={{ maxWidth: `${width - 10}px` }}
                        ref={composerTextareaRef}
                        className={clsx(
                            "w-[768px] mx-auto z-30 composer-container",
                            isInitialized ? 'absolute' : 'relative',
                            isInitialized
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
                                (width < 800 || height < 650 || isInitialized) && 'hidden pointer-events-none',
                            )}
                        >
                        </div>
                    </>
                </div>
            </div>
        </div>
    );
}