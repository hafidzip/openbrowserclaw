import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "openchad-react/ui"
import { TooltipProvider } from "openchad-react/ui"
import {
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Undo2,
  Redo2,
  Info,
  Play,
  Square,
  FileText,
  FolderOpen,
  X,
  Scroll,
  RefreshCcw,
  InfoIcon,
  Copy,
  Check,
  AlertTriangle,
  AlertCircle,
  Code2,
  Pencil
} from 'lucide-react'
import { ref, useFolder, useTheme, type AppInfo, Dropdown, useAvailableModels, uuidv4, usePythonEvent, useGlobal } from 'openchad-react'
import clsx from 'clsx'
import type { Model } from './utils'
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { MenuBar } from './utils/state'




//  Types 

export interface AgentNode {
  id: string
  name: string
  tools: string[]
  children: string[]
  toolValues: Record<string, Record<string, any>>
  allowMultiple: boolean
  enableProgrammaticToolCalling: boolean
  model: string | null
  warnings?: string[]
  errors?: string[]
  skillPath?: string | null
}


export type TreeNode = Omit<AgentNode, 'children'> & {
  children: Record<string, TreeNode>;
};

export function buildTree(flat: Record<string, AgentNode>): Record<string, TreeNode> {
  const allChildIds = new Set(
    Object.values(flat).flatMap(n => n.children)
  );

  const rootIds = Object.keys(flat).filter(id => !allChildIds.has(id));

  function buildNode(id: string): TreeNode {
    const { children: childIds, ...rest } = flat[id];
    return {
      ...rest,
      children: Object.fromEntries(
        childIds.map(cid => [cid, buildNode(cid)])
      ),
    };
  }

  return Object.fromEntries(rootIds.map(id => [id, buildNode(id)]));
}


//  Constants 

const MAX_HISTORY = 50
const LEVEL_HEIGHT = 110
const SIBLING_SEP = 24     // horizontal gap between adjacent siblings
const CARD_W = 176         // w-44 = 176px
const CARD_H = 52
const CARD_HALF_W = CARD_W / 2
const CARD_HALF_H = CARD_H / 2
const ZOOM_MIN = 0.1
const ZOOM_MAX = 2.0



//  Auto-Resize Textarea 

interface AutoResizeTextareaProps {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  style?: React.CSSProperties
  className?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void
  id?: string
}

const AutoResizeTextarea = React.memo(function AutoResizeTextarea({
  value, onChange, placeholder, style, className, onKeyDown, onFocus, onBlur, id
}: AutoResizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'

    const computedStyle = window.getComputedStyle(el)
    const maxHeight = parseFloat(computedStyle.maxHeight)

    if (!isNaN(maxHeight) && el.scrollHeight > maxHeight) {
      el.style.height = `${maxHeight}px`
      el.style.overflowY = 'auto'
    } else {
      el.style.height = `${el.scrollHeight}px`
      el.style.overflowY = 'hidden'
    }
  }, [value])

  return (
    <textarea
      ref={ref}
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={1}
      style={{ resize: 'none', overflow: 'hidden', lineHeight: '1.5', ...style }}
      className={className}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  )
})

const SearchableDropdown = React.memo(function SearchableDropdown({
  options,
  title,
  value,
  onChange,
  placeholder = "Select...",
  className = "w-70 max-h-50",
  themeStyles,
  triggerClassName = "",
  onOpenChange,
}: {
  options: string[] | { value: string; label: string; description?: string }[];
  title: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  themeStyles: any;
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const normalizedOptions = useMemo(() => {
    return options.map(opt => {
      if (typeof opt === 'string') {
        return { value: opt, label: opt };
      }
      return opt;
    });
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (!search) return normalizedOptions;
    const lower = search.toLowerCase();
    return normalizedOptions.filter(opt =>
      opt.label.toLowerCase().includes(lower) ||
      (opt.description && opt.description.toLowerCase().includes(lower))
    );
  }, [normalizedOptions, search]);

  const dropdownContent = useMemo(() => {
    return filteredOptions.map(opt => ({
      content: (
        <div className="flex flex-col gap-0.5 w-full text-left">
          <span>{opt.label}</span>
          {opt.description && (
            <span className="text-[9px] opacity-65 truncate max-w-[200px]" title={opt.description}>
              {opt.description}
            </span>
          )}
        </div>
      ),
      trigger: () => {
        onChange(opt.value);
        setOpen(false);
        setSearch("");
      }
    }));
  }, [filteredOptions, onChange]);

  const selectedOption = normalizedOptions.find(opt => opt.value === value);

  return (
    <Dropdown
      placeholder={title}
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) {
          setSearch("");
          if (onOpenChange) onOpenChange(isOpen);
        }
      }}
      search={search}
      setSearch={setSearch}
      content={dropdownContent}
      className={className}
      align="start"
    >
      <button
        type="button"
        className={clsx(
          "p-2 text-sm rounded-lg border outline-none text-left flex justify-between items-center",
          triggerClassName
        )}
        style={{
          background: themeStyles.muted,
          borderColor: themeStyles.border,
          color: themeStyles.accent
        }}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <span className="ml-2 opacity-50">▾</span>
      </button>
    </Dropdown>
  );
});

const getFiltersForExtensions = (extString?: string) => {
  if (!extString) return undefined;
  const exts = extString.split(',').map(s => s.trim()).filter(Boolean);
  if (exts.length === 0) return undefined;
  return [{ name: "Files", extensions: exts }];
};

//  Array Field Editor for Tool Settings 

interface ArrayFieldEditorProps {
  value: any
  onChange: (val: any) => void
  type: string
  themeStyles: any
  items?: string[]
  placeholder?: string
}

const ArrayFieldEditor = React.memo(function ArrayFieldEditor({
  value,
  onChange,
  type,
  themeStyles,
  items,
  placeholder,
}: ArrayFieldEditorProps) {
  const list: any[] = useMemo(() => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      return value.split(',').map(s => s.trim());
    }
    return [];
  }, [value]);

  const [inputValue, setInputValue] = useState('');
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const isEnum = type === 'array:enum';

  const handleAdd = () => {
    const val = inputValue.trim();
    if (!val) return;
    let typedVal: any = val;
    if (type === 'array:number') {
      typedVal = Number(val);
      if (isNaN(typedVal)) return;
    }
    onChange([...list, typedVal]);
    setInputValue('');
  };

  const handleRemove = (idxToRemove: number) => {
    onChange(list.filter((_, idx) => idx !== idxToRemove));
  };

  const startEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditingValue(String(list[idx]));
  };

  const commitEdit = () => {
    if (editingIdx === null) return;
    const val = editingValue.trim();
    if (val === '') {
      handleRemove(editingIdx);
    } else {
      let typedVal: any = val;
      if (type === 'array:number') {
        typedVal = Number(val);
        if (isNaN(typedVal)) return;
      }
      const newList = [...list];
      newList[editingIdx] = typedVal;
      onChange(newList);
    }
    setEditingIdx(null);
  };

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {/* Pills Container */}
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-1.5 rounded border max-h-32 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.1)', borderColor: themeStyles.border }}>
          {list.map((item, idx) => {
            const isEditing = editingIdx === idx;
            return (
              <div
                key={idx}
                className={clsx(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-all",
                  isEditing && "w-full"
                )}
                style={{
                  background: isEditing ? themeStyles.muted : 'rgba(255,255,255,0.04)',
                  borderColor: themeStyles.border,
                  color: themeStyles.accent
                }}
              >
                {isEditing ? (
                  isEnum ? (
                    <SearchableDropdown
                      title={type}
                      options={items || []}
                      value={editingValue}
                      onChange={(val) => {
                        const newList = [...list];
                        newList[editingIdx!] = val;
                        onChange(newList);
                        setEditingIdx(null);
                      }}
                      onOpenChange={(isOpen) => {
                        if (!isOpen) setEditingIdx(null);
                      }}
                      themeStyles={themeStyles}
                      className="w-full flex-1"
                      triggerClassName="border-none p-0 h-auto bg-transparent! text-[10px] font-semibold w-full flex justify-between"
                    />
                  ) : (
                    <input
                      type={type === 'array:number' ? 'number' : 'text'}
                      value={editingValue}
                      autoFocus
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit();
                        if (e.key === 'Escape') setEditingIdx(null);
                      }}
                      className="bg-transparent border-none outline-none flex-1 min-w-0 text-[10px] p-0 font-semibold"
                      style={{ color: themeStyles.accent }}
                    />
                  )
                ) : (
                  <span
                    className="cursor-pointer hover:underline truncate max-w-[120px]"
                    onClick={() => startEdit(idx)}
                    title="Click to edit item"
                  >
                    {String(item)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(idx)}
                  className="text-red-400 hover:text-red-300 font-bold ml-1 text-xs leading-none"
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Input row */}
      <div className="flex gap-1">
        {isEnum ? (
          <SearchableDropdown
            title={type}
            options={items || []}
            value={inputValue}
            onChange={(val) => {
              if (val) {
                onChange([...list, val]);
                setInputValue('');
              }
            }}
            placeholder="Add item..."
            themeStyles={themeStyles}
            triggerClassName="flex-1"
          />
        ) : (
          <>
            <input
              type={type === 'array:number' ? 'number' : 'text'}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={placeholder || "Add item… (Press Enter)"}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              className="flex-1 px-2 py-1 text-xs rounded border outline-none min-w-0"
              style={{
                background: themeStyles.muted,
                borderColor: themeStyles.border,
                color: themeStyles.accent
              }}
            />
            {(type.startsWith('array:file') || type.startsWith('array:folder')) && (
              <button
                type="button"
                onClick={async () => {
                  const isFolder = type.startsWith('array:folder');
                  let extString: string | undefined;
                  if (type.startsWith('array:file:')) {
                    extString = type.slice('array:file:'.length);
                  }
                  const filters = getFiltersForExtensions(extString);
                  const selectedPaths = await open({
                    directory: isFolder,
                    multiple: true,
                    filters
                  });
                  if (selectedPaths) {
                    const pathsArray = Array.isArray(selectedPaths) ? selectedPaths : [selectedPaths];
                    onChange([...list, ...pathsArray]);
                  }
                }}
                className="px-2 py-1 rounded border hover:opacity-90 flex items-center justify-center transition-all flex-shrink-0"
                style={{
                  background: themeStyles.muted,
                  borderColor: themeStyles.border,
                  color: themeStyles.accent
                }}
                title={type.startsWith('array:file') ? "Browse file(s)" : "Browse folder(s)"}
              >
                {type.startsWith('array:file') ? <FileText size={12} /> : <FolderOpen size={12} />}
              </button>
            )}
            <button
              type="button"
              onClick={handleAdd}
              className="px-2 py-1 rounded text-xs font-semibold hover:opacity-90 flex items-center justify-center transition-opacity flex-shrink-0"
              style={{
                background: themeStyles.accent,
                color: themeStyles.accentFg,
              }}
            >
              <Plus size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
});

//  Memoised Placeholder Agent 

interface PlaceholderAgentProps {
  id: string
  posX: number
  posY: number
  isDark: boolean
  onClick: () => void
}

const PlaceholderAgent = React.memo(function PlaceholderAgent({
  id, posX, posY, isDark, onClick
}: PlaceholderAgentProps) {
  const [hovered, setHovered] = useState(false)
  const border = 'hsl(var(--border))'
  const cardBg = 'hsl(var(--card))'
  const size = 32
  const halfSize = size / 2
  const accentColor = 'hsl(var(--accent))'

  return (
    <div
      id={id}
      className="placeholder-node absolute pointer-events-auto flex items-center justify-center rounded-full border border-dashed cursor-pointer shadow-sm hover:shadow-md hover:scale-110 active:scale-95"
      style={{
        width: size,
        height: size,
        left: posX - halfSize,
        top: posY - halfSize,
        background: hovered ? 'hsl(var(--accent) / 0.1)' : cardBg,
        borderColor: hovered ? accentColor : border,
        color: hovered ? accentColor : isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)',
        transition: 'left 350ms cubic-bezier(0.16, 1, 0.3, 1), top 350ms cubic-bezier(0.16, 1, 0.3, 1), background 200ms ease-out, border-color 200ms ease-out, color 200ms ease-out, transform 200ms ease-out, box-shadow 200ms ease-out',
      }}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Add child agent"
    >
      <Plus size={14} />
    </div>
  )
})

//  Memoised Agent Card 

interface AgentCardProps {
  id: string
  tabId: string
  agent: AgentNode
  posX: number
  posY: number
  isSelected: boolean
  isHovered: boolean
  isPathHighlight: boolean
  isRunningPath: boolean
  isRunning: boolean
  isDark: boolean
  isOverlap: boolean
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onDelete: (id: string) => void
  onAdd: () => void
}

const AgentCard = React.memo(function AgentCard({
  id, tabId, agent, posX, posY, isSelected, isHovered, isPathHighlight, isRunningPath, isRunning, isDark, isOverlap,
  onSelect, onHover, onDelete, onAdd
}: AgentCardProps) {
  const dotColor = 'hsl(var(--accent))'
  const mutedFg = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)'
  const cardBg = 'hsl(var(--card))'
  const border = 'hsl(var(--border))'
  const runningColor = '#34d399'
  const hasError = agent.errors && agent.errors.length > 0
  const hasWarning = agent.warnings && agent.warnings.length > 0
  const statusColor = hasError ? '#ef4444' : hasWarning ? '#f59e0b' : null
  const outlineColor = statusColor || (isRunning ? runningColor : isSelected ? dotColor : null)

  return (
    <div
      id={`agent-${id}`}
      className="node-card absolute pointer-events-auto flex flex-col p-2.5 rounded-lg border cursor-pointer animate-in fade-in-0 zoom-in-95 duration-200"
      style={{
        width: CARD_W,
        left: posX - CARD_HALF_W,
        top: posY - CARD_HALF_H,
        transformOrigin: 'center',
        background: cardBg,
        borderColor: outlineColor
          ? outlineColor
          : isHovered || isPathHighlight
            ? 'hsl(var(--accent) / 0.5)'
            : border,
        boxShadow: isRunning
          ? `0 0 0 2px ${outlineColor}60, 0 0 16px ${outlineColor}40`
          : isSelected
            ? `0 0 0 2px ${outlineColor}, 0 4px 20px ${statusColor ? `${statusColor}25` : 'rgba(0,0,0,0.15)'}`
            : isHovered
              ? `0 4px 20px ${statusColor ? `${statusColor}35` : 'rgba(0,0,0,0.12)'}`
              : 'none',
        transform: isSelected ? 'scale(1.03)' : isHovered ? 'scale(1.015)' : 'scale(1)',
        transition: 'left 350ms cubic-bezier(0.16, 1, 0.3, 1), top 350ms cubic-bezier(0.16, 1, 0.3, 1), border-color 200ms ease-out, box-shadow 200ms ease-out, transform 200ms ease-out, background 200ms ease-out',
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(id) }}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 flex justify-center items-center gap-1.5 min-w-0">
          {isRunning ? (
            <span title={hasError ? `${agent.errors!.length} error(s)` : hasWarning ? `${agent.warnings!.length} warning(s)` : undefined} className="flex-shrink-0 flex items-center">
              <RefreshCcw
                size={10}
                className="animate-spin flex-shrink-0"
                style={{ color: statusColor || runningColor }}
              />
            </span>
          ) : hasError ? (
            <span title={`${agent.errors!.length} error(s)`} className="flex-shrink-0 flex items-center">
              <AlertCircle
                size={10}
                className="text-red-500 dark:text-red-400 stroke-[3]"
              />
            </span>
          ) : hasWarning ? (
            <span title={`${agent.warnings!.length} warning(s)`} className="flex-shrink-0 flex items-center">
              <AlertTriangle
                size={10}
                className="text-amber-500 dark:text-amber-400 stroke-[3]"
              />
            </span>
          ) : (
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dotColor }} />
          )}
          <span
            className="text-[10px] font-mono tracking-wider font-bold uppercase truncate block min-w-0"
            style={{ color: isRunning ? runningColor : mutedFg }}
          >
            {agent.name}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {id !== tabId && (
            <>
              <button
                id={`agent-del-btn-${id}`}
                className="ui-control p-1 rounded transition-colors"
                style={{ color: mutedFg }}
                title="Delete agent & branch"
                onMouseEnter={(e) => (e.currentTarget.style.color = '#fb7185')}
                onMouseLeave={(e) => (e.currentTarget.style.color = mutedFg)}
                onClick={(e) => { e.stopPropagation(); onDelete(id) }}
              >
                <Trash2 size={12} />
              </button>
              {isOverlap && <button
                id={`agent-del-btn-${id}`}
                className="ui-control p-1 rounded transition-colors"
                style={{ color: mutedFg }}
                title="Add agent"
                onMouseEnter={(e) => (e.currentTarget.style.color = '#fb7185')}
                onMouseLeave={(e) => (e.currentTarget.style.color = mutedFg)}
                onClick={(e) => { e.stopPropagation(); onAdd() }}
              >
                <Plus size={12} />
              </button>}
            </>
          )}
        </div>
      </div>
    </div>
  )
})

//  Main Component 

interface ToolProps {
  toolName: string
  sourceLabel: string
  description?: string
  onRemove: () => void
  themeStyles: any
}

const Tool = ({
  toolName,
  sourceLabel,
  description,
  onRemove,
  themeStyles
}: ToolProps) => (
  <div
    className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold border"
    style={{
      background: 'rgba(255,255,255,0.04)',
      borderColor: themeStyles.border,
      color: themeStyles.accent
    }}
    title={description}
  >
    <span>{toolName}{sourceLabel}</span>
    <button
      type="button"
      onClick={onRemove}
      className="text-red-400 hover:text-red-300 font-bold ml-1 text-xs"
    >
      &times;
    </button>
  </div>
)

const CollapsibleTextItem = React.memo(function CollapsibleTextItem({
  text,
  className,
  onDelete
}: {
  text: string
  className?: string
  onDelete?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const isLong = text.length > 180

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <li className={clsx("relative group break-all text-xs leading-relaxed transition-all pr-10 py-0.5", className)}>
      <span>
        {isLong && !expanded ? `${text.slice(0, 180)}... ` : text}
      </span>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] font-mono font-bold underline ml-1 cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
          style={{ color: 'inherit' }}
        >
          {expanded ? "[Show Less]" : "[Read More]"}
        </button>
      )}
      <div className="absolute right-0 top-1 opacity-0 group-hover:opacity-100 flex items-center gap-1.5 transition-opacity px-1 text-foreground">
        <button
          type="button"
          onClick={handleCopy}
          className="hover:scale-110 cursor-pointer opacity-70 hover:opacity-100 transition-all flex items-center"
          style={{ color: 'inherit' }}
          title="Copy text"
        >
          {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="text-red-500 hover:text-red-400 dark:text-red-400 dark:hover:text-red-300 font-bold text-xs hover:scale-110 cursor-pointer leading-none"
            title="Delete item"
          >
            &times;
          </button>
        )}
      </div>
    </li>
  )
})

interface AgentEditorProps {
  selected: string
  agents: Record<string, AgentNode>
  availableModels: Model[]
  modelsLoading: boolean
  pyInvoke: (cmd: string, args?: Record<string, any>) => Promise<any>
  handleUpdateAgentProperty: (id: string, fields: Partial<AgentNode>, isTextField?: boolean) => void
  availableTools: { name: string; description: string; source: 'internal' | 'mcp' }[]
  handleAddAgent: (parentId: string) => void
  handleDeleteAgent: (idToDelete: string) => void
  themeStyles: any
  toolFields: Record<string, any[]>
  tabId: string
}

const AgentEditor = ({
  selected,
  agents,
  availableModels,
  modelsLoading,
  handleUpdateAgentProperty,
  pyInvoke,
  availableTools,
  handleAddAgent,
  handleDeleteAgent,
  themeStyles,
  toolFields,
  tabId
}: AgentEditorProps) => {
  const modelObj = availableModels.find(m => m.id === agents[selected].model)
  const label = modelObj?.name ?? agents[selected].model

  useEffect(() => {
    if (availableModels.findIndex(m => m.id === agents[selected].model) === -1) handleUpdateAgentProperty(selected, { model: null })
  }, [availableModels])


  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedErrors, setCopiedErrors] = useState(false);
  const [copiedWarnings, setCopiedWarnings] = useState(false);

  const [, setShowCodeDialog] = useGlobal('showCodeDialog', { initialValue: false });
  const [, setCodeLanguage] = useGlobal('codeLanguage', { initialValue: "text" });
  const [, setCodeId] = useGlobal('codeId', { initialValue: "" });
  const [, setPrevCode] = useGlobal('prevCode', { initialValue: "" });
  const [, setCode] = useGlobal('code', { initialValue: "" });

  const handleCopyAllErrors = () => {
    const text = (agents[selected].errors || []).join('\n')
    navigator.clipboard.writeText(text)
    setCopiedErrors(true)
    setTimeout(() => setCopiedErrors(false), 1500)
  }

  const handleCopyAllWarnings = () => {
    const text = (agents[selected].warnings || []).join('\n')
    navigator.clipboard.writeText(text)
    setCopiedWarnings(true)
    setTimeout(() => setCopiedWarnings(false), 1500)
  }

  const skillPath = agents[selected].skillPath || null;

  const setSkillPath = (path: string | null) => {
    handleUpdateAgentProperty(selected, { skillPath: path });
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(selected);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1500);
  };

  useEffect(() => {
    const handleDragDrop = (e: Event) => {
      const customEvent = e as CustomEvent;
      const payload = customEvent.detail;
      if (!payload || !dropZoneRef.current) return;

      const rect = dropZoneRef.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const x = payload.position.x / dpr;
      const y = payload.position.y / dpr;

      const isInside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

      if (payload.type === 'hover') {
        setIsDragOver(isInside);
      } else if (payload.type === 'drop') {
        setIsDragOver(false);
        if (isInside && payload.paths && payload.paths.length > 0) {
          const filePath = payload.paths[0];
          if (filePath.endsWith('.md')) {
            setSkillPath(filePath);
          }
        }
      } else if (payload.type === 'cancel') {
        setIsDragOver(false);
      }
    };

    window.addEventListener('drag_drop', handleDragDrop);
    return () => {
      window.removeEventListener('drag_drop', handleDragDrop);
    };
  }, [selected, agents]);


  return <div className="flex flex-col gap-4 pb-10">
    <div>
      <span
        className="text-[10px] font-mono font-bold tracking-wider uppercase"
        style={{ color: themeStyles.mutedFg }}
      >
        Selected Agent Properties
      </span>
      <h3 className="text-xs font-semibold mt-1 flex items-center gap-2" style={{ color: themeStyles.accent }}>
        ID: <span className="font-mono text-xs truncate">{selected}</span>
        {copiedId
          ? <Check size={14} className="text-emerald-400 transition-all" />
          : <Copy size={14} className="cursor-pointer transition-all" onClick={handleCopyId} />
        }
      </h3>
    </div>

    {/* Warnings & Errors List */}
    {((agents[selected].errors && agents[selected].errors!.length > 0) ||
      (agents[selected].warnings && agents[selected].warnings!.length > 0)) && (
        <div className="flex flex-col gap-2 p-3 rounded-xl border bg-black/10 dark:bg-white/[0.02]" style={{ borderColor: themeStyles.border }}>
          {agents[selected].errors && agents[selected].errors!.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-red-500 dark:text-red-400 uppercase tracking-wider flex items-center gap-1">
                  <AlertCircle size={12} /> Errors ({agents[selected].errors!.length})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCopyAllErrors}
                    className="text-[9px] font-bold uppercase tracking-wider opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
                    style={{ color: themeStyles.mutedFg }}
                  >
                    {copiedErrors ? "Copied" : "Copy All"}
                  </button>
                  <span className="opacity-35 text-[9px]" style={{ color: themeStyles.mutedFg }}>|</span>
                  <button
                    type="button"
                    onClick={() => handleUpdateAgentProperty(selected, { errors: [] })}
                    className="text-[9px] font-bold uppercase tracking-wider opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
                    style={{ color: themeStyles.mutedFg }}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <ul className="flex flex-col gap-1 list-disc pl-4">
                {agents[selected].errors!.map((err, idx) => (
                  <CollapsibleTextItem
                    key={idx}
                    text={err}
                    className="text-red-600 dark:text-red-400"
                    onDelete={() => {
                      const newErrors = agents[selected].errors!.filter((_, i) => i !== idx)
                      handleUpdateAgentProperty(selected, { errors: newErrors })
                    }}
                  />
                ))}
              </ul>
            </div>
          )}
          {agents[selected].errors && agents[selected].errors!.length > 0 && agents[selected].warnings && agents[selected].warnings!.length > 0 && (
            <div className="h-px my-1" style={{ background: themeStyles.border }} />
          )}
          {agents[selected].warnings && agents[selected].warnings!.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-amber-500 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
                  <AlertTriangle size={12} /> Warnings ({agents[selected].warnings!.length})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCopyAllWarnings}
                    className="text-[9px] font-bold uppercase tracking-wider opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
                    style={{ color: themeStyles.mutedFg }}
                  >
                    {copiedWarnings ? "Copied" : "Copy All"}
                  </button>
                  <span className="opacity-35 text-[9px]" style={{ color: themeStyles.mutedFg }}>|</span>
                  <button
                    type="button"
                    onClick={() => handleUpdateAgentProperty(selected, { warnings: [] })}
                    className="text-[9px] font-bold uppercase tracking-wider opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
                    style={{ color: themeStyles.mutedFg }}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <ul className="flex flex-col gap-1 list-disc pl-4">
                {agents[selected].warnings!.map((warn, idx) => (
                  <CollapsibleTextItem
                    key={idx}
                    text={warn}
                    className="text-amber-600 dark:text-amber-400"
                    onDelete={() => {
                      const newWarnings = agents[selected].warnings!.filter((_, i) => i !== idx)
                      handleUpdateAgentProperty(selected, { warnings: newWarnings })
                    }}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

    {/* Allow multiple toggle */}
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold flex items-center gap-1" style={{ color: themeStyles.mutedFg }}>
        <div className='flex items-center gap-1'>
          <Code2 size={14} />
          <span>Programmatic Tool Calling</span>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon size={12} />
            </TooltipTrigger>
            <TooltipContent>
              <p>Prefer using <b>frontier model</b> when enable this.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          id={`btn-allow-multiple-${selected}`}
          onClick={() => handleUpdateAgentProperty(selected, { enableProgrammaticToolCalling: !agents[selected].enableProgrammaticToolCalling })}
          className="relative w-9 h-5 rounded-full flex-shrink-0 transition-colors duration-200 focus:outline-none"
          style={{
            background: agents[selected].enableProgrammaticToolCalling ? '#34d399' : themeStyles.muted,
            border: `1px solid ${agents[selected].enableProgrammaticToolCalling ? '#34d399' : themeStyles.border}`,
          }}
        >
          <span
            className="absolute top-[1px] w-4 h-4 rounded-full shadow transition-all duration-200"
            style={{
              background: agents[selected].enableProgrammaticToolCalling ? '#fff' : themeStyles.mutedFg,
              left: agents[selected].enableProgrammaticToolCalling ? '17px' : '2px',
            }}
          />
        </button>
        <span className="text-xs" style={{ color: agents[selected].enableProgrammaticToolCalling ? '#34d399' : themeStyles.mutedFg }}>
          {agents[selected].enableProgrammaticToolCalling ? 'Enable' : 'Disable'}
        </span>
      </div>
    </div>


    {/* Model selection */}
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold" style={{ color: themeStyles.mutedFg }}>
        Model
      </label>
      <SearchableDropdown
        title='Model'
        options={availableModels
          .map(m => ({
            value: m.id!,
            label: m.name ?? m.id!,
            description: m.backend?.split(':').pop(),
          }))}
        value={agents[selected].model || ""}
        onChange={(val) => {
          if (val) handleUpdateAgentProperty(selected, { model: val })
        }}
        placeholder={'Select model…'}
        themeStyles={themeStyles}
        triggerClassName="w-full"
      />
    </div>


    {/* Name field */}
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold" style={{ color: themeStyles.mutedFg }}>Name</label>
      <input
        id="input-agent-name"
        type="text"
        value={agents[selected].name}
        onChange={(e) => handleUpdateAgentProperty(selected, { name: e.target.value }, true)}
        className="p-2.5 text-sm rounded-lg outline-none transition-colors border"
        style={{
          background: themeStyles.muted,
          borderColor: themeStyles.border,
          color: themeStyles.accent,
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = themeStyles.accent)}
        onBlur={(e) => (e.currentTarget.style.borderColor = themeStyles.border)}
      />
    </div>

    {/* SKILL selection */}
    <label className="text-xs font-semibold" style={{ color: themeStyles.mutedFg }}>Skill</label>
    <div className='w-full flex items-center justify-center'>
      {skillPath ? (
        <div
          ref={dropZoneRef}
          onClick={async () => {
            const path = await open({
              defaultPath: ((window as any).PROJECT_ROOT as string) + "/SKILLS",
              filters: [{ name: "Skill Files", extensions: ["md"] }]
            });
            if (path) setSkillPath(path)
          }}
          className={[
            "flex flex-col items-center justify-center w-48 h-36 relative group",
            "border-2 border-solid rounded-xl transition-all cursor-pointer text-center p-4",
            isDragOver
              ? "border-accent bg-accent/10 scale-105"
              : "border-accent bg-accent/5 hover:bg-accent/10 hover:border-accent/80"
          ].join(' ')}>
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();

              // 1. Safe extraction with optional chaining
              const selectedAgent = agents?.[selected];
              const rawPath = selectedAgent?.skillPath;

              if (!rawPath) {
                console.error("Skill path is undefined for the selected agent.");
                return;
              }

              // 2. Normalize path: Convert all Windows backslashes (\) to forward slashes (/)
              const normalizedPath = rawPath.replace(/\\/g, '/');

              // 3. Extract folder and filename safely
              const pathParts = normalizedPath.split('/');
              let skillFilename = pathParts.pop() || '';
              const skillFolder = pathParts.join('/');

              // 4. Gracefully append '.md' if the path didn't include an extension
              if (skillFilename && !skillFilename.includes('.')) {
                skillFilename += '.md';
              }

              // 5. Execute the file read inside a safe try-catch wrapper
              try {
                if (!skillFolder || !skillFilename) {
                  throw new Error(`Malformed path structure. Folder: "${skillFolder}", File: "${skillFilename}"`);
                }


                const fileRes = await pyInvoke('file', {
                  command: 'read',
                  filename: skillFilename,
                  base_dir: skillFolder
                }) as any;

                const fileContent = fileRes?.data?.content;

                if (fileContent !== undefined && fileContent !== null) {
                  setPrevCode(fileContent);
                  setCode(fileContent);
                  setCodeId(`editable: ${selected}`); // Retain original raw path structure for identification
                  setCodeLanguage("markdown");
                  setShowCodeDialog(true);
                }

              } catch (error) {
                // Graceful error handling prevents application crashes if backend fails
                console.error("An error occurred while trying to read the skill file:", error);
                // Optional: Add a user-facing notification alert/toast here if your UI supports it
              }
            }
            }
            className="absolute top-2 right-10 p-1 rounded-full bg-gray-500/10 hover:bg-amber-500/20 text-gray-400 hover:text-amber-400 transition-all opacity-0 group-hover:opacity-100"
            title="Edit skill"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSkillPath(null);
            }}
            className="absolute top-2 right-2 p-1 rounded-full bg-gray-500/10 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100"
            title="Remove skill"
          >
            <X size={14} />
          </button>
          <Scroll className="w-8 h-8 text-accent mb-2 animate-pulse" style={{ animationDuration: '3s' }} />
          <p className="text-xs font-bold truncate max-w-full" style={{ color: themeStyles.accent }}>
            {skillPath.split(/[\\/]/).pop()}
          </p>
          <p
            onClick={(e)=>{
              e.stopPropagation()
              revealItemInDir(skillPath)
            }}
            className="hover:underline cursor-pointer text-xs text-gray-400 dark:text-gray-500 truncate max-w-full mt-1.5 cursor-help"
            title={skillPath}
          >
            {(() => {
              if (skillPath.length <= 24) return skillPath;
              const sliceStart = skillPath.length - 21;
              const nextSlash = skillPath.indexOf('/', sliceStart);
              const nextBackslash = skillPath.indexOf('\\', sliceStart);
              const firstSep = (nextSlash !== -1 && nextBackslash !== -1)
                ? Math.min(nextSlash, nextBackslash)
                : (nextSlash !== -1 ? nextSlash : nextBackslash);
              if (firstSep !== -1 && firstSep - sliceStart < 8) {
                return '...' + skillPath.substring(firstSep);
              }
              return '...' + skillPath.slice(-21);
            })()}
          </p>
        </div>
      ) : (
        <div
          ref={dropZoneRef}
          onClick={async () => {
            const path = await open({
              defaultPath: ((window as any).PROJECT_ROOT as string) + "/SKILLS",
              filters: [{ name: "Skill Files", extensions: ["md"] }]
            });
            if (path) setSkillPath(path)
          }}
          className={[
            "flex flex-col items-center justify-center w-48 h-36",
            "border-2 border-dotted rounded-xl transition-colors cursor-pointer text-center p-4",
            isDragOver
              ? "border-accent bg-accent/10 scale-105"
              : "border-gray-400 hover:border-gray-600 dark:border-gray-600 dark:hover:border-gray-400"
          ].join(' ')}>
          <Scroll className="w-8 h-8 text-accent mb-2 animate-pulse" style={{ animationDuration: '3s' }} />
          <p className="text-xs font-medium text-gray-400">
            Select or drop <span className="font-mono px-1 rounded font-bold text-accent">SKILL.md</span>
          </p>
        </div>
      )}
    </div>

    {/* Tools selection */}
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold" style={{ color: themeStyles.mutedFg }}>Tools</label>
      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto mb-1 pr-1">
        {(agents[selected].tools || []).map(toolName => {
          const toolObj = availableTools.find(t => t.name === toolName)
          const sourceLabel = (toolObj && toolObj.source !== "internal") ? ` (${toolObj.source})` : ''
          return (
            <Tool
              key={toolName}
              toolName={toolName}
              sourceLabel={sourceLabel}
              description={toolObj?.description}
              themeStyles={themeStyles}
              onRemove={() => {
                const currentTools = agents[selected].tools || []
                handleUpdateAgentProperty(selected, {
                  tools: currentTools.filter(t => t !== toolName)
                })
              }}
            />
          )
        })}
        {(agents[selected].tools || []).length === 0 && (
          <span className="text-[10px] italic" style={{ color: themeStyles.mutedFg }}>No tools selected</span>
        )}
      </div>
      <SearchableDropdown
        title='Tool'
        options={availableTools
          .filter(t => !(agents[selected].tools || []).includes(t.name))
          .map(t => ({
            value: t.name,
            label: `${t.name} ${t.source !== "internal" ? `(${t.source})` : ""}`,
            description: t.description
          }))}
        value=""
        onChange={(val) => {
          if (val) {
            const currentTools = agents[selected].tools || []
            if (!currentTools.includes(val)) {
              handleUpdateAgentProperty(selected, {
                tools: [...currentTools, val]
              })
            }
          }
        }}
        placeholder="Add tool..."
        themeStyles={themeStyles}
        triggerClassName="w-full"
      />
    </div>

    {/* Tool settings / fields */}
    {(agents[selected].tools || [])
      .filter(tName => toolFields[tName] && toolFields[tName].length > 0)
      .map(tName => (
        <div
          key={tName}
          className="flex flex-col gap-2 p-2.5 rounded-lg border mt-1"
          style={{ borderColor: themeStyles.border, background: 'rgba(255,255,255,0.02)' }}
        >
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: themeStyles.accent }}>
            {tName} Settings
          </span>
          <div className="flex flex-col gap-2">
            {toolFields[tName].map((field: any, idx: number) => {
              const fieldKey = `${tName}-${field.name}-${idx}-${field.value?.type ?? ''}-${JSON.stringify(field.value?.items ?? null)}-${field.value?.placeholder ?? ''}`;
              const currentValue = (agents[selected].toolValues?.[tName]?.[field.name]) ?? '';
              const type = field.value?.type;

              const updateValue = (val: any) => {
                const currentValues = agents[selected].toolValues || {};
                const toolVals = currentValues[tName] || {};
                const updatedValues = {
                  ...currentValues,
                  [tName]: {
                    ...toolVals,
                    [field.name]: val
                  }
                };
                handleUpdateAgentProperty(selected, { toolValues: updatedValues }, true);
              };

              return (
                <div key={fieldKey} className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold" style={{ color: themeStyles.mutedFg }}>
                    {field.name}
                  </label>
                  {type === 'enum' ? (
                    <SearchableDropdown
                      title={field.name}
                      options={field.value?.items || []}
                      value={currentValue}
                      onChange={(val) => updateValue(val)}
                      placeholder={field.value?.placeholder || "Select..."}
                      themeStyles={themeStyles}
                      triggerClassName="w-full"
                    />
                  ) : type?.startsWith('array:') ? (
                    <ArrayFieldEditor
                      value={currentValue}
                      onChange={updateValue}
                      type={type}
                      themeStyles={themeStyles}
                      items={field.value?.items}
                      placeholder={field.value?.placeholder}
                    />
                  ) : (type === 'folder' || type?.startsWith('folder:') || type === 'file' || type?.startsWith('file:')) ? (
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={currentValue}
                        onChange={(e) => updateValue(e.target.value)}
                        placeholder={field.value?.placeholder || (type.startsWith('file') ? "Select file..." : "Select folder...")}
                        className="flex-1 p-1.5 text-xs rounded border outline-none min-w-0"
                        style={{
                          background: themeStyles.muted,
                          borderColor: themeStyles.border,
                          color: themeStyles.accent
                        }}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const isFolder = type.startsWith('folder');
                          let extString: string | undefined;
                          if (type.startsWith('file:')) {
                            extString = type.slice('file:'.length);
                          }
                          const filters = getFiltersForExtensions(extString);
                          const selectedPath = await open({
                            directory: isFolder,
                            multiple: false,
                            filters
                          });
                          if (selectedPath && typeof selectedPath === 'string') {
                            updateValue(selectedPath);
                          }
                        }}
                        className="px-2 py-1.5 rounded border hover:opacity-90 flex items-center justify-center transition-all flex-shrink-0"
                        style={{
                          background: themeStyles.muted,
                          borderColor: themeStyles.border,
                          color: themeStyles.accent
                        }}
                        title={type.startsWith('file') ? "Browse file" : "Browse folder"}
                      >
                        {type.startsWith('file') ? <FileText size={12} /> : <FolderOpen size={12} />}
                      </button>
                    </div>
                  ) : type === 'number' ? (
                    <input
                      type="number"
                      value={currentValue}
                      onChange={(e) => updateValue(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder={field.value?.placeholder || ""}
                      className="p-1.5 text-xs rounded border outline-none"
                      style={{
                        background: themeStyles.muted,
                        borderColor: themeStyles.border,
                        color: themeStyles.accent
                      }}
                    />
                  ) : (
                    <input
                      type={type === 'email' ? 'email' : type === 'url' ? 'url' : 'text'}
                      value={currentValue}
                      onChange={(e) => updateValue(e.target.value)}
                      placeholder={field.value?.placeholder || ""}
                      className="p-1.5 text-xs rounded-lg border outline-none"
                      style={{
                        background: themeStyles.muted,
                        borderColor: themeStyles.border,
                        color: themeStyles.accent
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

    {/* Allow multiple toggle */}
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold flex items-center gap-1" style={{ color: themeStyles.mutedFg }}>
        <span>Allow Multiple</span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon size={12} />
            </TooltipTrigger>
            <TooltipContent>
              <p>Allow multiple children of this agent to run concurrently.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          id={`btn-allow-multiple-${selected}`}
          onClick={() => handleUpdateAgentProperty(selected, { allowMultiple: !agents[selected].allowMultiple })}
          className="relative w-9 h-5 rounded-full flex-shrink-0 transition-colors duration-200 focus:outline-none"
          style={{
            background: agents[selected].allowMultiple ? '#34d399' : themeStyles.muted,
            border: `1px solid ${agents[selected].allowMultiple ? '#34d399' : themeStyles.border}`,
          }}
        >
          <span
            className="absolute top-[1px] w-4 h-4 rounded-full shadow transition-all duration-200"
            style={{
              background: agents[selected].allowMultiple ? '#fff' : themeStyles.mutedFg,
              left: agents[selected].allowMultiple ? '17px' : '2px',
            }}
          />
        </button>
        <span className="text-xs" style={{ color: agents[selected].allowMultiple ? '#34d399' : themeStyles.mutedFg }}>
          {agents[selected].allowMultiple ? 'Active' : 'Idle'}
        </span>
      </div>
    </div>

    <div style={{ height: 1, background: themeStyles.border }} />

    <div className="flex flex-col gap-2">
      <button
        id="btn-sidebar-add-child"
        onClick={() => handleAddAgent(selected)}
        className="flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold hover:opacity-90 active:scale-[.98]"
        style={{
          background: themeStyles.accent,
          color: themeStyles.accentFg,
          transition: 'opacity 150ms, transform 150ms',
        }}
      >
        <Plus size={14} />
        Add Child Agent
      </button>

      {selected !== tabId && (
        <button
          id="btn-sidebar-delete-node"
          onClick={() => handleDeleteAgent(selected)}
          className="flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold hover:opacity-90 active:scale-[.98]"
          style={{
            border: '1px solid rgba(251,113,133,0.35)',
            background: 'rgba(251,113,133,0.08)',
            color: '#fb7185',
            transition: 'opacity 150ms, transform 150ms',
          }}
        >
          <Trash2 size={14} />
          Delete Agent Branch
        </button>
      )}
    </div>
  </div>
}

const parseFields = (content: string) => {
  try {
    const startIdx = content.indexOf('[');
    const endIdx = content.lastIndexOf(']');
    if (startIdx !== -1 && endIdx !== -1) {
      let arrayStr = content.substring(startIdx, endIdx + 1);
      arrayStr = arrayStr.replace(/\s+as\s+const\b/g, '');
      const fn = new Function(`return ${arrayStr}`);
      return fn();
    }
  } catch (e) {
    console.error('Failed to parse fields.ts:', e);
  }
  return [];
}

export function AgentNodeEditor({ pyInvoke, useActiveTabId, useTabDatabase, useWorkspace, useTab, tabId, appId }: AppInfo) {
  const { childrenProps } = useTab() ?? {};
  const initialName = childrenProps?.[appId]?.data?.name || "CEO";
  const snaptheme = useTheme()
  const isDark = snaptheme.theme === 'dark'
  const activeTabId = useActiveTabId()

  const INITIAL_AGENTS: Record<string, AgentNode> = {
    [tabId]: {
      id: tabId,
      name: initialName,
      tools: [],
      children: [],
      enableProgrammaticToolCalling: false,
      allowMultiple: false,
      toolValues: {},
      model: null
    }
  }

  //  Core state 
  const [agents, setAgents, { ready }] = useTabDatabase<Record<string, AgentNode>>("agents", { initialValue: INITIAL_AGENTS })
  const agentsRef = useRef(agents)
  agentsRef.current = agents
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>('1')
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null)
  const [runningAgents, setRunningAgents] = useState<Record<string, boolean>>({})
  const heartbeatTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  usePythonEvent("agent_heartbeat", (data: { agent_id: string }) => {
    const { agent_id } = data;
    if (!agent_id) return;

    setRunningAgents(prev => {
      if (prev[agent_id]) return prev;
      return { ...prev, [agent_id]: true };
    });

    if (heartbeatTimers.current[agent_id]) {
      clearTimeout(heartbeatTimers.current[agent_id]);
    }

    heartbeatTimers.current[agent_id] = setTimeout(() => {
      setRunningAgents(prev => {
        if (!prev[agent_id]) return prev;
        const updated = { ...prev };
        delete updated[agent_id];
        return updated;
      });
      delete heartbeatTimers.current[agent_id];
    }, 3000);
  });

  useEffect(() => {
    return () => {
      Object.values(heartbeatTimers.current).forEach(clearTimeout);
    };
  }, []);
  const [availableTools, setAvailableTools] = useState<{ name: string; description: string; source: 'internal' | 'mcp' }[]>([])

  const availableToolsRef = useRef(availableTools)
  availableToolsRef.current = availableTools

  const [tools] = useFolder('Tools')
  const toolsRef = useRef(tools)
  toolsRef.current = tools
  const [toolFields, setToolFields] = useState<Record<string, any[]>>({})
  const { models: availableModels, isLoading: modelsLoading } = useAvailableModels()
  const { workspace } = useWorkspace()
  const workspaceRef = useRef(workspace)
  workspaceRef.current = workspace


  useEffect(() => {
    const tabUpdate = (event: Event) => {
      const { tabId: targetTabId, title, icon } = (event as CustomEvent).detail;
      (async () => {
        if (workspaceRef.current && title && targetTabId && icon && targetTabId === tabId) {
          await pyInvoke('sqlite', {
            db: workspaceRef.current ?? "global",
            command: "execute",
            sql: `INSERT OR REPLACE INTO agents (id, metadata) VALUES (?, ?)`,
            params: [tabId, JSON.stringify({ name: title, icon: icon, timestamp: Date.now() })],
          })
        }
      })()
    };
    const codeBlockSaved = async (event: Event) => {
      const { codeId, code } = (event as CustomEvent).detail;
      if (codeId && typeof code === "string") {
        const _id = codeId.replace(/^editable\: /, "");
        const skillPath = agentsRef.current?.[_id]?.skillPath;
        if (skillPath) {
          const normalizedPath = skillPath.replace(/\\/g, '/');
          const pathParts = normalizedPath.split('/');
          let skillFilename = pathParts.pop() || '';
          const skillFolder = pathParts.join('/');
          await pyInvoke('file', {
            command: 'write',
            filename: skillFilename,
            base_dir: skillFolder,
            content: code,
          }) as any;
        }
      }
    }
    window.addEventListener('tab-update', tabUpdate);
    window.addEventListener('code-block-saved', codeBlockSaved)
    return () => {
      window.removeEventListener('tab-update', tabUpdate);
      window.removeEventListener('code-block-saved', codeBlockSaved)
    }
  }, [])

  useEffect(() => {
    if (ready && agents) {
      setAgents((prev) => {
        if (!prev) return prev
        const current = {} as Record<string, AgentNode>

        Object.keys(prev).forEach((key) => {
          const agent = prev[key]
          if (agent) {
            current[String(key)] = {
              ...agent,
              id: String(agent.id),
              children: Array.isArray(agent.children) ? agent.children.map(String) : [],
              tools: Array.isArray(agent.tools) ? agent.tools.map(String) : [],
            }
          }
        })

        Object.keys(current).forEach((key) => {
          current[key].children = current[key].children.filter(cid => current[cid] !== undefined)
        })

        historyRef.current = {
          stack: [JSON.parse(JSON.stringify(current))],
          index: 0
        }
        setHistoryIndex(0)
        setHistoryLength(1)
        return current;
      })
    }
  }, [ready])

  useEffect(() => {
    if (activeTabId == tabId) {
      MenuBar.appId = '';
    }
  }, [activeTabId])

  const [, setSetupModel] = useGlobal('setupModel', { initialValue: false });

  useEffect(() => {
    if (activeTabId == tabId && availableModels.length == 0 && !modelsLoading) {
      setSetupModel(true);
    }
  }, [activeTabId, availableModels, modelsLoading])

  const loadAllToolFields = async () => {
    try {
      const extendedRes = await pyInvoke('tools/list_extended') as any
      const allTools: any[] = extendedRes?.tools ?? []
      const newToolFields: Record<string, any[]> = {}
      for (const t of allTools) {
        if (Array.isArray(t.fields) && t.fields.length > 0) {
          newToolFields[t.name] = t.fields
        }
      }
      setToolFields(newToolFields)
    } catch (e) {
      console.error('Failed to load tool fields:', e)
    }
  }



  useEffect(() => {
    if (!availableTools || availableTools.length === 0) return
    loadAllToolFields()
  }, [availableTools, pyInvoke])


  const fetchTools = async () => {
    try {
      const [toolsRes, mcpToolsRes] = await Promise.all([
        pyInvoke('tools').catch(() => ({ tools: [] })),
        pyInvoke('mcp_tool').catch(() => ({ tools: [] }))
      ]) as [any, any]

      const list: typeof availableTools = []
      if (toolsRes && Array.isArray(toolsRes.tools)) {
        toolsRes.tools.forEach((t: any) => {
          if (t?.function?.name) {
            list.push({
              name: t.function.name,
              description: t.function.description || 'No description',
              source: 'internal'
            })
          }
        })
      }
      if (mcpToolsRes && Array.isArray(mcpToolsRes.tools)) {
        mcpToolsRes.tools.forEach((t: any) => {
          if (t?.function?.name) {
            list.push({
              name: t.function.name,
              description: t.function.description || 'No description',
              source: 'mcp'
            })
          }
        })
      }
      setAvailableTools(list)
      return list
    } catch (e) {
      console.error('Error fetching tools:', e)
      return null;
    }
  }

  usePythonEvent("tools_reloaded", async () => {
    const tools = await fetchTools()
    await loadAllToolFields()
    if (agentsRef.current && tools) {
      Object.entries(agentsRef.current).forEach(([key, value]) => {
        handleUpdateAgentProperty(key, {
          tools: value.tools.filter((t: any) => {
            return tools.some((at: any) => at.name === t)
          })
        })
      })
    }
  })

  useEffect(() => {
    fetchTools()
  }, [pyInvoke])

  //  Canvas view state 
  const [zoom, setZoom] = useState(1.0)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  //  Refs for real-time interaction 
  const panRef = useRef({ x: 0, y: 0 })
  const zoomRef = useRef(1.0)
  const isDraggingCanvas = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const mouseDownStart = useRef({ x: 0, y: 0 })
  const hasDragged = useRef(false)
  const rafId = useRef(0)
  const commitTimeout = useRef(0)
  const pendingFocusAgentIdRef = useRef<{ id: string; selectText: boolean } | null>(null)

  // DOM refs for direct transform updates
  const containerRef = useRef<HTMLDivElement>(null)
  const svgGroupRef = useRef<SVGGElement>(null)
  const agentLayerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const zoomLabelRef = useRef<HTMLDivElement>(null)

  //  Undo/Redo 
  const historyRef = useRef<{ stack: Record<string, AgentNode>[]; index: number }>({
    stack: [agents || INITIAL_AGENTS],
    index: 0,
  })
  const [historyIndex, setHistoryIndex] = useState(0)
  const [historyLength, setHistoryLength] = useState(1)
  const historyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [canvasDimensions, setCanvasDimensions] = useState({ width: 800, height: 600 })



  //  Layout computation (Reingold-Tilford) 
  const agentPositions = useMemo(() => {
    const allChildIds = new Set<string>()
    Object.values(agents || {}).forEach(a => a?.children?.forEach(c => allChildIds.add(String(c))))
    const roots = Object.keys(agents || {}).filter(id => !allChildIds.has(id))
    const primaryRoots = roots.length > 0 ? roots : (Object.keys(agents || {}).length > 0 ? [Object.keys(agents || {})[0]] : [])

    // ─── getVirtualAgent ───────────────────────────────────────────────────────
    // Sibling placeholders are NO LONGER included in children here.
    // They are injected into `positions` manually after layout so they never
    // affect centering calculations (which was causing the staircase).
    const getVirtualAgent = (id: string): AgentNode | undefined => {
      const agent = agents?.[String(id)]
      if (agent) {
        const children = (agent.children || []).length === 0
          ? [`placeholder-child-${id}`]
          : agent.children.map(String)   // ← sibling placeholder removed
        return { ...agent, children }
      }
      if (String(id).startsWith('placeholder-')) {
        return {
          id,
          name: '+',
          tools: [],
          children: [],
          toolValues: {},
          enableProgrammaticToolCalling: false,
          allowMultiple: false,
          model: null
        }
      }
      return undefined
    }

    const prelim: Record<string, number> = {}
    const modifier: Record<string, number> = {}
    const levels: Record<string, number> = {}

    function getContour(
      id: string, mod: number, isLeft: boolean,
      contour: Record<number, number>, level: number
    ) {
      const agent = getVirtualAgent(id)
      if (!agent) return
      const x = prelim[id] + mod
      if (contour[level] === undefined) {
        contour[level] = x
      } else {
        contour[level] = isLeft ? Math.min(contour[level], x) : Math.max(contour[level], x)
      }
      const childMod = mod + (modifier[id] || 0)
      for (const cid of agent.children) {
        getContour(cid, childMod, isLeft, contour, level + 1)
      }
    }

    function firstPass(id: string, level: number) {
      const agent = getVirtualAgent(id)
      if (!agent) return
      levels[id] = level
      modifier[id] = 0

      if (agent.children.length === 0) {
        prelim[id] = 0
        return
      }

      for (const cid of agent.children) {
        firstPass(cid, level + 1)
      }

      if (agent.children.length === 1) {
        prelim[id] = prelim[agent.children[0]]
        modifier[id] = 0
        return
      }

      const childShifts: Record<string, number> = {}
      childShifts[agent.children[0]] = 0

      for (let i = 1; i < agent.children.length; i++) {
        const leftSib = agent.children[i - 1]
        const rightChild = agent.children[i]

        const leftContour: Record<number, number> = {}
        getContour(leftSib, childShifts[leftSib], false, leftContour, level + 1)

        const rightContour: Record<number, number> = {}
        getContour(rightChild, 0, true, rightContour, level + 1)

        let maxOverlap = -Infinity
        const minLvl = Math.max(Math.min(...Object.keys(leftContour).map(Number)),
          Math.min(...Object.keys(rightContour).map(Number)))
        const maxLvl = Math.min(Math.max(...Object.keys(leftContour).map(Number)),
          Math.max(...Object.keys(rightContour).map(Number)))

        for (let lv = minLvl; lv <= maxLvl; lv++) {
          if (leftContour[lv] !== undefined && rightContour[lv] !== undefined) {
            const overlap = leftContour[lv] - rightContour[lv]
            maxOverlap = Math.max(maxOverlap, overlap)
          }
        }

        const minSep = CARD_W + SIBLING_SEP
        const shift = maxOverlap === -Infinity
          ? (childShifts[leftSib] + minSep)
          : (maxOverlap + minSep)
        childShifts[rightChild] = shift
      }

      for (const cid of agent.children) {
        applyShift(cid, childShifts[cid] || 0)
      }

      const firstChildX = prelim[agent.children[0]]
      const lastChildX = prelim[agent.children[agent.children.length - 1]]
      prelim[id] = (firstChildX + lastChildX) / 2
    }

    function applyShift(id: string, shift: number) {
      const agent = getVirtualAgent(id)
      if (!agent) return
      prelim[id] += shift
      for (const cid of agent.children) {
        applyShift(cid, shift)
      }
    }

    for (const rId of primaryRoots) {
      firstPass(rId, 0)
    }

    const positions: Record<string, { x: number; y: number; level: number, isOverlap: boolean }> = {}

    // ─── assignPositions ───────────────────────────────────────────────────────
    // Sibling placeholders never enter here (they're not in the virtual tree
    // anymore), so no special-case Y offset needed — removed.
    function assignPositions(id: string) {
      const agent = getVirtualAgent(id)
      if (!agent) return

      const y = 80 + levels[id] * LEVEL_HEIGHT   // ← flat, no sibling offset

      positions[id] = {
        x: prelim[id],
        y,
        level: levels[id],
        isOverlap: false
      }
      for (const cid of agent.children) assignPositions(cid)
    }

    for (const rId of primaryRoots) assignPositions(rId)

    // Center tree horizontally
    const allXs = Object.values(positions).map(p => p.x)
    const minX = Math.min(...allXs)
    const maxX = Math.max(...allXs)
    const treeWidth = maxX - minX + CARD_W
    const offsetX = Math.max((canvasDimensions.width - treeWidth) / 2, 50) - minX + CARD_HALF_W

    for (const id of Object.keys(positions)) {
      positions[id].x += offsetX
    }

    // ─── Inject sibling placeholders ──────────────────────────────────────────
    // Placed to the RIGHT of the RIGHTMOST CHILD at the CHILDREN'S Y-LEVEL,
    // never next to the parent itself. This means the root node (and any
    // parent) will never show a + button at its own row — the button appears
    // one level down, at the end of the siblings row.
    //
    // Overlap-safe: a per-level node index is built first; if the proposed
    // placeholder position would collide with any node from an adjacent
    // subtree at the same level it is omitted gracefully.

    const PLACEHOLDER_RADIUS = 16
    const SAFE_MARGIN = 8   // minimum gap (px) between placeholder edge and nearest card edge

    // Build a per-level spatial index for fast overlap detection
    const nodesByLevel: Record<number, Array<{ x: number; id: string }>> = {}
    for (const [nid, npos] of Object.entries(positions)) {
      const lvl = npos.level
      if (!nodesByLevel[lvl]) nodesByLevel[lvl] = []
      nodesByLevel[lvl].push({ x: npos.x, id: nid })
    }

    for (const agentId of Object.keys(agents || {})) {
      const agent = agents?.[agentId]
      if (!agent || !agent.children?.length) continue

      // Find the rightmost real child's position
      let rightmostX = -Infinity
      let childLevel = -1
      let childY = 0
      for (const cid of agent.children) {
        const cp = positions[String(cid)]
        if (!cp) continue
        if (cp.x > rightmostX) {
          rightmostX = cp.x
          childLevel = cp.level
          childY = cp.y
        }
      }
      if (rightmostX === -Infinity || childLevel < 0) continue

      // Proposed center: right-edge of rightmost child + gap + radius
      const placeholderX = rightmostX + CARD_HALF_W + SIBLING_SEP + PLACEHOLDER_RADIUS
      const placeholderLeftEdge = placeholderX - PLACEHOLDER_RADIUS
      const placeholderRightEdge = placeholderX + PLACEHOLDER_RADIUS

      // Overlap check: skip placeholder if it would intersect any node
      // at the same level that isn't one of our own children
      const ownChildIds = new Set(agent.children.map(String))
      const nodesAtLevel = nodesByLevel[childLevel] || []
      const hasOverlap = nodesAtLevel.some(({ x, id: nid }) => {
        if (ownChildIds.has(nid)) return false   // our own siblings — ignore
        const halfW = String(nid).startsWith('placeholder-') ? PLACEHOLDER_RADIUS : CARD_HALF_W
        const nodeLeft = x - halfW
        const nodeRight = x + halfW
        return (
          placeholderLeftEdge < nodeRight + SAFE_MARGIN &&
          placeholderRightEdge > nodeLeft - SAFE_MARGIN
        )
      })


      positions[agent.children[agent.children.length - 1]!].isOverlap = hasOverlap


      if (!hasOverlap) {
        positions[`placeholder-sibling-${agentId}`] = {
          x: placeholderX,
          y: childY,      // ← children's Y, not the parent's
          level: childLevel,
          isOverlap: false
        }
      }
    }
    return positions
  }, [agents, canvasDimensions]);

  //  Direct DOM transform update 
  const applyTransform = useCallback(() => {
    const p = panRef.current
    const z = zoomRef.current
    if (svgGroupRef.current) {
      svgGroupRef.current.setAttribute('transform', `translate(${p.x}, ${p.y}) scale(${z})`)
    }
    if (agentLayerRef.current) {
      agentLayerRef.current.style.transform = `translate(${p.x}px, ${p.y}px) scale(${z})`
    }
    if (gridRef.current) {
      gridRef.current.style.backgroundSize = `${32 * z}px ${32 * z}px`
      gridRef.current.style.backgroundPosition = `${p.x}px ${p.y}px`
    }
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `Zoom: ${Math.round(z * 100)}%`
    }
  }, [])

  useEffect(() => { panRef.current = pan }, [pan])
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  //  Track Canvas Resize 
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    if (rect.width && rect.height) {
      setCanvasDimensions({ width: rect.width, height: rect.height })
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width && height) {
          setCanvasDimensions({ width, height })
        }
      }
    })

    resizeObserver.observe(el)
    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  //  Pan/focus view helper 
  const panToAgent = useCallback((agentId: string) => {
    const pos = agentPositions[agentId]
    if (!pos || !containerRef.current) return
    const z = zoomRef.current
    const rect = containerRef.current.getBoundingClientRect()
    const width = rect.width || canvasDimensions.width
    const height = rect.height || canvasDimensions.height
    const newPan = {
      x: width / 2 - pos.x * z,
      y: height / 2 - pos.y * z
    }

    if (agentLayerRef.current) {
      agentLayerRef.current.style.transition = 'transform 350ms cubic-bezier(0.16, 1, 0.3, 1)'
    }
    if (svgGroupRef.current) {
      svgGroupRef.current.style.transition = 'transform 350ms cubic-bezier(0.16, 1, 0.3, 1)'
    }
    if (gridRef.current) {
      gridRef.current.style.transition = 'background-position 350ms cubic-bezier(0.16, 1, 0.3, 1)'
    }

    panRef.current = newPan
    setPan(newPan)
    applyTransform()

    setTimeout(() => {
      if (agentLayerRef.current) agentLayerRef.current.style.transition = ''
      if (svgGroupRef.current) svgGroupRef.current.style.transition = ''
      if (gridRef.current) gridRef.current.style.transition = ''
    }, 350)
  }, [agentPositions, canvasDimensions, applyTransform])

  useEffect(() => {
    if (pendingFocusAgentIdRef.current) {
      const { id, selectText } = pendingFocusAgentIdRef.current
      if (agentPositions[id]) {
        pendingFocusAgentIdRef.current = null
        panToAgent(id)

        if (selectText) {
          setTimeout(() => {
            const input = document.getElementById('input-agent-name')
            if (input) {
              (input as HTMLInputElement).select()
            }
          }, 150)
        }
      }
    }
  }, [agentPositions, panToAgent])

  //  Native wheel listener 
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const z = zoomRef.current
      const step = 0.05
      const raw = e.deltaY < 0 ? z + step : z - step
      const newZ = parseFloat(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw)).toFixed(2))
      const ratio = newZ / z

      panRef.current = {
        x: mouseX - (mouseX - panRef.current.x) * ratio,
        y: mouseY - (mouseY - panRef.current.y) * ratio
      }
      zoomRef.current = newZ

      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(applyTransform)

      clearTimeout(commitTimeout.current)
      commitTimeout.current = window.setTimeout(() => {
        setPan({ ...panRef.current })
        setZoom(zoomRef.current)
      }, 120)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyTransform])

  //  History helpers 

  const pushHistory = useCallback((newAgents: Record<string, AgentNode>) => {
    const h = historyRef.current
    const current = h.stack[h.index]
    if (current && JSON.stringify(current) === JSON.stringify(newAgents)) return
    const stack = h.stack.slice(0, h.index + 1)
    stack.push(newAgents)
    if (stack.length > MAX_HISTORY) stack.shift()
    const newIndex = stack.length - 1
    h.stack = stack
    h.index = newIndex
    setHistoryIndex(newIndex)
    setHistoryLength(stack.length)
  }, [])

  const pushHistoryDebounced = useCallback((newAgents: Record<string, AgentNode>) => {
    if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current)
    historyDebounceRef.current = setTimeout(() => {
      pushHistory(newAgents)
    }, 600)
  }, [pushHistory])

  const findChangedAgentId = useCallback((
    from: Record<string, AgentNode>,
    to: Record<string, AgentNode>
  ): string | null => {
    const fromIds = new Set(Object.keys(from))
    const toIds = new Set(Object.keys(to))
    for (const id of toIds) {
      if (!fromIds.has(id)) return id
    }
    for (const id of fromIds) {
      if (!toIds.has(id)) {
        for (const [pid, a] of Object.entries(to)) {
          if (a.children.includes(id) || from[id] && Object.values(to).some(a => a.children.includes(id))) {
            return pid
          }
        }
        return null
      }
    }
    for (const id of toIds) {
      if (JSON.stringify(from[id]) !== JSON.stringify(to[id])) return id
    }
    return null
  }, [])

  const handleUndo = useCallback(() => {
    const h = historyRef.current
    if (historyDebounceRef.current) {
      clearTimeout(historyDebounceRef.current)
      historyDebounceRef.current = null
    }
    if (h.index <= 0) return
    const prevSnapshot = h.stack[h.index]
    h.index -= 1
    const snapshot = h.stack[h.index]
    setHistoryIndex(h.index)
    setAgents(snapshot)
    const changedId = findChangedAgentId(snapshot, prevSnapshot)
    if (changedId && snapshot[changedId]) {
      setSelectedAgentId(changedId)
      pendingFocusAgentIdRef.current = { id: changedId, selectText: false }
    }
  }, [findChangedAgentId])

  const handleRedo = useCallback(() => {
    const h = historyRef.current
    if (h.index >= h.stack.length - 1) return
    const prevSnapshot = h.stack[h.index]
    h.index += 1
    const snapshot = h.stack[h.index]
    setHistoryIndex(h.index)
    setHistoryLength(h.stack.length)
    setAgents(snapshot)
    const changedId = findChangedAgentId(prevSnapshot, snapshot)
    if (changedId && snapshot[changedId]) {
      setSelectedAgentId(changedId)
      pendingFocusAgentIdRef.current = { id: changedId, selectText: false }
    }
  }, [findChangedAgentId])


  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault()
        handleRedo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleUndo, handleRedo])

  //  Toolbar zoom 
  const adjustZoom = useCallback((zoomIn: boolean) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = rect.width / 2, cy = rect.height / 2
    const step = 0.1
    const raw = zoomIn ? zoom + step : zoom - step
    const newZ = parseFloat(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw)).toFixed(2))
    const ratio = newZ / zoom
    const newPan = { x: cx - (cx - pan.x) * ratio, y: cy - (cy - pan.y) * ratio }
    setPan(newPan)
    setZoom(newZ)
    panRef.current = newPan
    zoomRef.current = newZ
  }, [zoom, pan])

  //  Pan interaction 
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.node-card') || target.closest('.ui-control')) return
    isDraggingCanvas.current = true
    dragStart.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y }
    mouseDownStart.current = { x: e.clientX, y: e.clientY }
    hasDragged.current = false
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingCanvas.current) return
    const dx = e.clientX - mouseDownStart.current.x
    const dy = e.clientY - mouseDownStart.current.y
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasDragged.current = true
    }
    panRef.current = {
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    }
    cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(applyTransform)
  }, [applyTransform])

  const handleMouseUp = useCallback(() => {
    if (!isDraggingCanvas.current) return
    isDraggingCanvas.current = false
    setPan({ ...panRef.current })
  }, [])

  const fitView = useCallback(() => {
    setZoom(1.0)
    setPan({ x: 0, y: 0 })
    panRef.current = { x: 0, y: 0 }
    zoomRef.current = 1.0
    cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(applyTransform)
  }, [applyTransform])

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (hasDragged.current) return
    const target = e.target as HTMLElement
    if (target.closest('.node-card') || target.closest('.ui-control')) return
    setSelectedAgentId(null)
  }, [])

  //  Agent CRUD 
  const handleAddAgent = useCallback((parentId: string) => {
    const newId = uuidv4()
    const newAgent: AgentNode = {
      id: newId,
      name: 'New Agent',
      tools: [],
      children: [],
      toolValues: {},
      enableProgrammaticToolCalling: false,
      allowMultiple: false,
      model: null
    }
    pendingFocusAgentIdRef.current = { id: newId, selectText: true }
    setAgents(prev => {
      const updated = {
        ...prev,
        [newId]: newAgent,
        [parentId]: { ...prev[parentId], children: [...prev[parentId].children.map(String), newId] }
      }
      pushHistory(updated)
      return updated
    })
    setSelectedAgentId(newId)
  }, [pushHistory])

  const handleDeleteAgent = useCallback((idToDelete: string) => {
    if (idToDelete === tabId) return

    const agentToDelete = agents[idToDelete]
    if (agentToDelete && agentToDelete.children.length > 0) {
      const confirmed = window.confirm('Are you sure you want to delete this agent and all of its sub-branches?')
      if (!confirmed) return
    }

    let parentId: string | null = null
    for (const [id, a] of Object.entries(agents)) {
      if (a.children.map(String).includes(String(idToDelete))) {
        parentId = id
        break
      }
    }

    setAgents(prev => {
      const updated = { ...prev }
      delete updated[idToDelete]
      Object.keys(updated).forEach(id => {
        if (updated[id].children.map(String).includes(String(idToDelete))) {
          updated[id] = { ...updated[id], children: updated[id].children.map(String).filter(c => c !== String(idToDelete)) }
        }
      })
      const removeSubtree = (id: string) => {
        const a = prev[id]
        if (!a) return
        for (const cid of a.children) { delete updated[String(cid)]; removeSubtree(String(cid)) }
      }
      removeSubtree(idToDelete)
      pushHistory(updated)
      return updated
    })

    if (parentId) {
      setSelectedAgentId(parentId)
      pendingFocusAgentIdRef.current = { id: parentId, selectText: false }
    } else {
      setSelectedAgentId(null)
    }
  }, [agents, pushHistory, panToAgent])

  const handleUpdateAgentProperty = useCallback((id: string, fields: Partial<AgentNode>, isTextField = false) => {
    setAgents(prev => {
      const updated = { ...prev, [id]: { ...prev[id], ...fields } }
      if (isTextField) {
        pushHistoryDebounced(updated)
      } else {
        pushHistory(updated)
      }
      return updated
    })
  }, [pushHistory, pushHistoryDebounced])

  const handleAgentSelect = useCallback((id: string) => setSelectedAgentId(id), [])
  const handleAgentHover = useCallback((id: string | null) => setHoveredAgentId(id), [])

  //  Highlight subtree on hover 
  const highlightedAgentSubtreeIds = useMemo(() => {
    const ids = new Set<string>()
    if (!hoveredAgentId) return ids
    const collect = (id: string) => {
      ids.add(id)
      const agent = agents[id]
      if (agent) agent.children.forEach(collect)
    }
    collect(hoveredAgentId)
    return ids
  }, [hoveredAgentId, agents])

  const runningSubtreeAgentIds = useMemo(() => {
    const ids = new Set<string>()
    const runningIds = Object.keys(agents).filter(id => runningAgents[id])
    if (runningIds.length === 0) return ids

    const parentOf: Record<string, string> = {}
    for (const [pid, a] of Object.entries(agents)) {
      for (const cid of a.children) {
        parentOf[String(cid)] = pid
      }
    }

    for (const rid of runningIds) {
      let cur: string | undefined = rid
      while (cur) {
        ids.add(cur)
        cur = parentOf[cur]
      }
    }
    return ids
  }, [agents, runningAgents])

  //  Memoised theme styles 
  const themeStyles = useMemo(() => ({
    canvasBg: 'hsl(var(--bg))',
    cardBg: 'hsl(var(--card))',
    border: 'hsl(var(--border))',
    accent: 'hsl(var(--accent))',
    accentFg: 'hsl(var(--accent-foreground))',
    muted: 'hsl(var(--float))',
    mutedFg: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)',
    toolbarBg: isDark ? 'rgba(18,18,18,0.92)' : 'rgba(255,255,255,0.92)',
    lineBase: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    lineHover: 'hsl(var(--accent))',
    lineGlowHover: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)',
    gridDot: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)',
    selectedRing: 'hsl(var(--accent))',
    selectedBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
  }), [isDark])

  // ─── connectorData ─────────────────────────────────────────────────────────
  // Changes vs. original:
  //   1. Sibling placeholder removed from virtualChildren (no staircase).
  //   2. A short horizontal stub line is drawn from the card's right edge to
  //      the sibling placeholder circle (replaces the old diagonal path).
  //   3. childHalfH no longer has a special branch for sibling placeholders.
  const connectorData = useMemo(() => {
    const result: { parentId: string; d: string }[] = []
    const agentIds = Object.keys(agents)

    for (const parentId of agentIds) {
      const parentPos = agentPositions[parentId]
      const parentAgent = agents[parentId]
      if (!parentPos || !parentAgent) continue

      // ── Horizontal stub to sibling placeholder ────────────────────────────
      // Fixed: Draw the line from the last child's right edge to the sibling placeholder
      if (parentAgent.children.length > 0) {
        const sibPos = agentPositions[`placeholder-sibling-${parentId}`]
        const lastChildId = String(parentAgent.children[parentAgent.children.length - 1])
        const lastChildPos = agentPositions[lastChildId]

        if (sibPos && lastChildPos) {
          // Line from right edge of last child card → left edge of placeholder circle
          result.push({
            parentId: `${parentId}-sib`,
            d: `M ${lastChildPos.x + CARD_HALF_W} ${sibPos.y} L ${sibPos.x - 16} ${sibPos.y}`
          })
        }
      }

      // ── Vertical tree connectors (trunk + bus + branches) ─────────────────
      // Sibling placeholder is intentionally excluded — only real children
      // and the child-placeholder (for leaf nodes) participate in the layout.
      const virtualChildren = parentAgent.children.length === 0
        ? [`placeholder-child-${parentId}`]
        : parentAgent.children.map(String)

      const childPosArr: { id: string; x: number; y: number }[] = []
      for (const cid of virtualChildren) {
        const cp = agentPositions[cid]
        if (cp) childPosArr.push({ id: cid, ...cp })
      }
      if (childPosArr.length === 0) continue

      const parentBottomX = parentPos.x
      const parentBottomY = parentPos.y + CARD_HALF_H
      const childTopYStandard = childPosArr[0].y - CARD_HALF_H
      const busY = parentBottomY + (childTopYStandard - parentBottomY) / 2

      let d = `M ${parentBottomX} ${parentBottomY} L ${parentBottomX} ${busY}`

      if (childPosArr.length > 1) {
        const leftX = Math.min(...childPosArr.map(c => c.x))
        const rightX = Math.max(...childPosArr.map(c => c.x))
        d += ` M ${leftX} ${busY} L ${rightX} ${busY}`
      }

      for (const cp of childPosArr) {
        const isPlaceholder = String(cp.id).startsWith('placeholder-')
        const childHalfH = isPlaceholder ? 16 : CARD_HALF_H
        const childTopY = cp.y - childHalfH
        d += ` M ${cp.x} ${busY} L ${cp.x} ${childTopY}`
      }

      result.push({ parentId, d })
    }
    return result
  }, [agents, agentPositions])

  // ─── connectorSegments ─────────────────────────────────────────────────────
  // Same virtualChildren fix: sibling placeholder excluded.
  const connectorSegments = useMemo(() => {
    const segments: {
      key: string
      d: string
      totalLength: number
    }[] = []

    const runningIds = Object.keys(agents).filter(id => runningAgents[id])
    if (runningIds.length === 0) return segments

    const agentIds = Object.keys(agents)
    for (const parentId of agentIds) {
      const parentPos = agentPositions[parentId]
      const parentAgent = agents[parentId]
      if (!parentPos || !parentAgent) continue

      const virtualChildren = parentAgent.children.length === 0
        ? [`placeholder-child-${parentId}`]
        : parentAgent.children.map(String)   // ← sibling placeholder excluded

      const childPosArr: { id: string; x: number; y: number }[] = []
      for (const cid of virtualChildren) {
        const cp = agentPositions[cid]
        if (cp) childPosArr.push({ id: cid, ...cp })
      }
      if (childPosArr.length === 0) continue

      const parentBottomX = parentPos.x
      const parentBottomY = parentPos.y + CARD_HALF_H
      const childTopYStandard = childPosArr[0].y - CARD_HALF_H
      const busY = parentBottomY + (childTopYStandard - parentBottomY) / 2

      const isTrunkRunning = childPosArr.some(c => !String(c.id).startsWith('placeholder-') && runningSubtreeAgentIds.has(String(c.id)))
      if (isTrunkRunning) {
        const trunkD = `M ${parentBottomX} ${parentBottomY} L ${parentBottomX} ${busY}`
        const trunkLen = Math.abs(busY - parentBottomY)
        segments.push({
          key: `trunk-${parentId}`,
          d: trunkD,
          totalLength: trunkLen
        })
      }

      for (const cp of childPosArr) {
        const isPlaceholder = String(cp.id).startsWith('placeholder-')
        const isBranchRunning = !isPlaceholder && runningSubtreeAgentIds.has(String(cp.id))
        if (isBranchRunning) {
          const childHalfH = CARD_HALF_H
          const childTopY = cp.y - childHalfH

          const branchD = `M ${cp.x} ${busY} L ${cp.x} ${childTopY}`
          const branchLen = Math.abs(childTopY - busY)
          segments.push({
            key: `branch-${parentId}-${cp.id}`,
            d: branchD,
            totalLength: branchLen
          })
        }
      }

      const xPoints = Array.from(new Set([parentBottomX, ...childPosArr.map(c => c.x)])).sort((a, b) => a - b)
      for (let i = 0; i < xPoints.length - 1; i++) {
        const x1 = xPoints[i]
        const x2 = xPoints[i + 1]

        const horizLen = x2 - x1
        let horizD = `M ${x1} ${busY} L ${x2} ${busY}`
        let isHorizRunning = false

        if (x2 <= parentBottomX) {
          horizD = `M ${x2} ${busY} L ${x1} ${busY}`
          isHorizRunning = childPosArr.some(c => c.x <= x1 && !String(c.id).startsWith('placeholder-') && runningSubtreeAgentIds.has(String(c.id)))
        } else if (x1 >= parentBottomX) {
          horizD = `M ${x1} ${busY} L ${x2} ${busY}`
          isHorizRunning = childPosArr.some(c => c.x >= x2 && !String(c.id).startsWith('placeholder-') && runningSubtreeAgentIds.has(String(c.id)))
        }

        if (isHorizRunning) {
          segments.push({
            key: `horiz-${parentId}-${x1}-${x2}`,
            d: horizD,
            totalLength: horizLen
          })
        }
      }
    }
    return segments
  }, [agents, agentPositions, runningSubtreeAgentIds, runningAgents])

  //  Render 
  return (
    <div
      className="w-full h-full flex overflow-hidden select-none"
      style={{ background: themeStyles.canvasBg, color: 'hsl(var(--accent))' }}
    >
      {/*  Canvas  */}
      <div
        ref={containerRef}
        id="canvas-container"
        className="flex-1 h-full relative overflow-hidden cursor-grab active:cursor-grabbing"
        style={{ background: themeStyles.canvasBg }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleCanvasClick}
      >
        {/* Grid dot pattern */}
        <div
          ref={gridRef}
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(${isDark ? 255 : 0},${isDark ? 255 : 0},${isDark ? 255 : 0}, ${0.07 * zoom}) 1px, transparent 0)`,
            backgroundSize: `${32 * zoom}px ${32 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
            willChange: 'background-size, background-position',
          }}
        />

        {/* SVG Connection Layer */}
        <svg
          className="absolute inset-0 pointer-events-none z-10"
          style={{ width: '100%', height: '100%' }}
        >
          <g
            ref={svgGroupRef}
            transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
          >
            {/* Base static background lines */}
            {connectorData.map(({ parentId, d }) => (
              <path
                key={`base-${parentId}`}
                d={d} fill="none"
                stroke={themeStyles.lineBase}
                strokeWidth={1.5}
                strokeLinecap="round"
                style={{
                  transition: 'd 350ms cubic-bezier(0.16, 1, 0.3, 1), stroke 300ms ease-out, stroke-width 300ms ease-out'
                }}
              />
            ))}

            {/* Active running lines & dash flow animations */}
            {connectorSegments.map(({ key, d, totalLength }) => {
              const dashLen = 10
              const gapLen = 10

              return (
                <g key={`active-${key}`}>
                  <path
                    d={d} fill="none"
                    stroke="#34d39940"
                    strokeWidth={8}
                    strokeLinecap="round"
                    style={{
                      transition: 'd 350ms cubic-bezier(0.16, 1, 0.3, 1), stroke 300ms ease-out, stroke-width 300ms ease-out'
                    }}
                  />
                  <path
                    d={d} fill="none"
                    stroke="#34d39966"
                    strokeWidth={2}
                    strokeLinecap="round"
                    style={{
                      transition: 'd 350ms cubic-bezier(0.16, 1, 0.3, 1), stroke 300ms ease-out, stroke-width 300ms ease-out'
                    }}
                  />
                  <path
                    d={d} fill="none"
                    stroke="#34d399"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeDasharray={`${dashLen} ${gapLen}`}
                    strokeDashoffset={0}
                    style={{
                      transition: 'd 350ms cubic-bezier(0.16, 1, 0.3, 1)',
                      animation: `flowDash 1s linear infinite`,
                      ['--path-len' as any]: totalLength,
                    }}
                  />
                </g>
              )
            })}
          </g>
        </svg>

        {/* Node Element Layer */}
        <div
          ref={agentLayerRef}
          className="absolute inset-0 pointer-events-none z-20 origin-top-left"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            willChange: 'transform',
          }}
        >
          {Object.keys(agentPositions).map(id => {
            const pos = agentPositions[id]
            if (!pos) return null

            const isPlaceholder = String(id).startsWith('placeholder-')
            if (isPlaceholder) {
              const parentId = id.replace('placeholder-child-', '').replace('placeholder-sibling-', '')
              return (
                <PlaceholderAgent
                  key={id}
                  id={id}
                  posX={pos.x}
                  posY={pos.y}
                  isDark={isDark}
                  onClick={() => handleAddAgent(parentId)}
                />
              )
            }

            const agent = agents[id]
            if (!agent) return null
            return (
              <AgentCard
                key={id}
                tabId={tabId}
                id={id}
                agent={agent}
                posX={pos.x}
                posY={pos.y}
                isSelected={selectedAgentId === id}
                isHovered={hoveredAgentId === id}
                isPathHighlight={highlightedAgentSubtreeIds.has(id)}
                isRunningPath={runningSubtreeAgentIds.has(id)}
                isRunning={!!runningAgents[id]}
                isDark={isDark}
                isOverlap={pos.isOverlap}
                onSelect={handleAgentSelect}
                onHover={handleAgentHover}
                onDelete={handleDeleteAgent}
                onAdd={() => {
                  let parentId = null
                  Object.keys(agents).map(key => {
                    if (agents[key].children?.filter(child => child === id).length > 0) {
                      parentId = key
                    }
                  })
                  if (parentId) handleAddAgent(parentId)
                }}
              />
            )
          })}
        </div>

        {/* Canvas Toolbar */}
        <div
          id="canvas-toolbar"
          className="ui-control absolute top-4 left-4 z-30 flex items-center gap-1 p-1 rounded-xl shadow-lg backdrop-blur-md border"
          style={{ background: themeStyles.toolbarBg, borderColor: themeStyles.border }}
        >
          <button
            id="btn-zoom-in"
            onClick={() => adjustZoom(true)}
            className="p-2 rounded-lg transition-colors"
            style={{ color: themeStyles.mutedFg }}
            onMouseEnter={(e) => (e.currentTarget.style.color = themeStyles.accent)}
            onMouseLeave={(e) => (e.currentTarget.style.color = themeStyles.mutedFg)}
            title="Zoom In"
          >
            <ZoomIn size={16} />
          </button>
          <button
            id="btn-zoom-out"
            onClick={() => adjustZoom(false)}
            className="p-2 rounded-lg transition-colors"
            style={{ color: themeStyles.mutedFg }}
            onMouseEnter={(e) => (e.currentTarget.style.color = themeStyles.accent)}
            onMouseLeave={(e) => (e.currentTarget.style.color = themeStyles.mutedFg)}
            title="Zoom Out"
          >
            <ZoomOut size={16} />
          </button>
          <button
            id="btn-fit-view"
            onClick={() => {
              fitView();
              console.log(agents)
            }}
            className="p-2 rounded-lg transition-colors"
            style={{ color: themeStyles.mutedFg }}
            onMouseEnter={(e) => (e.currentTarget.style.color = themeStyles.accent)}
            onMouseLeave={(e) => (e.currentTarget.style.color = themeStyles.mutedFg)}
            title="Recenter & Fit View"
          >
            <Maximize2 size={16} />
          </button>

          <div className="w-px h-6 mx-1" style={{ background: themeStyles.border }} />

          <button
            id="btn-undo"
            onClick={handleUndo}
            disabled={historyIndex === 0}
            className="p-2 rounded-lg transition-colors disabled:opacity-40"
            style={{ color: themeStyles.mutedFg }}
            onMouseEnter={(e) => { if (historyIndex > 0) e.currentTarget.style.color = themeStyles.accent }}
            onMouseLeave={(e) => (e.currentTarget.style.color = themeStyles.mutedFg)}
            title={`Undo (Ctrl+Z) — ${historyIndex} step${historyIndex !== 1 ? 's' : ''}`}
          >
            <Undo2 size={16} />
          </button>
          <button
            id="btn-redo"
            onClick={handleRedo}
            disabled={historyIndex >= historyLength - 1}
            className="p-2 rounded-lg transition-colors disabled:opacity-40"
            style={{ color: themeStyles.mutedFg }}
            onMouseEnter={(e) => { if (historyIndex < historyLength - 1) e.currentTarget.style.color = themeStyles.accent }}
            onMouseLeave={(e) => (e.currentTarget.style.color = themeStyles.mutedFg)}
            title={`Redo (Ctrl+Shift+Z) — ${historyLength - 1 - historyIndex} step${historyLength - 1 - historyIndex !== 1 ? 's' : ''} ahead`}
          >
            <Redo2 size={16} />
          </button>
        </div>
      </div>

      {/*  Editor Sidebar Panel  */}
      <div
        id="editor-sidebar"
        className="w-80 h-full flex flex-col justify-between shadow-xl overflow-y-auto"
        style={{ background: themeStyles.cardBg, borderLeft: `1px solid ${themeStyles.border}` }}
      >
        <div className="flex flex-col gap-6 p-5">

          {selectedAgentId && agents[selectedAgentId] ? (
            <AgentEditor
              pyInvoke={pyInvoke}
              availableModels={availableModels}
              modelsLoading={modelsLoading}
              selected={selectedAgentId}
              agents={agents}
              handleUpdateAgentProperty={handleUpdateAgentProperty}
              handleAddAgent={handleAddAgent}
              handleDeleteAgent={handleDeleteAgent}
              themeStyles={themeStyles}
              availableTools={availableTools}
              toolFields={toolFields}
              tabId={tabId}
            />
          ) : (
            <div
              className="flex flex-col items-center justify-center py-10 text-center gap-2"
              style={{ color: themeStyles.mutedFg }}
            >
              <Info size={28} style={{ opacity: 0.4 }} />
              <p className="text-xs">Select an agent on the canvas to edit its properties.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}