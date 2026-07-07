import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";
import { Plus, Trash2, Edit2, Check, X, ChevronDown, Clock, Repeat, Calendar, Mic, Video, Volume2, FileText, File as FileIcon, FileCode, PowerOff, Terminal } from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";
import { usePython, usePythonEvent } from "./usePython";
import { formatTaskTime, LucideIcons, addTab, TabInfo, TabState, deleteTabWithGroupSelection } from "../utils/state";
import { Spinner } from "./ui/spinner";
import clsx from "clsx";
import { useGlobal } from "./useGlobal";
import { useDatabaseImpl } from "./useDatabase";
import { generateIdFromString, MessageState, useAvailableAgents, useSnapshot } from "../index";
import { Button } from "./ui";
import type { Model } from "../utils/utils";
import { INTERVAL_OPTIONS } from "./composer";
import type { ScheduleInterval } from "./composer";
import { Dropdown } from "./dropdown";
import { renderToStaticMarkup } from "react-dom/server";
import { open } from "@tauri-apps/plugin-dialog";
import Record from "./record";
import type { RecordComponentRef } from "./record";
import { ensureTextAfter, ensureTextBefore, placeCaret, plainToBlocks, blocksToPlain, MIME_MAP } from "./composer";

const CODE_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'xml', 'yaml', 'yml', 'go', 'rs', 'php', 'rb']);
const DOC_EXTS = new Set(['pdf', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']);
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac']);

function getMimeType(ext: string): string {
    return MIME_MAP[ext] ?? 'application/octet-stream';
}

function buildChipHTML_tasks(url: string, name: string, fileType?: string): string {
    const safeName = name.replace(/"/g, '&quot;');
    const isImage = !fileType || fileType.startsWith('image/');
    let previewHTML: string;
    if (isImage) {
        previewHTML = `<img src="${url}" alt="${safeName}" draggable="false" class="h-4 w-4 object-cover rounded-sm border border-black/10 dark:border-white/10 block shrink-0">`;
    } else {
        const ext = name.split('.').pop()?.toLowerCase() ?? '';
        let IconComponent: React.ElementType = FileIcon;
        let strokeColor = '#6b7280';
        if (fileType!.startsWith('video/') || VIDEO_EXTS.has(ext)) { IconComponent = Video; strokeColor = '#a855f7'; }
        else if (fileType!.startsWith('audio/') || AUDIO_EXTS.has(ext)) { IconComponent = Volume2; strokeColor = '#22c55e'; }
        else if (DOC_EXTS.has(ext) || fileType === 'application/pdf' || fileType!.includes('csv')) { IconComponent = FileText; strokeColor = '#f97316'; }
        else if (CODE_EXTS.has(ext)) { IconComponent = FileCode; strokeColor = '#3b82f6'; }
        const iconSVG = renderToStaticMarkup(<IconComponent color={strokeColor} width="14" height="14" />);
        const dataURI = `data:image/svg+xml,${encodeURIComponent(iconSVG)}`;
        previewHTML = `<img src="${dataURI}" alt="${safeName}" draggable="false" class="h-4 w-4 object-contain shrink-0">`;
    }
    const textHTML = `<span class="text-xs font-medium text-black/70 dark:text-white/70 truncate select-none max-w-[120px]">${safeName}</span>`;
    return (
        `<span contenteditable="false" data-img="true" data-url="${url}" data-name="${safeName}" data-source="task" ${fileType ? `data-filetype="${fileType}"` : ''} class="inline-flex align-baseline relative top-0.5 group/chip mx-[2px] items-center gap-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-[5px] p-[2px] pr-1.5 cursor-pointer">` +
        previewHTML + textHTML +
        `<button type="button" class="absolute right-1 top-1/2 transform -translate-y-1/2 h-[14px] w-[14px] rounded-full bg-black/80 dark:bg-white/90 text-white dark:text-black flex items-center justify-center opacity-0 group-hover/chip:opacity-100 transition-opacity z-10 shadow-sm" data-rm-chip="true">` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>` +
        `</button></span>`
    );
}

function buildQueryHTML(query: string): string {
    const blocks = plainToBlocks(query);
    return blocks.map(block => {
        if (block.type === 'text') {
            return (block.value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }
        return buildChipHTML_tasks(block.url!, block.name!, block.fileType);
    }).join('');
}

function serializeMsgNode(root: Node): any[] {
    const blocks: any[] = [];
    const stripZW = (s: string) => s.replace(/\u200B/g, '');
    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const v = stripZW(node.textContent ?? '');
            if (v) blocks.push({ type: 'text', value: v });
        } else if (node instanceof HTMLElement) {
            if (node.dataset.img) {
                const fileType = node.dataset.filetype;
                const isFile = !!fileType && !fileType.startsWith('image/');
                blocks.push(isFile
                    ? { type: 'file', url: node.dataset.url!, name: node.dataset.name!, fileType }
                    : { type: 'image', url: node.dataset.url!, name: node.dataset.name! }
                );
            } else if (node.tagName === 'BR') {
                if (node.previousSibling || node.nextSibling) {
                    blocks.push({ type: 'text', value: '\n' });
                }
            } else if (node.tagName === 'DIV' || node.tagName === 'P') {
                if (blocks.length > 0) blocks.push({ type: 'text', value: '\n' });
                node.childNodes.forEach(walk);
            } else {
                node.childNodes.forEach(walk);
            }
        }
    };
    root.childNodes.forEach(walk);
    return blocks;
}

function QueryContent({ query }: { query: string }) {
    const blocks = plainToBlocks(query);
    return (
        <>
            {blocks.map((block, i) => {
                if (block.type === 'text') {
                    const cleanedText = (block.value || "").replace(/\s+/g, ' ');
                    if (!cleanedText.trim()) return null;
                    return (
                        <span
                            key={i}
                            className="text-xs text-foreground/80 truncate max-w-[300px] md:max-w-[500px] select-none"
                            title={block.value}
                        >
                            {cleanedText.trim()}
                        </span>
                    );
                }
                const name = block.name ?? '';
                const url = block.url ?? '';
                const fileType = block.fileType ?? '';
                const isImage = !fileType || fileType.startsWith('image/');
                let preview: React.ReactNode;
                if (isImage) {
                    preview = <img src={url} alt={name} draggable={false} className="h-4 w-4 object-cover rounded-sm border border-black/10 dark:border-white/10 block shrink-0" />;
                } else {
                    const ext = name.split('.').pop()?.toLowerCase() ?? '';
                    let IconComp: React.ElementType = FileIcon;
                    let strokeColor = '#6b7280';
                    if (fileType.startsWith('video/') || VIDEO_EXTS.has(ext)) { IconComp = Video; strokeColor = '#a855f7'; }
                    else if (fileType.startsWith('audio/') || AUDIO_EXTS.has(ext)) { IconComp = Volume2; strokeColor = '#22c55e'; }
                    else if (DOC_EXTS.has(ext) || fileType === 'application/pdf' || fileType.includes('csv')) { IconComp = FileText; strokeColor = '#f97316'; }
                    else if (CODE_EXTS.has(ext)) { IconComp = FileCode; strokeColor = '#3b82f6'; }
                    preview = <IconComp color={strokeColor} width={14} height={14} />;
                }
                return (
                    <span key={i} data-img="true" data-url={url} data-name={name} data-source="task" className="inline-flex items-center mx-[2px] gap-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-[5px] p-[2px] pr-1.5 max-w-[180px] shrink-0 cursor-pointer">
                        {preview}
                        <span className="text-[11px] font-medium text-black/70 dark:text-white/70 truncate select-none max-w-[120px]">{name}</span>
                    </span>
                );
            })}
        </>
    );
}

const isTargetInDropdownPortal = (target: Node | null): boolean => {
    let curr = target;
    while (curr && curr !== document.body) {
        if (curr instanceof HTMLElement) {
            if (
                curr.hasAttribute('data-radix-menu-content') ||
                curr.hasAttribute('data-radix-popper-content-wrapper') ||
                curr.getAttribute('role') === 'menu' ||
                curr.classList.contains('DropdownMenuContent') ||
                curr.classList.contains('DropdownMenuPortal')
            ) {
                return true;
            }
        }
        curr = curr.parentNode;
    }
    return false;
};


const truncate = (text: string, length = 50) => {
    if (!text) return "";
    if (text.length <= length) return text;
    return text.slice(0, length) + "...";
};

const TabIcon = memo(({ iconVal }: { iconVal: string | undefined }) => {
    if (
        typeof iconVal === "string" &&
        (iconVal.startsWith("/") ||
            iconVal.startsWith("http") ||
            iconVal.startsWith("data:") ||
            /\.(png|jpg|jpeg|ico|svg|webp)$/i.test(iconVal))
    ) {
        return <img src={iconVal} className="w-5 h-5 object-contain rounded-sm" alt="" />;
    }
    const Icon = (LucideIcons as any)[iconVal as string] || LucideIcons.Compass;
    return <Icon className="w-4 h-4" />;
});

const IntervalBadge = memo(({ value }: { value: string | undefined }) => {
    const val = value || "once";
    let label = "Run Once";
    let Icon = Clock;
    let colorClasses = "border-blue-500/20 bg-blue-500/10 text-blue-500 dark:text-blue-400";

    if (val === "infinite") {
        label = "Infinite";
        Icon = Repeat;
        colorClasses = "border-emerald-500/20 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400";
    }
    else if (val === "once") {
        label = "Run Once";
        Icon = Terminal;
        colorClasses = "border-emerald-500/20 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400";
    }
    else if (val === "1h") {
        label = "Hourly";
        Icon = Clock;
        colorClasses = "border-amber-500/20 bg-amber-500/10 text-amber-500 dark:text-amber-400";
    } else if (val === "1d") {
        label = "Daily";
        Icon = Calendar;
        colorClasses = "border-purple-500/20 bg-purple-500/10 text-purple-500 dark:text-purple-400";
    } else if (val === "1w") {
        label = "Weekly";
        Icon = Calendar;
        colorClasses = "border-indigo-500/20 bg-indigo-500/10 text-indigo-500 dark:text-indigo-400";
    } else if (val === "1m") {
        label = "Monthly";
        Icon = Calendar;
        colorClasses = "border-rose-500/20 bg-rose-500/10 text-rose-500 dark:text-rose-400";
    } else {
        label = "Disabled";
        Icon = PowerOff;
        colorClasses = "border-gray-500/20 bg-gray-500/10 text-gray-500 dark:text-gray-400";
    }

    return (
        <span className={clsx(
            "border px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 text-[11px] font-semibold transition-all hover:brightness-110 shadow-sm",
            colorClasses
        )}>
            <Icon className="w-3 h-3 shrink-0" />
            <span>{label}</span>
            <ChevronDown className="w-3 h-3 shrink-0" />
        </span>
    );
});


const TabRow = memo((
    { tab, isSelected, onToggle, onOpen, onDelete, availableModels, onUpdateTab, workspace, stopStreamingTask }: {
        tab: any;
        isSelected: boolean;
        onToggle: (id: string) => void;
        onOpen: (id: string) => void;
        onDelete: (id: string) => void;
        availableModels: Model[];
        onUpdateTab: (id: string, updatedFields: Partial<any>) => void;
        workspace?: string | null;
        stopStreamingTask: (id: string) => Promise<void>;
    }
) => {
    const handleToggle = useCallback(() => onToggle(tab.id), [tab.id, onToggle]);
    const handleOpen = useCallback((e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-img="true"]')) {
            return;
        }
        onOpen(tab.id);
    }, [tab.id, onOpen]);
    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete(tab.id);
    }, [tab.id, onDelete]);

    const tbName = generateIdFromString(tab.id + "/" + "message_state");
    const [messageState] = useDatabaseImpl<MessageState>(tbName, {
        initialValue: {
            title: null,
            activeId: "",
            errorMsg: "",
            initialized: false,
            isStreaming: false,
            dontStop: true,
            context: "",
            isRead: false,
        },
    });

    const [isEditingQuery, setIsEditingQuery] = useState(false);
    const editContainerRef = useRef<HTMLDivElement>(null);
    const queryRef = useRef<HTMLDivElement>(null);
    const savedRange = useRef<Range | null>(null);
    const escaping = useRef(false);
    const recordRef = useRef<RecordComponentRef>(null);

    const [isRecording] = useGlobal(`isRecording-${tab.id}`, { initialValue: false });
    const N_BARS = 60;
    const volumeRef = useRef(0);
    const [volumeHistory, setVolumeHistory] = useState<number[]>(() => Array(N_BARS).fill(0.08));

    useEffect(() => {
        if (!isRecording) {
            setVolumeHistory(Array(N_BARS).fill(0.08));
            volumeRef.current = 0;
            return;
        }

        const interval = setInterval(() => {
            setVolumeHistory(prev => [...prev.slice(1), volumeRef.current]);
        }, 50);

        return () => clearInterval(interval);
    }, [isRecording]);

    const syncState = useCallback(() => {
        const div = queryRef.current;
        if (!div) return;
        const chips = div.querySelectorAll<HTMLElement>('[data-img]');
        chips.forEach(chip => {
            ensureTextBefore(chip);
            ensureTextAfter(chip);
        });
    }, []);

    // MutationObserver to sanitize contentEditable state
    useEffect(() => {
        const div = queryRef.current;
        if (!div) return;
        const observer = new MutationObserver(() => {
            const children = Array.from(div.childNodes);
            let dirty = false;
            for (const node of children) {
                if (node.nodeName === 'BR') {
                    div.removeChild(node); dirty = true; continue;
                }
                if (node.nodeName === 'DIV') {
                    const el = node as HTMLElement;
                    if (el.dataset.img) continue;
                    if (el.innerHTML === '<br>' || el.innerHTML === '' || el.innerHTML === '&nbsp;') {
                        div.removeChild(el);
                    } else {
                        const frag = document.createDocumentFragment();
                        if (el.previousSibling) frag.appendChild(document.createTextNode('\n'));
                        while (el.firstChild) frag.appendChild(el.firstChild);
                        div.replaceChild(frag, el);
                    }
                    dirty = true;
                }
            }
            if (dirty) syncState();
        });
        observer.observe(div, { childList: true });
        return () => observer.disconnect();
    }, [syncState, isEditingQuery]);

    // selectionchange listener for caret escaping around chips
    useEffect(() => {
        const onSelectionChange = () => {
            if (escaping.current) return;
            const div = queryRef.current;
            if (!div || !isEditingQuery) return;
            if (!div.querySelector('[data-img]')) return;
            const sel = window.getSelection();
            if (!sel?.rangeCount || !sel.isCollapsed) return;
            const { focusNode } = sel;
            if (!focusNode || (!div.contains(focusNode) && focusNode !== div)) return;
            const { startContainer, startOffset } = sel.getRangeAt(0);
            let target: Text | null = null;
            let offset = 0;
            let chip: HTMLElement | null = null;
            if (startContainer instanceof HTMLElement && startContainer.dataset.img) {
                chip = startContainer;
            } else if (startContainer.nodeType === Node.TEXT_NODE && startContainer.parentElement?.closest('[data-img="true"]')) {
                chip = startContainer.parentElement.closest('[data-img="true"]') as HTMLElement;
            } else if (startContainer instanceof HTMLElement && startContainer.closest('[data-img="true"]')) {
                chip = startContainer.closest('[data-img="true"]') as HTMLElement;
            }
            if (chip) {
                if (startOffset === 0) { target = ensureTextBefore(chip); offset = target.length; }
                else { target = ensureTextAfter(chip); offset = 0; }
            } else if (startContainer === div) {
                if (startOffset < div.childNodes.length) {
                    const child = div.childNodes[startOffset];
                    if (child instanceof HTMLElement && child.dataset.img) {
                        target = ensureTextBefore(child); offset = target.length;
                    }
                }
                if (!target && startOffset > 0) {
                    const prev = div.childNodes[startOffset - 1];
                    if (prev instanceof HTMLElement && prev.dataset.img) {
                        target = ensureTextAfter(prev); offset = 0;
                    }
                }
            }
            if (target) {
                escaping.current = true;
                placeCaret(target, offset);
                requestAnimationFrame(() => { escaping.current = false; });
            }
        };
        document.addEventListener('selectionchange', onSelectionChange);
        return () => document.removeEventListener('selectionchange', onSelectionChange);
    }, [isEditingQuery]);

    // Populate contentEditable with chip HTML when editing starts
    useEffect(() => {
        if (!isEditingQuery || !queryRef.current) return;
        const el = queryRef.current;
        el.innerHTML = buildQueryHTML(tab.query || '');
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    }, [isEditingQuery, tab.query]);

    // Click outside listener to abort editing
    useEffect(() => {
        if (!isEditingQuery) return;
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (isTargetInDropdownPortal(target)) {
                return; // Do not abort when selecting dropdowns
            }
            if (editContainerRef.current && !editContainerRef.current.contains(target)) {
                recordRef.current?.cancelRecording();
                setIsEditingQuery(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isEditingQuery]);

    const handleSaveQuery = useCallback(() => {
        recordRef.current?.cancelRecording();
        const plainText = queryRef.current ? blocksToPlain(serializeMsgNode(queryRef.current)) : "";
        if (plainText !== tab.query) {
            onUpdateTab(tab.id, { query: plainText });
        }
        setIsEditingQuery(false);
    }, [tab.query, tab.id, onUpdateTab]);

    const handleSaveAgent = useCallback((newAgent: string) => {
        if (newAgent !== tab.agent) {
            onUpdateTab(tab.id, { agent: newAgent });
        }
    }, [tab.agent, tab.id, onUpdateTab]);

    const handleSaveInterval = useCallback((newInterval: ScheduleInterval) => {
        if (newInterval === "disabled") {
            (async () => {
                await stopStreamingTask(tab.id)
            })()
        }
        if (newInterval !== tab.interval) {
            onUpdateTab(tab.id, { interval: newInterval });
        }
    }, [tab.interval, tab.id, onUpdateTab]);

    const insertChipAtCursor = useCallback((url: string, name: string, fileType: string) => {
        const el = queryRef.current;
        if (!el) return;
        el.focus();
        const sel = window.getSelection();
        if (savedRange.current) {
            const anc = savedRange.current.commonAncestorContainer;
            if (el === anc || el.contains(anc)) {
                sel?.removeAllRanges();
                sel?.addRange(savedRange.current);
            }
        }
        if (sel?.rangeCount && !sel.isCollapsed) {
            document.execCommand('delete', false);
        }
        document.execCommand('insertHTML', false, buildChipHTML_tasks(url, name, fileType) + '&nbsp;');
        const chips = el.querySelectorAll('[data-img]');
        if (chips.length > 0) {
            const lastChip = chips[chips.length - 1] as HTMLElement;
            placeCaret(ensureTextAfter(lastChip), 0);
        }
        savedRange.current = null;
        syncState();
    }, [syncState]);

    const handlePlusClick = useCallback(async () => {
        const el = queryRef.current;
        if (!el) return;
        const sel = window.getSelection();
        if (sel?.rangeCount) {
            const r = sel.getRangeAt(0);
            const anc = r.commonAncestorContainer;
            savedRange.current = (el === anc || el.contains(anc)) ? r.cloneRange() : null;
        } else {
            savedRange.current = null;
        }
        const result = await open({ multiple: true });
        if (!result) return;
        const paths = Array.isArray(result) ? result : [result];
        for (const filePath of paths) {
            const name = filePath.split(/[\\/]/).pop() ?? filePath;
            const ext = name.split('.').pop()?.toLowerCase() ?? '';
            insertChipAtCursor(`/file/${filePath}`, name, getMimeType(ext));
        }
    }, [insertChipAtCursor]);

    const handleEditorPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        if (!target.closest('[data-rm-chip="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
        const chip = target.closest('[data-img="true"]');
        if (!chip) return;
        queryRef.current?.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNode(chip);
        sel?.removeAllRanges();
        sel?.addRange(range);
        document.execCommand('delete', false);
    }, []);

    const handleCopy = useCallback((e: React.ClipboardEvent) => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const blocks = serializeMsgNode(sel.getRangeAt(0).cloneContents());
        if (!blocks.length) return;
        e.preventDefault();
        navigator.clipboard.writeText(blocksToPlain(blocks)).catch(() => { });
    }, []);

    const handleCut = useCallback((e: React.ClipboardEvent) => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        handleCopy(e);
        document.execCommand('delete', false);
    }, [handleCopy]);

    const insertBlocks = useCallback((blocks: any[]) => {
        const div = queryRef.current;
        if (!div) return;
        div.focus();
        const sel = window.getSelection();
        if (sel?.rangeCount && !sel.isCollapsed) {
            document.execCommand('delete', false);
        }
        for (const block of blocks) {
            if (block.type === 'text' && block.value) {
                document.execCommand('insertText', false, block.value);
            } else if ((block.type === 'image' || block.type === 'file') && block.url) {
                document.execCommand('insertHTML', false, buildChipHTML_tasks(block.url, block.name ?? '', block.fileType));
                const chips = div.querySelectorAll('[data-img]');
                if (chips.length > 0) {
                    const lastChip = chips[chips.length - 1] as HTMLElement;
                    placeCaret(ensureTextAfter(lastChip), 0);
                }
            }
        }
        syncState();
    }, [syncState]);

    const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
        e.preventDefault();
        if (e.clipboardData?.files?.length) {
            Array.from(e.clipboardData.files).forEach(file => {
                insertChipAtCursor(URL.createObjectURL(file), file.name, file.type);
            });
            return;
        }
        let plain = '';
        try {
            plain = await navigator.clipboard.readText();
        } catch {
            plain = e.clipboardData?.getData('text/plain') ?? '';
        }
        if (!plain) return;
        const blocks = plainToBlocks(plain);
        if (blocks.some(b => b.type !== 'text')) {
            insertBlocks(blocks);
        } else {
            document.execCommand('insertText', false, plain);
        }
    }, [insertBlocks, insertChipAtCursor]);

    const handleEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter') {
            if (!e.shiftKey) {
                e.preventDefault();
                handleSaveQuery();
                return;
            }
            e.preventDefault();
            {
                const div = queryRef.current!;
                const sel2 = window.getSelection();
                if (!sel2?.rangeCount) { syncState(); return; }
                const range2 = sel2.getRangeAt(0);
                if (!range2.collapsed) range2.deleteContents();
                const endRange = document.createRange();
                endRange.selectNodeContents(div);
                endRange.collapse(false);
                let atEnd = range2.compareBoundaryPoints(Range.END_TO_END, endRange) === 0;
                if (!atEnd) {
                    const r = range2.cloneRange();
                    r.setEnd(endRange.endContainer, endRange.endOffset);
                    atEnd = r.toString().replace(/\u200B/g, '').length === 0;
                }
                const nlNode = document.createTextNode(atEnd ? '\n\u200B' : '\n');
                range2.insertNode(nlNode);
                placeCaret(nlNode, 1);
            }
            syncState();
            return;
        }
        if (e.key === 'Escape') {
            recordRef.current?.cancelRecording();
            setIsEditingQuery(false);
            return;
        }
        const sel = window.getSelection();
        if (!sel?.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!range.collapsed) {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault();
                document.execCommand('delete', false);
                syncState();
            }
            return;
        }
        const { startContainer, startOffset } = range;
        if (e.key === 'Backspace') {
            if (startContainer.nodeType === Node.TEXT_NODE) {
                if (startOffset === 0 || (e.ctrlKey && (startContainer.textContent?.slice(0, startOffset) ?? '').trim() === '')) {
                    const prev = startContainer.previousSibling;
                    if (prev instanceof HTMLElement && prev.dataset.img) {
                        e.preventDefault();
                        const dr = document.createRange();
                        dr.setStartBefore(prev);
                        dr.setEnd(startContainer, startOffset);
                        sel.removeAllRanges(); sel.addRange(dr);
                        document.execCommand('delete', false);
                        syncState(); return;
                    }
                }
            }
            if (startContainer === queryRef.current && startOffset > 0) {
                const prev = queryRef.current.childNodes[startOffset - 1];
                if (prev instanceof HTMLElement && prev.dataset.img) {
                    e.preventDefault();
                    const dr = document.createRange();
                    dr.selectNode(prev);
                    sel.removeAllRanges(); sel.addRange(dr);
                    document.execCommand('delete', false);
                    syncState(); return;
                }
            }
        }
        if (e.key === 'ArrowRight') {
            if (startContainer.nodeType === Node.TEXT_NODE && startOffset === (startContainer as Text).length) {
                const next = startContainer.nextSibling;
                if (next instanceof HTMLElement && next.dataset.img) {
                    e.preventDefault();
                    const afterText = ensureTextAfter(next);
                    e.shiftKey
                        ? sel.setBaseAndExtent(range.startContainer, range.startOffset, afterText, 0)
                        : placeCaret(afterText, 0);
                    return;
                }
            }
            const editor = queryRef.current;
            if (editor && startContainer === editor && startOffset < editor.childNodes.length) {
                const next = editor.childNodes[startOffset];
                if (next instanceof HTMLElement && next.dataset.img) {
                    e.preventDefault();
                    const afterText = ensureTextAfter(next);
                    e.shiftKey
                        ? sel.setBaseAndExtent(range.startContainer, range.startOffset, afterText, 0)
                        : placeCaret(afterText, 0);
                    return;
                }
            }
        }
        if (e.key === 'ArrowLeft') {
            if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
                const prev = startContainer.previousSibling;
                if (prev instanceof HTMLElement && prev.dataset.img) {
                    e.preventDefault();
                    const beforeText = ensureTextBefore(prev);
                    e.shiftKey
                        ? sel.setBaseAndExtent(range.endContainer, range.endOffset, beforeText, beforeText.length)
                        : placeCaret(beforeText, beforeText.length);
                    return;
                }
            }
            const editor = queryRef.current;
            if (editor && startContainer === editor && startOffset > 0) {
                const prev = editor.childNodes[startOffset - 1];
                if (prev instanceof HTMLElement && prev.dataset.img) {
                    e.preventDefault();
                    const beforeText = ensureTextBefore(prev);
                    e.shiftKey
                        ? sel.setBaseAndExtent(range.endContainer, range.endOffset, beforeText, beforeText.length)
                        : placeCaret(beforeText, beforeText.length);
                    return;
                }
            }
        }
    }, [syncState, handleSaveQuery]);

    const modelDropdownContent = useMemo(() => {
        return availableModels.map(m => ({
            content: <span className="text-xs">{m.name}</span>,
            text: m.name ?? undefined,
            shortcut: null,
            children: null,
            separator: false,
            trigger: () => {
                handleSaveAgent(m.id ?? "")
                window.dispatchEvent(new CustomEvent('agent-update'));
            },
        }));
    }, [availableModels, handleSaveAgent]);

    return (
        <TableRow className="border-accent/5 hover:bg-accent/5 transition-colors cursor-pointer h-12 group">
            <TableCell className="w-10 cursor-default" onClick={e => e.stopPropagation()}>
                <Checkbox checked={isSelected} onCheckedChange={handleToggle} />
            </TableCell>
            <TableCell onClick={handleOpen} className="w-8 text-xs text-muted-foreground">
                <TabIcon iconVal={tab.icon} />
            </TableCell>
            <TableCell onClick={handleOpen} className="w-8 text-xs text-muted-foreground">
                {messageState.isStreaming
                    ? <Spinner />
                    :
                    <div className={clsx(
                        "w-1 h-1",
                        messageState.isRead ? "bg-transparent" : "bg-accent animate-scale",
                        "rounded-full",
                    )}/>
                }
            </TableCell>
            {/* Query Cell */}
            {isEditingQuery ? (
                <TableCell
                    colSpan={4}
                    onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('[data-img="true"]') && !target.closest('[data-rm-chip="true"]')) {
                            return;
                        }
                        e.stopPropagation();
                    }}
                    className="py-2.5 align-top"
                >
                    <div ref={editContainerRef} className="flex flex-col gap-2 w-full">
                        <div className="relative w-full">
                            <div
                                ref={queryRef}
                                contentEditable
                                suppressContentEditableWarning
                                onKeyDown={handleEditorKeyDown}
                                onPointerDown={handleEditorPointerDown}
                                onCopy={handleCopy}
                                onCut={handleCut}
                                onPaste={handlePaste}
                                className={clsx(
                                    "w-full bg-accent/5 border border-accent/20 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring transition-all font-sans max-h-[300px] outline-none whitespace-pre-wrap break-words",
                                    isRecording
                                        ? "overflow-hidden cursor-not-allowed opacity-0 select-none pointer-events-none"
                                        : "min-h-[64px] overflow-y-auto"
                                )}
                                style={{
                                    minHeight: isRecording ? "30px" : undefined,
                                    maxHeight: isRecording ? "30px" : undefined,
                                }}
                            />
                            {isRecording && (
                                <div className="absolute inset-0 flex items-center gap-3 px-3 pointer-events-none select-none bg-accent/5 border border-accent/20 rounded-lg">
                                    {/* Recording label */}
                                    <div className="flex items-center gap-2 text-red-500 shrink-0">
                                        <span className="relative flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-[50%] rounded-full bg-red-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                        </span>
                                        <span className="text-xs font-semibold tracking-wider">Recording...</span>
                                    </div>
                                    {/* Full-width scrolling train waveform */}
                                    <svg
                                        className="flex-1 h-5 min-w-0"
                                        preserveAspectRatio="none"
                                        viewBox={`0 0 ${volumeHistory.length} 1`}
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        {volumeHistory.map((vol, i) => {
                                            const h = Math.max(0.12, vol * 0.88)
                                            const y = (1 - h) / 2
                                            const opacity = 0.2 + (i / (volumeHistory.length - 1)) * 0.8
                                            return (
                                                <rect
                                                    key={i}
                                                    x={i + 0.2}
                                                    y={y}
                                                    width={0.6}
                                                    height={h}
                                                    rx={0.3}
                                                    fill="#ef4444"
                                                    fillOpacity={opacity}
                                                />
                                            )
                                        })}
                                    </svg>
                                </div>
                            )}
                        </div>
                        <div className="flex justify-between items-center gap-3 mt-1">
                            {/* Inner Model, Interval & Attachment Selectors */}
                            <div className="flex items-center gap-2">
                                {/* Agent Selector */}
                                <Dropdown
                                    placeholder={"Agent"}
                                    content={modelDropdownContent}
                                    align="start"
                                    className="max-w-none min-w-44"
                                >
                                    <button className="flex items-center gap-1 hover:bg-accent/5 px-2 py-1 rounded text-[11px] truncate font-medium border border-accent/10 hover:border-accent/25 transition-all text-left bg-background/50 bg-accent/5">
                                        <span className="truncate max-w-[120px]">{availableModels.find(m => m.id === tab.agent)?.name || "Select Agent"}</span>
                                        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                                    </button>
                                </Dropdown>

                                {/* Interval Selector */}
                                <Dropdown
                                    content={INTERVAL_OPTIONS.map(opt => ({
                                        content: (
                                            <div className="flex items-center gap-1.5 text-xs py-0.5">
                                                <span className="capitalize">{opt.value}</span>{opt.value !== "disabled" && <span className="text-gray-500 dark:text-gray-400">- {opt.label}</span>}
                                            </div>
                                        ),
                                        trigger: () => handleSaveInterval(opt.value)
                                    }))}
                                    align="start"
                                    className="max-w-none min-w-44"
                                >
                                    <button className="cursor-pointer">
                                        <IntervalBadge value={tab.interval} />
                                    </button>
                                </Dropdown>

                                {/* File Attachment (Plus) */}
                                <button
                                    type="button"
                                    onClick={handlePlusClick}
                                    className="h-7 w-7 flex items-center justify-center rounded-md opacity-60 hover:opacity-100 hover:bg-accent/10 border border-accent/10 hover:border-accent/25 transition-all"
                                    title="Attach file"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>

                                {/* Audio Recorder (Mic) */}
                                <Record
                                    ref={recordRef}
                                    name={tab.id}
                                    workspace={workspace ?? "global"}
                                    onFileSaved={(filePath) => {
                                        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
                                        const fileName = filePath.split(/[\\/]+/).pop() ?? filePath;
                                        insertChipAtCursor(`/file/${filePath}`, fileName, getMimeType(ext));
                                    }}
                                >
                                    {({ isRecording, startRecording, stopRecording, cancelRecording, volume }) => {
                                        volumeRef.current = volume;
                                        return (
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={isRecording ? stopRecording : startRecording}
                                                    className={clsx(
                                                        "h-7 w-7 flex items-center justify-center rounded-md border transition-all",
                                                        isRecording
                                                            ? "text-red-500 opacity-100 bg-red-500/10 border-red-500/20 animate-pulse"
                                                            : "opacity-60 hover:opacity-100 hover:bg-accent/10 border-accent/10 hover:border-accent/25"
                                                    )}
                                                    title={isRecording ? "Stop recording" : "Record audio"}
                                                >
                                                    <Mic className="w-4 h-4" />
                                                </button>
                                                {isRecording && (
                                                    <button
                                                        type="button"
                                                        onClick={cancelRecording}
                                                        className="h-7 w-7 flex items-center justify-center rounded-md border text-muted-foreground opacity-60 hover:opacity-100 hover:bg-accent/10 border-accent/10 hover:border-accent/25 transition-all"
                                                        title="Cancel recording"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    }}
                                </Record>
                            </div>

                            {/* Help Text / Actions */}
                            <div className="flex items-center gap-2 text-[11px]">
                                <span className="text-[10px] opacity-60 hidden sm:inline">Press Enter to save, Shift+Enter for newline</span>
                                <button
                                    onClick={() => {
                                        recordRef.current?.cancelRecording();
                                        setIsEditingQuery(false);
                                    }}
                                    className="px-2 py-1 rounded hover:bg-accent/10 hover:text-foreground transition-all cursor-pointer font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveQuery}
                                    className="px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-semibold shadow-sm cursor-pointer"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                </TableCell>
            ) : (
                <>
                    {/* Normal Query Cell */}
                    <TableCell className="w-full font-medium group/query cursor-pointer h-14 py-1" onClick={handleOpen}>
                        <div className="flex items-center gap-1.5 justify-between w-full">
                            <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden whitespace-nowrap py-1 max-w-[150px] sm:max-w-[250px] md:max-w-[350px] lg:max-w-[450px] xl:max-w-[350px]" title={tab.query}>
                                {tab.query ? <QueryContent query={tab.query} /> : "-"}
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsEditingQuery(true);
                                }}
                                className="opacity-0 group-hover/query:opacity-100 hover:text-primary transition-opacity p-1 shrink-0"
                            >
                                <Edit2 className="w-3 h-3 text-muted-foreground" />
                            </button>
                        </div>
                    </TableCell>

                    {/* Agent Cell */}
                    <TableCell align="right" onClick={e => e.stopPropagation()} className="h-12">
                        <Dropdown
                            placeholder={"Agent"}
                            content={modelDropdownContent}
                            align="start"
                            className="max-w-none min-w-44"
                        >
                            <button className="flex items-center gap-1 hover:bg-accent/5 px-2 py-1 rounded text-xs truncate max-w-full font-medium border border-accent/10 hover:border-accent/25 transition-all text-left">
                                <span className="truncate flex-1">{availableModels.find(m => m.id === tab.agent)?.name || "Select Agent"}</span>
                                <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                            </button>
                        </Dropdown>
                    </TableCell>

                    {/* Interval Cell */}
                    <TableCell onClick={e => e.stopPropagation()} className="w-[130px] block py-4 h-12">
                        <Dropdown
                            content={INTERVAL_OPTIONS.map(opt => ({
                                content: (
                                    <div className="flex items-center gap-1.5 text-xs py-0.5">
                                        <span className="capitalize">{opt.value}</span>{opt.value !== "disabled" && <span className="text-gray-500 dark:text-gray-400">- {opt.label}</span>}
                                    </div>
                                ),
                                trigger: () => handleSaveInterval(opt.value)
                            }))}
                            align="start"
                            className="max-w-none min-w-44"
                        >
                            <button className="cursor-pointer mx-auto">
                                <IntervalBadge value={tab.interval} />
                            </button>
                        </Dropdown>
                    </TableCell>

                    {/* Timestamp & Actions Cell */}
                    <TableCell onClick={handleOpen} className="w-[70px] h-12 text-[11px] text-muted-foreground whitespace-nowrap pr-4">
                        <div className="flex justify-end items-center gap-2 h-full">
                            <span className="opacity-60">{formatTaskTime(tab.timestamp)}</span>
                            <Trash2
                                className="w-4 h-4 hover:text-destructive cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={handleDelete}
                            />
                        </div>
                    </TableCell>
                </>
            )}
        </TableRow>
    );
});

export default function Tasks({
    workspace, isOpen, setOpen, query, openInTab
}: {
    workspace?: string | null;
    isOpen: boolean;
    setOpen: (open: boolean) => void;
    query: string;
    openInTab?: boolean;
}) {
    const { SetActive } = useSnapshot(TabInfo);
    const [, setChatId] = useGlobal<string | null>('chatId', { initialValue: null })
    const { pyInvoke } = usePython();
    const { agents, isLoading } = useAvailableAgents()



    const handleUpdateTab = useCallback(async (id: string, updatedFields: Partial<any>) => {
        try {
            const db = workspace ?? "global";
            const tab = tabsRef.current.find(t => t.id === id);
            if (!tab) return;
            const newMetadata = {
                icon: tab.icon || 'AlarmClockCheck',
                query: tab.query,
                interval: tab.interval,
                agent: tab.agent,
                timestamp: tab.timestamp || Date.now(),
                ...updatedFields
            };
            await pyInvoke("sqlite", {
                db,
                command: "execute",
                sql: "UPDATE tasks SET metadata = ? WHERE id = ?",
                params: [JSON.stringify(newMetadata), id]
            });
            setTabs(prev => prev.map(t => t.id === id ? { ...t, ...newMetadata } : t));
        } catch (e) {
            console.error("Failed to update task", id, e);
        }
    }, [workspace, pyInvoke]);

    const [tabs, setTabs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    // Refs  live values readable from async callbacks without stale closures
    const pageRef = useRef(0);
    const hasMoreRef = useRef(true);
    const loadingRef = useRef(false);
    const tabsRef = useRef<any[]>([]);
    const queryRef = useRef(query);
    const sentinelRef = useRef<HTMLDivElement>(null);
    // Prevents the IntersectionObserver from firing before the first page is loaded
    const initializedRef = useRef(false);
    // Keep refs in sync with latest render values
    tabsRef.current = tabs;
    queryRef.current = query;
    const setLoadingBoth = (val: boolean) => {
        loadingRef.current = val;
        setLoading(val);
    };
    //  Core fetch (no stale-closure risk; reads from refs) 
    const loadTabs = useCallback(async (pageNum: number, reset: boolean) => {
        if (loadingRef.current) return;
        setLoadingBoth(true);
        // Lock the observer out during a reset so it can't race the initial fetch
        if (reset) initializedRef.current = false;
        try {
            const db = workspace ?? "global";
            const limit = 50;
            const offset = pageNum * limit;
            const q = queryRef.current;
            const searchClause = q ? "WHERE metadata LIKE ?" : "";
            const res = await pyInvoke("sqlite", {
                db,
                command: "query",
                sql: `SELECT id, metadata FROM tasks ${searchClause} ORDER BY rowid DESC LIMIT ${limit} OFFSET ${offset}`,
                params: q ? [`%${q}%`] : []
            });
            console.warn(res);
            const rows: any[] = res?.data ?? (Array.isArray(res) ? res : []);
            if (!Array.isArray(rows)) return;
            hasMoreRef.current = rows.length === limit;
            const parsed = rows.map((row: any) => {
                try { return { id: row.id, ...JSON.parse(row.metadata) }; }
                catch { return { id: row.id, title: "Unknown" }; }
            });
            setTabs(prev => reset ? parsed : [...prev, ...parsed]);
            // Unlock the observer only after the first page has settled
            if (reset) initializedRef.current = true;
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingBoth(false);
        }
    }, [workspace, pyInvoke]);
    //  Debounced reset on query / open change 
    useEffect(() => {
        if (!isOpen) return;
        const timer = setTimeout(() => {
            pageRef.current = 0;
            hasMoreRef.current = true;
            loadTabs(0, true);
        }, 300);
        return () => clearTimeout(timer);
    }, [isOpen, query, loadTabs]);
    //  IntersectionObserver sentinel  fires the instant the bottom div enters view
    // Far more reliable than scroll events: works inside any overflow container,
    // no stale closures, no throttle hacks needed.
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !loadingRef.current && hasMoreRef.current && initializedRef.current) {
                    pageRef.current += 1;
                    loadTabs(pageRef.current, false);
                }
            },
            { threshold: 0 }
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [loadTabs]);
    //  Selection helpers 
    const toggleSelect = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }, []);
    const toggleSelectAll = useCallback(() => {
        setSelectedIds(prev =>
            prev.size === tabsRef.current.length && tabsRef.current.length > 0
                ? new Set()
                : new Set(tabsRef.current.map((t: any) => t.id))
        );
    }, []);
    const handleStopStreamingTask = useCallback(async (id: string) => {
        const db = workspace ?? "global";
        const initTb = generateIdFromString(id + "/" + "message_state");
        const res = await pyInvoke("sqlite", {
            db: db,
            table: initTb,
            command: "query",
            sql: `SELECT id, _v FROM ${initTb} WHERE id IN ('isStreaming', 'activeId')`
        });
        const rows = res?.data ?? (Array.isArray(res) ? res : []);
        if (Array.isArray(rows)) {
            let isStreaming = false;
            let activeId = "";
            rows.forEach((row: any) => {
                let val = row._v;
                if (typeof val === 'string') {
                    try {
                        val = JSON.parse(val);
                    } catch { }
                }
                if (row.id === 'isStreaming') {
                    isStreaming = !!val;
                } else if (row.id === 'activeId') {
                    activeId = String(val || "");
                }
            });
            if (isStreaming && activeId) {
                await pyInvoke("v1/chat/stop", { id: activeId });
            }
        }
    }, [workspace, pyInvoke])

    //  Delete 
    const handleDelete = useCallback(async (id?: string) => {
        const ids = id ? [id] : Array.from(selectedIds);
        if (ids.length === 0) return;
        try {
            const db = workspace ?? "global";
            const placeholders = ids.map(() => "?").join(",");
            for (const i of ids) {
                try {
                    await deleteTabWithGroupSelection(i);
                    await handleStopStreamingTask(i);
                } catch (e) {
                    console.error("Failed to check/stop task", i, e);
                }
            }

            await pyInvoke("sqlite", {
                db,
                command: "execute",
                sql: `DELETE FROM tasks WHERE id IN (${placeholders})`,
                params: ids
            });
            setSelectedIds(prev => {
                const next = new Set(prev);
                ids.forEach(i => next.delete(i));
                return next;
            });
            pageRef.current = 0;
            hasMoreRef.current = true;
            loadTabs(0, true);
            setChatId(null)
        } catch (e) {
            console.error(e);
        }
    }, [selectedIds, workspace, pyInvoke, loadTabs, setChatId]);
    //  Open selected / open single 
    const openTab = (id: string) => {
        const tab = tabsRef.current.find((t: any) => t.id === id);
        if (tab) {
            if (openInTab) {
                addTab({
                    uuid: id,
                    title: id,
                    iconOverride: tab.icon || "AlarmClockCheck",
                    layout: "single",
                    childrenProps: {
                        [id]: {
                            icon: tab.icon || "AlarmClockCheck",
                            title: id,
                            appname: "default",
                            data: { dontStop: true }
                        }
                    }
                });
                SetActive(id);
            } else {
                setChatId(tab.id)
            }
        }
    };
    const handleOpenId = useCallback((id: string) => {
        openTab(id);
        setOpen(false);
    }, [setOpen]);
    const handleDeleteRow = useCallback((id: string) => handleDelete(id), [handleDelete]);
    const handleDeleteSelected = useCallback(() => handleDelete(), [handleDelete]);

    const handleDisableSelected = useCallback(async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        try {
            const db = workspace ?? "global";
            for (const id of ids) {
                try {
                    await handleStopStreamingTask(id);
                    const tab = tabsRef.current.find(t => t.id === id);
                    if (!tab) continue;
                    const newMetadata = {
                        icon: tab.icon || 'AlarmClockCheck',
                        query: tab.query,
                        agent: tab.agent,
                        timestamp: tab.timestamp || Date.now(),
                        interval: "disabled"
                    };
                    await pyInvoke("sqlite", {
                        db,
                        command: "execute",
                        sql: "UPDATE tasks SET metadata = ? WHERE id = ?",
                        params: [JSON.stringify(newMetadata), id]
                    });
                } catch (e) {
                    console.error("Failed to disable task", id, e);
                }
            }
            setTabs(prev => prev.map(t => ids.includes(t.id) ? { ...t, interval: "disabled" } : t));
            setSelectedIds(new Set());
        } catch (e) {
            console.error("Failed to disable selected tasks", e);
        }
    }, [selectedIds, workspace, pyInvoke, handleStopStreamingTask]);

    usePythonEvent('task_disabled', async ({ workspace, task_id }: any) => {
        handleUpdateTab(task_id, {
            interval: "disabled"
        });
    })


    //  Render 
    const allSelected = tabs.length > 0 && selectedIds.size === tabs.length;
    const isEmpty = tabs.length === 0;
    const [, setIsEditing] = useGlobal('overlay-editing', { initialValue: false });
    const [, setIsCreateTask] = useGlobal('overlay-create-task', { initialValue: false });
    const [, setShowTaskDialog] = useGlobal('showTaskDialog', { initialValue: false })
    const [, setShowMcpDialog] = useGlobal('showMcpDialog', { initialValue: false })
    const [, setShowCredentialsDialog] = useGlobal('showCredentialsDialog', { initialValue: false })
    const [, setShowLocalModelDialog] = useGlobal('showLocalModelDialog', { initialValue: false })
    const [, setShowCustomEndpointDialog] = useGlobal('showCustomEndpointDialog', { initialValue: false })

    return (
        <>
            <div className="flex justify-center items-center w-[97.5%] mx-auto px-2">
                <div className="w-6">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                </div>
                <div className="flex-1" />
                <Button variant="secondary" className="flex items-center justify-center" size="sm" onClick={() => {
                    setIsCreateTask(true);
                    setIsEditing(false);
                    setShowTaskDialog(false);
                    setShowMcpDialog(false);
                    setShowCredentialsDialog(false);
                    setShowCustomEndpointDialog(false);
                    setShowLocalModelDialog(false);
                }}>
                    New Task <Plus className="w-6 h-6" />
                </Button>
            </div>
            <ScrollArea
                className="flex-1 -mx-6 w-[97.5%] mx-auto border-t border-b border-[hsl(var(--chat-border))]"
            >
                <Table>
                    <TableBody>
                        {isEmpty ? (
                            <TableRow>
                                <TableCell colSpan={4} className="h-12 text-center text-muted-foreground text-xs">
                                    <div className="flex items-center justify-center gap-2">
                                        {loading
                                            ? <><Spinner /><span>Searching...</span></>
                                            : <>No results</>}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            tabs.map(tab => (
                                <TabRow
                                    key={tab.id}
                                    tab={tab}
                                    isSelected={selectedIds.has(tab.id)}
                                    onToggle={toggleSelect}
                                    onOpen={handleOpenId}
                                    onDelete={handleDeleteRow}
                                    availableModels={agents}
                                    onUpdateTab={handleUpdateTab}
                                    stopStreamingTask={handleStopStreamingTask}
                                    workspace={workspace}
                                />
                            ))
                        )}
                    </TableBody>
                </Table>
                {/* Sentinel: IntersectionObserver watches this  triggers next-page load */}
                <div ref={sentinelRef} className="h-px" />
                {/* Bottom loading indicator for subsequent pages */}
                {loading && tabs.length > 0 && (
                    <div className="flex justify-center items-center gap-2 py-3 text-xs text-muted-foreground">
                        <Spinner />
                        <span>Loading more...</span>
                    </div>
                )}
            </ScrollArea>
            <div className={clsx(
                selectedIds.size > 0 ? "flex justify-center items-center " : "hidden",
                "relative transform translate-y-[-6px] px-4"
            )}>
                <span>{selectedIds.size} Selected</span>
                <div className="flex-1 flex justify-end gap-2">
                    <button onClick={handleDisableSelected} className="p-2 border border-[hsl(var(--chat-border))] rounded-full w-20">Disable</button>
                    <button onClick={handleDeleteSelected} className="p-2 border border-[hsl(var(--chat-border))] rounded-full w-20">Delete</button>
                </div>
            </div>
        </>
    );
}