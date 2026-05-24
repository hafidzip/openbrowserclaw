import { useRef, useState, useEffect, useCallback } from "react";
import type React from "react";
import { renderToStaticMarkup } from 'react-dom/server';
import type { UseDatabaseReturn } from "./useDatabase/useDatabase";
import { sha256 } from "js-sha256";
import { Check, ChevronLeft, ChevronRight, Copy, Info, Pencil, RefreshCcw, FileCode, Video, Volume2, FileText, File as FileIcon, Plus, Mic, ChevronsDownUp, ChevronUp } from "lucide-react";
import clsx from "clsx";
import { Button } from "./ui/button";
import Message from "./message";
import { TooltipProvider } from "@radix-ui/react-tooltip"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "./ui/tooltip"
import { open } from '@tauri-apps/plugin-dialog'
import Record from './record'
import { ensureTextAfter, ensureTextBefore, placeCaret, plainToBlocks, type ContentBlock } from "./composer";

const _MIME_MAP: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml',
    mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    mov: 'video/quicktime', webm: 'video/webm',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
    pdf: 'application/pdf', csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    js: 'text/javascript', jsx: 'text/javascript', ts: 'text/typescript',
    tsx: 'text/typescript', py: 'text/x-python', java: 'text/x-java',
    c: 'text/x-c', cpp: 'text/x-c++', css: 'text/css',
    html: 'text/html', json: 'application/json', xml: 'text/xml',
    go: 'text/x-go', rs: 'text/x-rust', php: 'text/x-php', rb: 'text/x-ruby',
    txt: 'text/plain', md: 'text/markdown',
}

const _CODE_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'css', 'html', 'json', 'xml', 'go', 'rs', 'php', 'rb'])

const _DOC_EXTS = new Set(['pdf', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])

const _VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm'])

const _AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac'])

function _getMimeType(ext: string) { return _MIME_MAP[ext] ?? 'application/octet-stream' }
interface QueryBlock {
    type: 'text' | 'image' | 'file'
    value?: string
    url?: string
    name?: string
    fileType?: string
}

const _FILE_REF_RE = /\[file:([^\]]+)\]/g

function parseQueryBlocks(text: string): QueryBlock[] {
    const blocks: QueryBlock[] = []
    let last = 0
    _FILE_REF_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = _FILE_REF_RE.exec(text)) !== null) {
        if (match.index > last)
            blocks.push({ type: 'text', value: text.slice(last, match.index) })
        const filepath = match[1]
        const name = filepath.split(/[\\/]/).pop() ?? filepath
        const ext = name.split('.').pop()?.toLowerCase() ?? ''
        const fileType = _getMimeType(ext)
        const url = `/file/${filepath}`
        blocks.push(fileType.startsWith('image/')
            ? { type: 'image', url, name, fileType }
            : { type: 'file', url, name, fileType }
        )
        last = match.index + match[0].length
    }
    if (last < text.length)
        blocks.push({ type: 'text', value: text.slice(last) })
    return blocks
}

function blocksToPlain(blocks: QueryBlock[]): string {
    return blocks.map(b => {
        if (b.type === 'text') return b.value ?? ''
        const filepath = (b.url ?? '').replace('/file/', '')
        return `[file:${filepath}]`
    }).join('')
}

function serializeMsgNode(root: Node): QueryBlock[] {
    const blocks: QueryBlock[] = []
    const stripZW = (s: string) => s.replace(/\u200B/g, '')
    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const v = stripZW(node.textContent ?? '')
            if (v) blocks.push({ type: 'text', value: v })
        } else if (node instanceof HTMLElement) {
            if (node.dataset.img) {
                const fileType = node.dataset.filetype
                const isFile = !!fileType && !fileType.startsWith('image/')
                blocks.push(isFile
                    ? { type: 'file', url: node.dataset.url!, name: node.dataset.name!, fileType }
                    : { type: 'image', url: node.dataset.url!, name: node.dataset.name! }
                )
            } else if (node.tagName === 'BR') {
                if (node.previousSibling || node.nextSibling) {
                    blocks.push({ type: 'text', value: '\n' })
                }
            } else if (node.tagName === 'DIV' || node.tagName === 'P') {
                if (blocks.length > 0) blocks.push({ type: 'text', value: '\n' })
                node.childNodes.forEach(walk)
            } else {
                node.childNodes.forEach(walk)
            }
        }
    }
    root.childNodes.forEach(walk)
    return blocks
}

function buildChipHTML_msg(url: string, name: string, fileType?: string): string {
    const safeName = name.replace(/"/g, '&quot;')
    const isImage = !fileType || fileType.startsWith('image/')
    let previewHTML: string
    if (isImage) {
        previewHTML = `<img src="${url}" alt="${safeName}" draggable="false" class="h-4 w-4 object-cover rounded-sm border border-black/10 dark:border-white/10 block shrink-0">`
    } else {
        const ext = name.split('.').pop()?.toLowerCase() ?? ''
        let IconComponent: React.ElementType = FileIcon
        let strokeColor = '#6b7280'
        if (fileType!.startsWith('video/') || _VIDEO_EXTS.has(ext)) { IconComponent = Video; strokeColor = '#a855f7' }
        else if (fileType!.startsWith('audio/') || _AUDIO_EXTS.has(ext)) { IconComponent = Volume2; strokeColor = '#22c55e' }
        else if (_DOC_EXTS.has(ext) || fileType === 'application/pdf' || fileType!.includes('csv')) { IconComponent = FileText; strokeColor = '#f97316' }
        else if (_CODE_EXTS.has(ext)) { IconComponent = FileCode; strokeColor = '#3b82f6' }
        const iconSVG = renderToStaticMarkup(<IconComponent color={strokeColor} width="14" height="14" />)
        const dataURI = `data:image/svg+xml,${encodeURIComponent(iconSVG)}`
        previewHTML = `<img src="${dataURI}" alt="${safeName}" draggable="false" class="h-4 w-4 object-contain shrink-0">`
    }
    const textHTML = `<span class="text-xs font-medium text-black/70 dark:text-white/70 truncate select-none hidden md:block max-w-[120px]">${safeName}</span>`
    return (
        `<span contenteditable="false" data-img="true" data-url="${url}" data-name="${safeName}" ${fileType ? `data-filetype="${fileType}"` : ''} class="inline-flex align-baseline relative top-0.5 group/chip mx-[2px] items-center gap-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-[5px] p-[2px] pr-1.5">` +
        previewHTML + textHTML +
        `<button type="button" class="absolute right-1 top-1/2 transform -translate-y-1/2 h-[14px] w-[14px] rounded-full bg-black/80 dark:bg-white/90 text-white dark:text-black flex items-center justify-center opacity-0 group-hover/chip:opacity-100 transition-opacity z-10 shadow-sm" data-rm-chip="true">` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>` +
        `</button></span>`
    )
}

function buildQueryHTML(query: string): string {
    const blocks = parseQueryBlocks(query)
    return blocks.map(block => {
        if (block.type === 'text') {
            return (block.value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
        }
        return buildChipHTML_msg(block.url!, block.name!, block.fileType)
    }).join('')
}

function QueryContent({ query }: { query: string }) {
    const blocks = parseQueryBlocks(query)
    return (
        <>
            {blocks.map((block, i) => {
                if (block.type === 'text') return <span key={i}>{block.value}</span>
                const name = block.name ?? ''
                const url = block.url ?? ''
                const fileType = block.fileType ?? ''
                const isImage = !fileType || fileType.startsWith('image/')
                let preview: React.ReactNode
                if (isImage) {
                    preview = <img src={url} alt={name} draggable={false} className="h-4 w-4 object-cover rounded-sm border border-black/10 dark:border-white/10 block shrink-0" />
                } else {
                    const ext = name.split('.').pop()?.toLowerCase() ?? ''
                    let IconComp: React.ElementType = FileIcon
                    let strokeColor = '#6b7280'
                    if (fileType.startsWith('video/') || _VIDEO_EXTS.has(ext)) { IconComp = Video; strokeColor = '#a855f7' }
                    else if (fileType.startsWith('audio/') || _AUDIO_EXTS.has(ext)) { IconComp = Volume2; strokeColor = '#22c55e' }
                    else if (_DOC_EXTS.has(ext) || fileType === 'application/pdf' || fileType.includes('csv')) { IconComp = FileText; strokeColor = '#f97316' }
                    else if (_CODE_EXTS.has(ext)) { IconComp = FileCode; strokeColor = '#3b82f6' }
                    preview = <IconComp color={strokeColor} width={14} height={14} />
                }
                return (
                    <span key={i} className="inline-flex align-baseline relative top-0.5 mx-[2px] items-center gap-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-[5px] p-[2px] pr-1.5">
                        {preview}
                        <span className="text-xs font-medium text-black/70 dark:text-white/70 truncate select-none max-w-[120px] hidden md:block">{name}</span>
                    </span>
                )
            })}
        </>
    )
}
interface CostTrack {
    type: "input" | "output";
    description: string;
    cost: number;
}
interface ModelOutput {
    isStreaming: boolean;
    content: string;
    token_per_second?: number | null;
    costs?: CostTrack[];
    model?: string;
    date?: number;
}

function getResponseContent(response: ModelOutput | string | undefined | null): string {
    if (!response) return "";
    if (typeof response === "string") return response;
    if (typeof response === "object" && "content" in response) return response.content ?? "";
    return "";
}

function getIsStreaming(response: ModelOutput | string | undefined | null): boolean {
    if (!response) return false;
    if (typeof response === "string") return false;
    if (typeof response === "object" && "isStreaming" in response) return response.isStreaming ?? false;
    return false;
}

export default function MessageContainer({ request, tabId, activeId, branch, index, useDatabase, isStreaming, workspace }: {
    request: (payload: any, tb: string, branchId: string, index: number | string, response_branch: number) => Promise<any>,
    tabId: string, activeId: string | null, branch: string, index: number,
    useDatabase: <T>(
        tb: string,
        options?: { initialValue?: T }
    ) => UseDatabaseReturn<T>,
    isStreaming: boolean,
    workspace: string,
}) {
    const tb = "msg_" + branch + "_" + index;
    const [message, setMessage] = useDatabase<{
        branch: number, content: Record<string, {
            query: string,
            responses: (ModelOutput | string)[],
            response_branch: number
        }>
    }>(
        tb,
        {
            initialValue: {
                branch: 0,
                content: {}
            }
        });
    const b = sha256(message.branch > 0 ? message.branch.toString() + branch : branch).slice(0, 32)
    const [isCopied, setIsCopied] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const queryRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const escaping = useRef(false);
    const savedRange = useRef<Range | null>(null)

    const syncState = useCallback(() => {
        const div = queryRef.current
        if (!div) return
        const chips = div.querySelectorAll<HTMLElement>('[data-img]')
        chips.forEach(chip => {
            ensureTextBefore(chip)
            ensureTextAfter(chip)
        })
    }, [])

    // Hook to observe container changes and identify if scroll height clips container dimensions
    useEffect(() => {
        const checkOverflow = () => {
            if (containerRef.current) {
                const { scrollHeight, clientHeight } = containerRef.current;
                setIsOverflowing(scrollHeight > clientHeight || isExpanded);
            }
        };

        checkOverflow();

        if (!containerRef.current) return;
        const observer = new ResizeObserver(checkOverflow);
        observer.observe(containerRef.current);

        return () => observer.disconnect();
    }, [message.content, b, isExpanded, isEditing]);

    useEffect(() => {
        const div = queryRef.current
        if (!div) return
        const observer = new MutationObserver(() => {
            const children = Array.from(div.childNodes)
            let dirty = false
            for (const node of children) {
                if (node.nodeName === 'BR') {
                    div.removeChild(node); dirty = true; continue
                }
                if (node.nodeName === 'DIV') {
                    const el = node as HTMLElement
                    if (el.dataset.img) continue
                    if (el.innerHTML === '<br>' || el.innerHTML === '' || el.innerHTML === '&nbsp;') {
                        div.removeChild(el)
                    } else {
                        const frag = document.createDocumentFragment()
                        if (el.previousSibling) frag.appendChild(document.createTextNode('\n'))
                        while (el.firstChild) frag.appendChild(el.firstChild)
                        div.replaceChild(frag, el)
                    }
                    dirty = true
                }
            }
            if (dirty) syncState()
        })
        observer.observe(div, { childList: true })
        return () => observer.disconnect()
    }, [syncState, isEditing])
    useEffect(() => {
        const onSelectionChange = () => {
            if (escaping.current) return
            const div = queryRef.current
            if (!div || !isEditing) return
            if (!div.querySelector('[data-img]')) return
            const sel = window.getSelection()
            if (!sel?.rangeCount || !sel.isCollapsed) return
            const { focusNode } = sel
            if (!focusNode || (!div.contains(focusNode) && focusNode !== div)) return
            const { startContainer, startOffset } = sel.getRangeAt(0)
            let target: Text | null = null
            let offset = 0
            let chip: HTMLElement | null = null
            if (startContainer instanceof HTMLElement && startContainer.dataset.img) {
                chip = startContainer
            } else if (startContainer.nodeType === Node.TEXT_NODE && startContainer.parentElement?.closest('[data-img="true"]')) {
                chip = startContainer.parentElement.closest('[data-img="true"]') as HTMLElement
            } else if (startContainer instanceof HTMLElement && startContainer.closest('[data-img="true"]')) {
                chip = startContainer.closest('[data-img="true"]') as HTMLElement
            }
            if (chip) {
                if (startOffset === 0) { target = ensureTextBefore(chip); offset = target.length }
                else { target = ensureTextAfter(chip); offset = 0 }
            } else if (startContainer === div) {
                if (startOffset < div.childNodes.length) {
                    const child = div.childNodes[startOffset]
                    if (child instanceof HTMLElement && child.dataset.img) {
                        target = ensureTextBefore(child); offset = target.length
                    }
                }
                if (!target && startOffset > 0) {
                    const prev = div.childNodes[startOffset - 1]
                    if (prev instanceof HTMLElement && prev.dataset.img) {
                        target = ensureTextAfter(prev); offset = 0
                    }
                }
            }
            if (target) {
                escaping.current = true
                placeCaret(target, offset)
                requestAnimationFrame(() => { escaping.current = false })
            }
        }
        document.addEventListener('selectionchange', onSelectionChange)
        return () => document.removeEventListener('selectionchange', onSelectionChange)
    }, [isEditing])
    const insertChipAtCursor = useCallback((url: string, name: string, fileType: string) => {
        const el = queryRef.current
        if (!el) return
        el.focus()
        const sel = window.getSelection()
        // Restore saved range if available and still inside the editor
        if (savedRange.current) {
            const anc = savedRange.current.commonAncestorContainer
            if (el === anc || el.contains(anc)) {
                sel?.removeAllRanges()
                sel?.addRange(savedRange.current)
            }
        }
        if (sel?.rangeCount && !sel.isCollapsed) {
            document.execCommand('delete', false)
        }
        document.execCommand('insertHTML', false, buildChipHTML_msg(url, name, fileType) + '&nbsp;')
        // Move caret after the inserted chip
        const chips = el.querySelectorAll('[data-img]')
        if (chips.length > 0) {
            const lastChip = chips[chips.length - 1] as HTMLElement
            placeCaret(ensureTextAfter(lastChip), 0)
        }
        savedRange.current = null
        syncState()
    }, [syncState])
    const handlePlusClick = useCallback(async () => {
        const el = queryRef.current
        if (!el) return
        // Save current caret position before dialog steals focus
        const sel = window.getSelection()
        if (sel?.rangeCount) {
            const r = sel.getRangeAt(0)
            const anc = r.commonAncestorContainer
            savedRange.current = (el === anc || el.contains(anc)) ? r.cloneRange() : null
        } else {
            savedRange.current = null
        }
        const result = await open({ multiple: true })
        if (!result) return
        const paths = Array.isArray(result) ? result : [result]
        for (const filePath of paths) {
            const name = filePath.split(/[\\/]/).pop() ?? filePath
            const ext = name.split('.').pop()?.toLowerCase() ?? ''
            insertChipAtCursor(`/file/${filePath}`, name, _getMimeType(ext))
        }
    }, [insertChipAtCursor])
    //  Chip removal via pointer 
    const handleEditorPointerDown = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
        const target = e.target as HTMLElement
        if (!target.closest('[data-rm-chip="true"]')) return
        e.preventDefault()
        e.stopPropagation()
        const chip = target.closest('[data-img="true"]')
        if (!chip) return
        queryRef.current?.focus()
        const sel = window.getSelection()
        const range = document.createRange()
        range.selectNode(chip)
        sel?.removeAllRanges()
        sel?.addRange(range)
        document.execCommand('delete', false)
    }, [])
    //  Copy 
    const handleCopy = useCallback((e: React.ClipboardEvent) => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || !sel.rangeCount) return
        const blocks = serializeMsgNode(sel.getRangeAt(0).cloneContents())
        if (!blocks.length) return
        e.preventDefault()
        navigator.clipboard.writeText(blocksToPlain(blocks)).catch(() => { })
    }, [])
    //  Cut 
    const handleCut = useCallback((e: React.ClipboardEvent) => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || !sel.rangeCount) return
        handleCopy(e)
        document.execCommand('delete', false)
    }, [handleCopy])
    const insertBlocks = useCallback((blocks: ContentBlock[]) => {
        const div = queryRef.current
        if (!div) return
        div.focus()
        const sel = window.getSelection()
        if (sel?.rangeCount && !sel.isCollapsed) {
            document.execCommand('delete', false)
        }
        for (const block of blocks) {
            if (block.type === 'text' && block.value) {
                document.execCommand('insertText', false, block.value)
            } else if ((block.type === 'image' || block.type === 'file') && block.url) {
                document.execCommand('insertHTML', false, buildChipHTML_msg(block.url, block.name ?? '', block.fileType))
                const chips = div.querySelectorAll('[data-img]')
                if (chips.length > 0) {
                    const lastChip = chips[chips.length - 1] as HTMLElement
                    placeCaret(ensureTextAfter(lastChip), 0)
                }
            }
        }
        syncState()
    }, [syncState])
    //  Paste 
    const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
        e.preventDefault()
        if (e.clipboardData?.files?.length) {
            Array.from(e.clipboardData.files).forEach(file => {
                insertChipAtCursor(URL.createObjectURL(file), file.name, file.type)
            })
            return
        }
        let plain = ''
        try {
            plain = await navigator.clipboard.readText()
        } catch {
            plain = e.clipboardData?.getData('text/plain') ?? ''
        }
        if (!plain) return
        const blocks = plainToBlocks(plain)
        if (blocks.some(b => b.type !== 'text')) {
            insertBlocks(blocks)
        } else {
            document.execCommand('insertText', false, plain)
        }
    }, [insertBlocks, insertChipAtCursor])
    const handleEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter') {
            if (!e.shiftKey) {
                e.preventDefault()
                handleSubmit()
                return
            }
            e.preventDefault()
            {
                const div = queryRef.current!
                const sel2 = window.getSelection()
                if (!sel2?.rangeCount) { syncState(); return }
                const range2 = sel2.getRangeAt(0)
                if (!range2.collapsed) range2.deleteContents()
                const endRange = document.createRange()
                endRange.selectNodeContents(div)
                endRange.collapse(false)
                let atEnd = range2.compareBoundaryPoints(Range.END_TO_END, endRange) === 0
                if (!atEnd) {
                    const r = range2.cloneRange()
                    r.setEnd(endRange.endContainer, endRange.endOffset)
                    atEnd = r.toString().replace(/\u200B/g, '').length === 0
                }
                const nlNode = document.createTextNode(atEnd ? '\n\u200B' : '\n')
                range2.insertNode(nlNode)
                placeCaret(nlNode, 1)
            }
            syncState()
            return
        }
        const sel = window.getSelection()
        if (!sel?.rangeCount) return
        const range = sel.getRangeAt(0)
        if (!range.collapsed) {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault()
                document.execCommand('delete', false)
                syncState()
            }
            return
        }
        const { startContainer, startOffset } = range
        if (e.key === 'Backspace') {
            if (startContainer.nodeType === Node.TEXT_NODE) {
                if (startOffset === 0 || (e.ctrlKey && (startContainer.textContent?.slice(0, startOffset) ?? '').trim() === '')) {
                    const prev = startContainer.previousSibling
                    if (prev instanceof HTMLElement && prev.dataset.img) {
                        e.preventDefault()
                        const dr = document.createRange()
                        dr.setStartBefore(prev)
                        dr.setEnd(startContainer, startOffset)
                        sel.removeAllRanges(); sel.addRange(dr)
                        document.execCommand('delete', false)
                        syncState(); return
                    }
                }
            }
            if (startContainer === queryRef.current && startOffset > 0) {
                const prev = queryRef.current.childNodes[startOffset - 1]
                if (prev instanceof HTMLElement && prev.dataset.img) {
                    e.preventDefault()
                    const dr = document.createRange()
                    dr.selectNode(prev)
                    sel.removeAllRanges(); sel.addRange(dr)
                    document.execCommand('delete', false)
                    syncState(); return
                }
            }
        }
        if (e.key === 'ArrowRight') {
            if (startContainer.nodeType === Node.TEXT_NODE && startOffset === (startContainer as Text).length) {
                const next = startContainer.nextSibling
                if (next instanceof HTMLElement && next.dataset.img) {
                    e.preventDefault()
                    const afterText = ensureTextAfter(next)
                    e.shiftKey
                        ? sel.setBaseAndExtent(range.startContainer, range.startOffset, afterText, 0)
                        : placeCaret(afterText, 0)
                    return
                }
            }
            const editor = queryRef.current
            if (editor && startContainer === editor && startOffset < editor.childNodes.length) {
                const next = editor.childNodes[startOffset]
                if (next instanceof HTMLElement && next.dataset.img) {
                    e.preventDefault()
                    const afterText = ensureTextAfter(next)
                    e.shiftKey
                        ? sel.setBaseAndExtent(range.startContainer, range.startOffset, afterText, 0)
                        : placeCaret(afterText, 0)
                    return
                }
            }
        }
        if (e.key === 'ArrowLeft') {
            if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
                const prev = startContainer.previousSibling
                if (prev instanceof HTMLElement && prev.dataset.img) {
                    e.preventDefault()
                    const beforeText = ensureTextBefore(prev)
                    e.shiftKey
                        ? sel.setBaseAndExtent(range.endContainer, range.endOffset, beforeText, beforeText.length)
                        : placeCaret(beforeText, beforeText.length)
                    return
                }
            }
            const editor = queryRef.current
            if (editor && startContainer === editor && startOffset > 0) {
                const prev = editor.childNodes[startOffset - 1]
                if (prev instanceof HTMLElement && prev.dataset.img) {
                    e.preventDefault()
                    const beforeText = ensureTextBefore(prev)
                    e.shiftKey
                        ? sel.setBaseAndExtent(range.endContainer, range.endOffset, beforeText, beforeText.length)
                        : placeCaret(beforeText, beforeText.length)
                    return
                }
            }
        }
    }, [syncState, handleSubmit])
    //  Submit 
    async function handleSubmit() {
        setIsEditing(false);
        const query = queryRef.current ? blocksToPlain(serializeMsgNode(queryRef.current)) : "";
        const newBranch = sha256((message.branch + 1).toString() + branch).slice(0, 32);
        await request(query, tb, newBranch, message.branch + 1, 0);
        const sel = window.getSelection();
        sel?.removeAllRanges();
    }
    // Populate contentEditable with chip HTML when editing starts
    useEffect(() => {
        if (!isEditing || !queryRef.current) return
        const el = queryRef.current
        el.innerHTML = buildQueryHTML(message.content[b]?.query ?? '')
        el.focus()
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditing])
    useEffect(() => {
        if (!isEditing) return;
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsEditing(false);
                const sel = window.getSelection();
                sel?.removeAllRanges();
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isEditing]);
    //  Editing toolbar (shared between both render paths) 
    const EditingToolbar = (
        <div className="absolute bottom-3 left-0 right-0 px-3 flex items-center justify-between">
            {/* Left: file picker + record */}
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={handlePlusClick}
                    className="h-7 w-7 flex items-center justify-center rounded-full opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 transition-all"
                    title="Attach file"
                >
                    <Plus className="w-4 h-4" />
                </button>
                <Record
                    workspace={workspace}
                    onFileSaved={(filePath) => {
                        const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
                        const fileName = filePath.split(/[\\/]+/).pop() ?? filePath
                        insertChipAtCursor(`/file/${filePath}`, fileName, _getMimeType(ext))
                    }}
                >
                    {({ isRecording, startRecording, stopRecording }: { isRecording: boolean; startRecording: () => void; stopRecording: () => void }) => (
                        <button
                            type="button"
                            onClick={isRecording ? stopRecording : startRecording}
                            className={clsx(
                                "h-7 w-7 flex items-center justify-center rounded-full transition-all",
                                isRecording
                                    ? "text-red-500 opacity-100 bg-red-500/10"
                                    : "opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"
                            )}
                            title={isRecording ? "Stop recording" : "Record audio"}
                        >
                            <Mic className="w-4 h-4" />
                        </button>
                    )}
                </Record>
            </div>
            {/* Right: Cancel + Send */}
            <div className="flex items-center gap-2">
                <Button
                    onClick={() => {
                        const sel = window.getSelection();
                        sel?.removeAllRanges();
                        setIsEditing(false);
                    }}
                    className="rounded-3xl border border-[hsl(var(--chat-border))] dark:border-transparent"
                    variant="secondary"
                >
                    Cancel
                </Button>
                <Button onClick={handleSubmit} className="rounded-3xl">Send</Button>
            </div>
        </div>
    )
    //  Shared editing container classes 
    const editingContainerCls = clsx(
        isEditing
            ? "w-full rounded-lg min-h-[80px] bg-[hsl(var(--float))] pb-14 pt-4 shadow-lg border border-[hsl(var(--chat-border))] dark:border-transparent"
            : "py-2 rounded-xl ml-auto bg-accent/5 max-w-[70%] overflow-hidden",
        "px-4  relative",
        isEditing ? "" : isExpanded ? "pb-5" : "max-h-50",
    )
    return (
        <>
            {/* <div>
            {JSON.stringify(message)}
        </div> */}
            {(message.content?.[b]?.query &&
                ((message.content?.[b]?.response_branch ?? 0) === 0) &&
                (getResponseContent(message.content?.[b]?.responses?.[message.content?.[b]?.response_branch]) === "<div></div>" || getResponseContent(message.content?.[b]?.responses?.[message.content?.[b]?.response_branch]).length === 0)) ?
                <div id={"container_" + index} className="pt-4">
                    <div className="w-full">
                        <div
                            style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}
                            className="flex flex-col gap-2 group">
                            <div ref={containerRef} className={editingContainerCls}>
                                <span>
                                    <QueryContent key="display" query={message.content[b].query} />
                                </span>
                                {!isEditing && isOverflowing && (
                                    <div
                                        onClick={(e) => {
                                            e.preventDefault()
                                            setIsExpanded(!isExpanded)
                                        }}
                                        className={clsx(
                                            "w-full h-5 bottom-0 absolute left-0 cursor-pointer flex items-center justify-center",
                                            isExpanded ? "bg-accent/5 border-t border-accent/5" : "bg-gradient-to-b from-transparent to-neutral-800"
                                        )}
                                    >
                                        {isExpanded && <ChevronUp size={12} />}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    {
                        isStreaming
                        && activeId === tabId + "_response_" + b + "_" + (message.content?.[b]?.response_branch ?? 0) + "_" + message.branch
                        && (
                            <div className="w-4 h-4 rounded-full bg-card flex items-center justify-center">
                                <div className="w-2 h-2 rounded-full bg-accent relative animate-scale" />
                            </div>
                        )
                    }
                    <>
                        <div id={tabId + "_empty_message_container"} data-branch-id={b} data-branch-index={message.branch} data-last-valid-index={index - 1} data-tb={tb} />
                    </>
                </div> :
                message.content?.[b]?.query &&
                    getResponseContent(message.content?.[b]?.responses?.[message.content?.[b]?.response_branch]) ? <>
                    <div id={"container_" + index} className="pt-4">
                        <div className="w-full">
                            <div
                                style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}
                                className="flex flex-col gap-2 group">
                                <div ref={containerRef} className={editingContainerCls}>
                                    {(isEditing && !isStreaming) ? (
                                        <div
                                            key="editing"
                                            ref={queryRef}
                                            className="w-full min-h-[80px]"
                                            spellCheck={false}
                                            contentEditable
                                            suppressContentEditableWarning
                                            onPointerDown={handleEditorPointerDown}
                                            onCopy={handleCopy}
                                            onCut={handleCut}
                                            onPaste={handlePaste}
                                            onKeyDown={handleEditorKeyDown}
                                        />
                                    ) : (
                                        <span key="display">
                                            <QueryContent query={message.content[b].query} />
                                        </span>
                                    )}
                                    {isEditing && EditingToolbar}
                                    {!isEditing && isOverflowing && (
                                        <div
                                            onClick={(e) => {
                                                e.preventDefault()
                                                setIsExpanded(!isExpanded)
                                            }}
                                            className={clsx(
                                                "w-full h-5 bottom-0 absolute left-0 cursor-pointer flex items-center justify-center",
                                                isExpanded ? "bg-accent/5 border-t border-accent/5" : "bg-gradient-to-b from-transparent to-neutral-800"
                                            )}
                                        >
                                            {isExpanded && <ChevronUp size={12} />}
                                        </div>
                                    )}
                                </div>
                                <div className="ml-auto flex gap-2 items-center pr-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                    {!isEditing && !isStreaming &&
                                        <>
                                            {!isCopied ? <Copy className="w-4 h-4 transform translate-y-[2px] cursor-pointer" onClick={() => {
                                                navigator.clipboard.writeText(message.content[b].query);
                                                setIsCopied(true);
                                                setTimeout(() => { setIsCopied(false); }, 500);
                                            }} /> : <Check className="w-4 h-4 transform translate-y-[2px]" />}
                                            <Pencil className="w-4 h-4 transform translate-y-[2px] cursor-pointer" onClick={() => { setIsEditing(true); }} />
                                            {Object.keys(message.content).length > 1 && <>
                                                <ChevronLeft className={clsx(
                                                    message.branch === 0 ? "opacity-50" : "opacity-100 cursor-pointer",
                                                    "w-4 h-4 transform translate-y-[2px]"
                                                )} onClick={() => {
                                                    setMessage(prev => ({ ...prev, branch: Math.max(0, prev.branch - 1) }))
                                                }} />
                                                <span>{message.branch + 1} / {Object.keys(message.content).length}</span>
                                                <ChevronRight className={clsx(
                                                    message.branch === Object.keys(message.content).length - 1 ? "opacity-50" : "opacity-100 cursor-pointer",
                                                    "w-4 h-4 transform translate-y-[2px]"
                                                )} onClick={() => {
                                                    setMessage(prev => ({ ...prev, branch: Math.min(Object.keys(prev.content).length - 1, prev.branch + 1) }))
                                                }} />
                                            </>}
                                        </>
                                    }
                                </div>
                            </div>
                        </div>
                        <div className="group relative">
                            <Message
                                response={getResponseContent(message.content[b].responses[message.content[b].response_branch])}
                                id={tabId + "_response_" + b + "_" + message.content[b].response_branch + "_" + index}
                                activeId={activeId}
                            />
                            {!getIsStreaming(message.content[b].responses[message.content[b].response_branch]) && (
                                <div className="flex items-center gap-2 py-3">
                                    {!isEditing &&
                                        <>
                                            {Object.keys(message.content[b].responses).length > 1 && <>
                                                <ChevronLeft className={clsx(
                                                    message.content[b].response_branch === 0 ? "opacity-50" : "opacity-100 cursor-pointer",
                                                    "w-4 h-4 transform translate-y-[2px]"
                                                )} onClick={() => {
                                                    setMessage(prev => ({
                                                        ...prev,
                                                        content: {
                                                            ...prev.content,
                                                            [b]: { ...prev.content[b], response_branch: Math.max(0, prev.content[b].response_branch - 1) }
                                                        }
                                                    }))
                                                }} />
                                                <span>{message.content[b].response_branch + 1} / {Object.keys(message.content[b].responses).length}</span>
                                                <ChevronRight className={clsx(
                                                    message.content[b].response_branch === Object.keys(message.content[b].responses).length - 1 ? "opacity-50" : "opacity-100 cursor-pointer",
                                                    "w-4 h-4 transform translate-y-[2px]"
                                                )} onClick={() => {
                                                    setMessage(prev => ({
                                                        ...prev,
                                                        content: {
                                                            ...prev.content,
                                                            [b]: { ...prev.content[b], response_branch: Math.min(Object.keys(prev.content[b].responses).length - 1, prev.content[b].response_branch + 1) }
                                                        }
                                                    }))
                                                }} />
                                            </>}
                                            {!isCopied ? <Copy className="w-4 h-4 transform translate-y-[2px] cursor-pointer" onClick={() => {
                                                navigator.clipboard.writeText(getResponseContent(message.content[b].responses[message.content[b].response_branch]));
                                                setIsCopied(true);
                                                setTimeout(() => { setIsCopied(false); }, 500);
                                            }} /> : <Check className="w-4 h-4 transform translate-y-[2px]" />}
                                            <RefreshCcw
                                                className="w-4 h-4 transform translate-y-[2px] cursor-pointer"
                                                onClick={async () => {
                                                    const rb = message.content[b].responses.length;
                                                    await request(message.content[b].query, tb, b, message.branch, rb);
                                                }}
                                            />
                                            <TooltipProvider>
                                                <Tooltip disableHoverableContent={true}>
                                                    <TooltipTrigger>
                                                        <Info className="w-4 h-4 transform translate-y-[3px]" />
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        {(() => {
                                                            const currentResponse = message.content[b].responses[message.content[b].response_branch];
                                                            const isModelOutput = typeof currentResponse === "object" && currentResponse !== null && "content" in currentResponse;
                                                            if (!isModelOutput) return null;
                                                            const mo = currentResponse as ModelOutput;
                                                            const hasMetadata = mo.model || mo.token_per_second || (mo.costs && mo.costs.length > 0);
                                                            if (!hasMetadata) return null;
                                                            const totalCost = mo.costs?.reduce((sum, c) => sum + c.cost, 0) ?? 0;
                                                            return (
                                                                <div className="flex items-center gap-3">
                                                                    {mo.model && <span className="font-mono">{mo.model} - </span>}
                                                                    {mo.token_per_second != null && <span>{mo.token_per_second} tokens / s</span>}
                                                                    {totalCost > 0 && <span>${totalCost.toFixed(6)}</span>}
                                                                </div>
                                                            );
                                                        })()}
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </>
                                    }
                                </div>
                            )}
                        </div>
                    </div>
                    {
                        isStreaming
                        && activeId === tabId + "_response_" + b + "_" + (message.content?.[b]?.response_branch ?? 0) + "_" + message.branch
                        && (
                            <div className="w-4 h-4 rounded-full bg-card flex items-center justify-center">
                                <div className="w-2 h-2 rounded-full bg-accent relative animate-scale" />
                            </div>
                        )
                    }
                    <MessageContainer request={request} tabId={tabId} activeId={activeId} useDatabase={useDatabase} index={index + 1} branch={b} isStreaming={isStreaming} workspace={workspace} />
                </>
                    :
                    <>
                        <div id={tabId + "_empty_message_container"} data-branch-id={b} data-branch-index={message.branch} data-last-valid-index={index - 1} data-tb={tb} />
                        {
                            isStreaming
                            && activeId === tabId + "_response_" + b + "_" + (message.content?.[b]?.response_branch ?? 0) + "_" + message.branch
                            && (
                                <div className="w-4 h-4 rounded-full bg-card flex items-center justify-center">
                                    <div className="w-2 h-2 rounded-full bg-accent relative animate-scale" />
                                </div>
                            )
                        }
                    </>
            }
        </>
    )
}