import { ArrowUp, Plus, Mic, Square, FileCode, Video, Volume2, FileText, File as FileIcon } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react'
import clsx from 'clsx'
import Record from './record'
import { open } from '@tauri-apps/plugin-dialog'


export interface ContentBlock {
  type: 'text' | 'image' | 'file'
  value?: string
  url?: string
  name?: string
  fileType?: string
}

export const MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  pdf: 'application/pdf', csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  js: 'text/javascript', jsx: 'text/javascript', ts: 'text/typescript',
  tsx: 'text/typescript', py: 'text/x-python', java: 'text/x-java',
  c: 'text/x-c', cpp: 'text/x-c++', h: 'text/x-c', css: 'text/css',
  html: 'text/html', json: 'application/json', xml: 'text/xml',
  yaml: 'text/yaml', yml: 'text/yaml', go: 'text/x-go', rs: 'text/x-rust',
  php: 'text/x-php', rb: 'text/x-ruby', txt: 'text/plain', md: 'text/markdown',
}

const CODE_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'xml', 'yaml', 'yml', 'go', 'rs', 'php', 'rb'])

const DOC_EXTS = new Set(['pdf', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])

const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm'])

const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac'])

function getMimeType(ext: string): string {
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

export const FILE_REF_RE = /\[file:([^\]]+)\]/g

export function blocksToPlain(blocks: ContentBlock[]): string {
  return blocks.map(b => {
    if (b.type === 'text') return b.value ?? ''
    const filepath = (b.url ?? '').replace('/file/', '')
    return `[file:${filepath}]`
  }).join('')
}

export function plainToBlocks(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  let last = 0
  FILE_REF_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FILE_REF_RE.exec(text)) !== null) {
    if (match.index > last)
      blocks.push({ type: 'text', value: text.slice(last, match.index) })
    const filepath = match[1]
    const name = filepath.split(/[\\/]/).pop() ?? filepath
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const fileType = getMimeType(ext)
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

const ZW_RE = /\u200B/g

const stripZW = (s: string) => s.replace(ZW_RE, '')

export function ensureTextAfter(chip: HTMLElement): Text {
  const n = chip.nextSibling
  if (n?.nodeType === Node.TEXT_NODE) return n as Text
  const t = document.createTextNode('')
  chip.after(t)
  return t
}

export function ensureTextBefore(chip: HTMLElement): Text {
  const n = chip.previousSibling
  if (n?.nodeType === Node.TEXT_NODE) return n as Text
  const t = document.createTextNode('')
  chip.before(t)
  return t
}

export function placeCaret(node: Text, offset: number) {
  const sel = window.getSelection()
  const r = document.createRange()
  r.setStart(node, Math.min(offset, node.length))
  r.collapse(true)
  sel?.removeAllRanges()
  sel?.addRange(r)
}

function serializeNode(root: Node): ContentBlock[] {
  const blocks: ContentBlock[] = []
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
        // Only treat as newline if it's not a browser-ghost br (i.e. has siblings)
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

function buildChipHTML(url: string, name: string, fileType?: string): string {
  const safeName = name.replace(/"/g, '&quot;')
  const isImage = !fileType || fileType.startsWith('image/')
  let previewHTML: string
  if (isImage) {
    previewHTML = `<img src="${url}" alt="${safeName}" draggable="false" class="h-4 w-4 object-cover rounded-sm border border-black/10 dark:border-white/10 block shrink-0">`
  } else {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    let IconComponent = FileIcon
    let strokeColor = '#6b7280'
    if (fileType!.startsWith('video/') || VIDEO_EXTS.has(ext)) {
      IconComponent = Video; strokeColor = '#a855f7'
    } else if (fileType!.startsWith('audio/') || AUDIO_EXTS.has(ext)) {
      IconComponent = Volume2; strokeColor = '#22c55e'
    } else if (DOC_EXTS.has(ext) || fileType === 'application/pdf' || fileType!.includes('csv')) {
      IconComponent = FileText; strokeColor = '#f97316'
    } else if (CODE_EXTS.has(ext)) {
      IconComponent = FileCode; strokeColor = '#3b82f6'
    }
    const iconSVG = renderToStaticMarkup(<IconComponent color={strokeColor} width="14" height="14" />)
    const dataURI = `data:image/svg+xml,${encodeURIComponent(iconSVG)}`
    previewHTML = `<img src="${dataURI}" alt="${safeName}" draggable="false" class="h-4 w-4 object-contain shrink-0" title="${safeName}">`
  }
  const textHTML = `<span class="text-xs font-medium text-black/70 dark:text-white/70 truncate select-none max-w-[120px]">${safeName}</span>`
  return (
    `<span contenteditable="false" data-img="true" data-url="${url}" data-name="${safeName}" ${fileType ? `data-filetype="${fileType}"` : ''} class="inline-flex align-baseline relative top-0.5 group/chip mx-[2px] items-center gap-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-[5px] p-[2px] pr-1.5">` +
    previewHTML + textHTML +
    `<button type="button" class="absolute right-1 top-1/2 transform -translate-y-1/2 h-[14px] w-[14px] rounded-full bg-black/80 dark:bg-white/90 text-white dark:text-black flex items-center justify-center opacity-0 group-hover/chip:opacity-100 transition-opacity z-10 shadow-sm" data-rm-chip="true">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>` +
    `</button></span>`
  )
}


export default function Composer({
  workspace,
  onSubmit,
  className,
  style,
  ref,
  width,
  height,
  isStreaming,
}: {
  workspace: string
  onSubmit: (text: string, blocks?: ContentBlock[]) => void
  className: string
  style: CSSProperties
  ref: React.RefObject<HTMLElement | null>
  width: number
  height: number
  isStreaming: boolean
}) {
  const [isEmpty, setIsEmpty] = useState(true)
  const [isExpanded, setIsExpanded] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const escaping = useRef(false)
  const maxCharsRef = useRef(5)
  const small = width < 500 || height < 350
  useEffect(() => {
    if (ref) (ref as React.MutableRefObject<HTMLElement | null>).current = editorRef.current
  }, [ref])
  useEffect(() => {
    const w = width || 0
    maxCharsRef.current = w > 800 ? w / 28 : w / 14
  }, [width, height])
  const syncState = useCallback(() => {
    const div = editorRef.current
    if (!div) return
    const text = stripZW(div.textContent ?? '')
    const chips = div.querySelectorAll<HTMLElement>('[data-img]')
    const hasImg = chips.length > 0
    const empty = text.length === 0 && !hasImg
    const expanded = hasImg || text.includes('\n') || text.length > maxCharsRef.current
    setIsEmpty(prev => prev === empty ? prev : empty)
    setIsExpanded(prev => prev === expanded ? prev : expanded)
    // Cursor-guard: only needed when chips exist
    chips.forEach(chip => {
      ensureTextBefore(chip)
      ensureTextAfter(chip)
    })
  }, [])
  //
  // Browsers insert these automatically when:
  //   - All text is deleted (ghost <br> to keep the div from collapsing)
  //   - Enter is pressed without us intercepting (wraps content in <div>)
  //
  // We watch only direct children of the editor so we never touch chip
  // internals (chips are <span contenteditable=false>, so they won't
  // receive childList mutations anyway, but childList:true + subtree:false
  // makes this explicit).
  useEffect(() => {
    const div = editorRef.current
    if (!div) return
    const observer = new MutationObserver(() => {
      // Snapshot so removals don't confuse iteration
      const children = Array.from(div.childNodes)
      let dirty = false
      for (const node of children) {
        if (node.nodeName === 'BR') {
          div.removeChild(node)
          dirty = true
          continue
        }
        if (node.nodeName === 'DIV') {
          const el = node as HTMLElement
          // skip chip wrappers (they're <span>, but be defensive)
          if (el.dataset.img) continue
          if (el.innerHTML === '<br>' || el.innerHTML === '' || el.innerHTML === '&nbsp;') {
            // Pure ghost div  drop it entirely
            div.removeChild(el)
          } else {
            // Div with real content  unwrap it in-place with a leading \n
            const frag = document.createDocumentFragment()
            // Only prepend the newline if something precedes this div
            if (el.previousSibling) {
              frag.appendChild(document.createTextNode('\n'))
            }
            while (el.firstChild) frag.appendChild(el.firstChild)
            div.replaceChild(frag, el)
          }
          dirty = true
        }
      }
      if (dirty) syncState()
    })
    // childList only, no subtree  we only care about direct children
    observer.observe(div, { childList: true })
    return () => observer.disconnect()
  }, [syncState])
  useEffect(() => {
    const onSelectionChange = () => {
      if (escaping.current) return
      const div = editorRef.current
      if (!div) return
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
  }, [])
  const insertBlocks = useCallback((blocks: ContentBlock[]) => {
    const div = editorRef.current
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
        document.execCommand('insertHTML', false, buildChipHTML(block.url, block.name ?? '', block.fileType))
        const chips = div.querySelectorAll('[data-img]')
        if (chips.length > 0) {
          const lastChip = chips[chips.length - 1] as HTMLElement
          placeCaret(ensureTextAfter(lastChip), 0)
        }
      }
    }
    syncState()
  }, [syncState])

  const getInsertRange = useCallback((): Range => {
    const div = editorRef.current!
    if (savedRange.current) {
      const anc = savedRange.current.commonAncestorContainer
      if (div === anc || div.contains(anc)) return savedRange.current
    }
    const r = document.createRange()
    r.selectNodeContents(div)
    r.collapse(false)
    return r
  }, [])

  const insertChipAtCursor = useCallback((url: string, name: string, fileType: string) => {
    const div = editorRef.current
    if (!div) return
    div.focus()
    const sel = window.getSelection()
    const range = getInsertRange()
    sel?.removeAllRanges()
    sel?.addRange(range)
    if (!range.collapsed) document.execCommand('delete', false)
    document.execCommand('insertHTML', false, buildChipHTML(url, name, fileType) + '&nbsp;')
    savedRange.current = null
    syncState()
  }, [getInsertRange, syncState])

  const handlePlusClick = useCallback(async () => {
    const div = editorRef.current
    const sel = window.getSelection()
    if (sel?.rangeCount) {
      const r = sel.getRangeAt(0)
      const anc = r.commonAncestorContainer
      savedRange.current = (div && (div === anc || div.contains(anc))) ? r.cloneRange() : null
    } else {
      savedRange.current = null
    }
    const result = await open({ multiple: true })
    if (!result) return
    const paths = Array.isArray(result) ? result : [result]
    for (const filePath of paths) {
      const name = filePath.split(/[\\/]/).pop() ?? filePath
      const ext = name.split('.').pop()?.toLowerCase() ?? ''
      insertChipAtCursor(`/file/${filePath}`, name, getMimeType(ext))
    }
  }, [insertChipAtCursor])

  const handleCopy = useCallback((e: React.ClipboardEvent) => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return
    const blocks = serializeNode(sel.getRangeAt(0).cloneContents())
    if (!blocks.length) return
    e.preventDefault()
    navigator.clipboard.writeText(blocksToPlain(blocks)).catch(() => { })
  }, [])

  const handleCut = useCallback((e: React.ClipboardEvent) => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return
    handleCopy(e)
    document.execCommand('delete', false)
    syncState()
  }, [handleCopy, syncState])

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    e.preventDefault()
    if (e.clipboardData?.files?.length) {
      Array.from(e.clipboardData.files).forEach(file => {
        insertChipAtCursor(`/file/${file.name}`, file.name, file.type)
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isStreaming) {
      e.preventDefault()
      return
    }
    if (e.key === 'Enter') {
      if (!e.shiftKey) {
        // Plain Enter → submit
        e.preventDefault()
        handleSubmit()
        return
      }
      e.preventDefault()
      {
        const div = editorRef.current!
        const sel2 = window.getSelection()
        if (!sel2?.rangeCount) { syncState(); return }
        const range2 = sel2.getRangeAt(0)
        // Delete any active selection first
        if (!range2.collapsed) range2.deleteContents()
        // Detect end-of-editor: compare caret position to the last possible position
        const endRange = document.createRange()
        endRange.selectNodeContents(div)
        endRange.collapse(false)
        // We are at the end if the caret is at the very end, or if only ZWSPs follow
        let atEnd = range2.compareBoundaryPoints(Range.END_TO_END, endRange) === 0
        if (!atEnd) {
          const r = range2.cloneRange()
          r.setEnd(endRange.endContainer, endRange.endOffset)
          // toString() on a range includes text from all nodes; we strip ZWSPs to see if anything "real" remains
          atEnd = r.toString().replace(/\u200B/g, '').length === 0
        }
        // Insert newline node; trailing \u200B only when needed at the end
        const nlNode = document.createTextNode(atEnd ? '\n\u200B' : '\n')
        range2.insertNode(nlNode)
        // offset 1 → after '\n', before optional '\u200B' → caret on new line
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
      if (startContainer === editorRef.current && startOffset > 0) {
        const prev = editorRef.current.childNodes[startOffset - 1]
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
      const editor = editorRef.current
      if (startContainer === editor && startOffset < editor.childNodes.length) {
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
      const editor = editorRef.current
      if (startContainer === editor && startOffset > 0) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmpty, isStreaming, syncState])

  const handleSubmit = useCallback(() => {
    const blocks = serializeNode(editorRef.current!)
    onSubmit(blocksToPlain(blocks), blocks)
    if (editorRef.current) editorRef.current.innerHTML = ''
    setIsEmpty(true)
    setIsExpanded(false)
  }, [isEmpty, onSubmit])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (!target.closest('[data-rm-chip="true"]')) return
    e.preventDefault()
    e.stopPropagation()
    const chip = target.closest('[data-img="true"]')
    if (!chip) return
    editorRef.current?.focus()
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNode(chip)
    sel?.removeAllRanges()
    sel?.addRange(range)
    document.execCommand('delete', false)
    syncState()
  }, [syncState])

  const padH = '35px'
  const bottomExpanded = small ? 'bottom-[10px]' : 'bottom-[20px]'
  const bottomSend = small ? 'bottom-[2px]' : 'bottom-[12.5px]'
  const centerY = 'top-1/2 -translate-y-1/2'

  const wrapperCls = useMemo(() => clsx(
    'relative border border-[hsl(var(--border))] bg-[hsl(var(--chat-bubble))] px-1 shadow-lg',
    small
      ? 'py-3 text-xs rounded-[20px]'
      : isExpanded ? 'py-4.5 rounded-[30px]' : 'py-3.5 rounded-[30px]',
  ), [small, isExpanded])
  const editorCls = useMemo(() => clsx(
    'relative w-[92.5%] bg-transparent focus:outline-none',
    'max-h-[200px] overflow-y-auto',
    'leading-normal break-all whitespace-pre-wrap',
    'transition-[margin-left,margin-right,margin-bottom] duration-100 ease-out',
    isExpanded ? 'mb-[35px]' : 'mb-0',
    isStreaming && 'cursor-not-allowed opacity-0 select-none',
  ), [isExpanded, isStreaming])
  const editorStyle = useMemo(() => ({
    marginLeft: isExpanded ? '10px' : padH,
    marginRight: isExpanded ? '10px' : padH,
    wordBreak: 'normal' as const,
    overflowWrap: 'anywhere' as const,
  }), [isExpanded])
  const plusCls = useMemo(() => clsx(
    isExpanded ? bottomExpanded : centerY,
    'focus:outline-none h-5 w-5 absolute flex items-center justify-center opacity-70 hover:opacity-100 transition-opacity',
    small ? 'scale-[0.75] left-2' : 'left-3',
  ), [isExpanded, bottomExpanded, centerY, small])
  const sendCls = useMemo(() => clsx(
    isExpanded ? bottomSend : centerY,
    isEmpty ? 'opacity-25 dark:opacity-50' : 'opacity-100',
    'absolute h-9 w-9 bg-accent text-accent-foreground rounded-full flex items-center justify-center',
    small ? 'scale-[0.75] origin-right right-2' : 'right-3',
  ), [isExpanded, bottomSend, centerY, isEmpty, small])
  const stopCls = useMemo(() => clsx(
    isExpanded ? bottomSend : centerY,
    'absolute h-9 w-9 bg-black/10 dark:bg-[hsl(var(--float))] text-accent rounded-full flex items-center justify-center',
    small ? 'scale-[0.75] origin-right right-2' : 'right-3',
  ), [isExpanded, bottomSend, centerY, small])
  const micCls = useMemo(() => (isRecording: boolean) => clsx(
    isExpanded ? bottomExpanded : centerY,
    'h-5 w-5 absolute flex items-center justify-center',
    small ? 'scale-[0.75] right-10' : 'right-14',
    isRecording ? 'text-red-500' : 'text-accent',
  ), [isExpanded, bottomExpanded, centerY, small])
  return (
    <div style={style} className={className}>
      <div className={wrapperCls}>
        {isEmpty && (
          <span
            className="absolute pointer-events-none select-none text-zinc-500"
            style={{ left: isExpanded ? '10px' : '40px', top: '50%', transform: 'translateY(-50%)' }}
          >
            Ask anything
          </span>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onInput={syncState}
          onKeyDown={handleKeyDown}
          onCopy={handleCopy}
          onCut={handleCut}
          onPaste={handlePaste}
          onPointerDown={handlePointerDown}
          className={editorCls}
          style={editorStyle}
        />
        <button onClick={handlePlusClick} className={plusCls}>
          <Plus />
        </button>
        <Record
          workspace={workspace}
          onFileSaved={(filePath) => {
            const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
            const fileName = filePath.split(/[\\/]+/).pop() ?? filePath
            insertChipAtCursor(`/file/${filePath}`, fileName, getMimeType(ext))
          }}
        >
          {({ isRecording, startRecording, stopRecording }) => (
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={micCls(isRecording)}
            >
              <Mic />
            </button>
          )}
        </Record>
        {isStreaming ? (
          <button onClick={handleSubmit} className={stopCls}>
            <Square fill="currentColor" className="w-4 h-4" />
          </button>
        ) : (
          <button onClick={handleSubmit} className={sendCls}>
            <ArrowUp className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  )
}