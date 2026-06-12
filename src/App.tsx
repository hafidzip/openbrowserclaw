import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import {
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Undo2,
  Redo2,
  RotateCcw,
  Check,
  Info,
  Play,
  Pause,
  Square
} from 'lucide-react'
import { ref, useFolder, useTheme, type AppInfo } from 'openchad-react'
import clsx from 'clsx'
import { MenuBar } from 'openchad-react/utils/state'

//  Types 

interface AgentNode {
  id: string
  name: string
  tools: string[]
  children: string[]
  color: AgentColor
  toolValues?: Record<string, Record<string, any>>
}

type AgentColor = 'blue' | 'green' | 'rose' | 'amber' | 'neutral'

//  Constants 

const MAX_HISTORY = 50
const LEVEL_HEIGHT = 110
const SIBLING_SEP = 24     // horizontal gap between adjacent siblings
const CARD_W = 176         // w-44 = 176px
const CARD_H = 52
const CARD_HALF_W = CARD_W / 2
const CARD_HALF_H = CARD_H / 2
const ZOOM_MIN = 0.4
const ZOOM_MAX = 2.0

const INITIAL_AGENTS: Record<string, AgentNode> = {
  '1': {
    id: '1',
    name: 'CEO',
    tools: [],
    children: [],
    color: 'neutral'
  }
}

const COLOR_DOT: Record<AgentColor, string> = {
  blue: '#60a5fa',
  green: '#34d399',
  rose: '#fb7185',
  amber: '#fbbf24',
  neutral: 'hsl(var(--accent))',
}

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

//  Array Field Editor for Tool Settings 

interface ArrayFieldEditorProps {
  value: any
  onChange: (val: any) => void
  type: string
  themeStyles: any
  items?: string[]
}

const ArrayFieldEditor = React.memo(function ArrayFieldEditor({
  value,
  onChange,
  type,
  themeStyles,
  items
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
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-all"
                style={{
                  background: isEditing ? themeStyles.muted : 'rgba(255,255,255,0.04)',
                  borderColor: themeStyles.border,
                  color: themeStyles.accent
                }}
              >
                {isEditing ? (
                  isEnum ? (
                    <select
                      value={editingValue}
                      autoFocus
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit();
                        if (e.key === 'Escape') setEditingIdx(null);
                      }}
                      className="bg-transparent border-none outline-none text-[10px] p-0 font-semibold"
                      style={{ color: themeStyles.accent, background: themeStyles.muted }}
                    >
                      {(items || []).map((opt) => (
                        <option key={opt} value={opt} style={{ background: themeStyles.cardBg, color: themeStyles.accent }}>{opt}</option>
                      ))}
                    </select>
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
                      className="bg-transparent border-none outline-none w-16 text-[10px] p-0 font-semibold"
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
          <select
            value={inputValue}
            onChange={(e) => {
              const val = e.target.value;
              if (val) {
                onChange([...list, val]);
                setInputValue('');
              }
            }}
            className="flex-1 px-2 py-1 text-xs rounded border outline-none"
            style={{
              background: themeStyles.muted,
              borderColor: themeStyles.border,
              color: themeStyles.accent
            }}
          >
            <option value="">Add item...</option>
            {(items || []).map((opt) => (
              <option key={opt} value={opt} style={{ background: themeStyles.cardBg, color: themeStyles.accent }}>{opt}</option>
            ))}
          </select>
        ) : (
          <>
            <input
              type={type === 'array:number' ? 'number' : 'text'}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Add item… (Press Enter)"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              className="flex-1 px-2 py-1 text-xs rounded border outline-none"
              style={{
                background: themeStyles.muted,
                borderColor: themeStyles.border,
                color: themeStyles.accent
              }}
            />
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
  accentColor: string
  isDark: boolean
  onClick: () => void
}

const PlaceholderAgent = React.memo(function PlaceholderAgent({
  id, posX, posY, accentColor, isDark, onClick
}: PlaceholderAgentProps) {
  const [hovered, setHovered] = useState(false)
  const border = 'hsl(var(--border))'
  const cardBg = 'hsl(var(--card))'
  const size = 32
  const halfSize = size / 2

  return (
    <div
      id={id}
      className="placeholder-node absolute pointer-events-auto flex items-center justify-center rounded-full border border-dashed cursor-pointer shadow-sm hover:shadow-md hover:scale-110 active:scale-95"
      style={{
        width: size,
        height: size,
        left: posX - halfSize,
        top: posY - halfSize,
        background: hovered ? `${accentColor}18` : cardBg,
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
  agent: AgentNode
  posX: number
  posY: number
  isSelected: boolean
  isHovered: boolean
  isPathHighlight: boolean
  isDark: boolean
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onDelete: (id: string) => void
}

const AgentCard = React.memo(function AgentCard({
  id, agent, posX, posY, isSelected, isHovered, isPathHighlight, isDark,
  onSelect, onHover, onDelete
}: AgentCardProps) {
  const dotColor = COLOR_DOT[agent.color || 'neutral']
  const mutedFg = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)'
  const cardBg = 'hsl(var(--card))'
  const border = 'hsl(var(--border))'

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
        borderColor: isSelected
          ? dotColor
          : isHovered || isPathHighlight
            ? dotColor + '80'
            : border,
        boxShadow: isSelected
          ? `0 0 0 2px ${dotColor}, 0 4px 20px rgba(0,0,0,0.15)`
          : isHovered
            ? '0 4px 20px rgba(0,0,0,0.12)'
            : 'none',
        transform: isSelected ? 'scale(1.03)' : isHovered ? 'scale(1.015)' : 'scale(1)',
        transition: 'left 350ms cubic-bezier(0.16, 1, 0.3, 1), top 350ms cubic-bezier(0.16, 1, 0.3, 1), border-color 200ms ease-out, box-shadow 200ms ease-out, transform 200ms ease-out, background 200ms ease-out',
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(id) }}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex-1 flex justify-center items-center gap-1.5 min-w-0">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dotColor }} />
          <span
            className="text-[10px] font-mono tracking-wider font-bold uppercase truncate block min-w-0"
            style={{ color: mutedFg }}
          >
            {agent.name}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {id !== '1' && (
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

interface AgentEditorProps {
  selected: string
  agents: Record<string, AgentNode>
  handleUpdateAgentProperty: (id: string, fields: Partial<AgentNode>, isTextField?: boolean) => void
  availableTools: { name: string; description: string; source: 'internal' | 'mcp' }[]
  handleAddAgent: (parentId: string) => void
  handleDeleteAgent: (idToDelete: string) => void
  themeStyles: any
  toolFields: Record<string, any[]>
}

const AgentEditor = ({
  selected,
  agents,
  handleUpdateAgentProperty,
  availableTools,
  handleAddAgent,
  handleDeleteAgent,
  themeStyles,
  toolFields
}: AgentEditorProps) => {
  const snaptheme = useTheme()
  const isDark = snaptheme.theme === 'dark'

  return <div className="flex flex-col gap-4">
    <div>
      <span
        className="text-[10px] font-mono font-bold tracking-wider uppercase"
        style={{ color: themeStyles.mutedFg }}
      >
        Selected Agent Properties
      </span>
      <h3 className="text-sm font-semibold mt-1" style={{ color: themeStyles.accent }}>
        ID: <span className="font-mono text-xs">{selected}</span>
      </h3>
    </div>

    {/* Name field */}
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold" style={{ color: themeStyles.mutedFg }}>Name</label>
      <input
        id="input-agent-name"
        type="text"
        value={agents[selected].name}
        onChange={(e) => handleUpdateAgentProperty(selected, { name: e.target.value }, true)}
        className="px-3 py-2 text-xs rounded-lg outline-none transition-colors border"
        style={{
          background: themeStyles.muted,
          borderColor: themeStyles.border,
          color: themeStyles.accent,
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = themeStyles.accent)}
        onBlur={(e) => (e.currentTarget.style.borderColor = themeStyles.border)}
      />
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
      <select
        id="select-add-tool"
        className="px-2.5 py-1.5 text-xs rounded-lg outline-none transition-colors border"
        style={{
          background: themeStyles.muted,
          borderColor: themeStyles.border,
          color: themeStyles.accent
        }}
        defaultValue=""
        onChange={(e) => {
          const val = e.target.value
          if (val) {
            const currentTools = agents[selected].tools || []
            if (!currentTools.includes(val)) {
              handleUpdateAgentProperty(selected, {
                tools: [...currentTools, val]
              })
            }
            e.target.value = "" // Reset select element
          }
        }}
      >
        <option value="" disabled>Add tool...</option>
        {availableTools
          .filter(t => !(agents[selected].tools || []).includes(t.name))
          .map(t => (
            <option key={t.name} value={t.name} title={t.description}>
              {t.name} {t.source !== "internal" && (`(${t.source})`)}
            </option>
          ))}
      </select>
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
              const fieldKey = `${tName}-${field.name}-${idx}`;
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
                    <select
                      value={currentValue}
                      onChange={(e) => updateValue(e.target.value)}
                      className="px-2 py-1 text-xs rounded border outline-none"
                      style={{
                        background: themeStyles.muted,
                        borderColor: themeStyles.border,
                        color: themeStyles.accent
                      }}
                    >
                      <option value="">Select...</option>
                      {(field.value?.items || []).map((item: string) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  ) : type?.startsWith('array:') ? (
                    <ArrayFieldEditor
                      value={currentValue}
                      onChange={updateValue}
                      type={type}
                      themeStyles={themeStyles}
                      items={field.value?.items}
                    />
                  ) : type === 'number' ? (
                    <input
                      type="number"
                      value={currentValue}
                      onChange={(e) => updateValue(e.target.value === '' ? '' : Number(e.target.value))}
                      className="px-2.5 py-1 text-xs rounded border outline-none"
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
                      className="px-2.5 py-1 text-xs rounded border outline-none"
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

    {/* Accent Color selection */}
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold" style={{ color: themeStyles.mutedFg }}>Accent Color</label>
      <div className="flex items-center gap-2">
        {(['blue', 'green', 'rose', 'amber', 'neutral'] as AgentColor[]).map((c) => {
          const dot = COLOR_DOT[c]
          const active = agents[selected].color === c
          return (
            <button
              key={c}
              id={`btn-color-${c}`}
              onClick={() => handleUpdateAgentProperty(selected, { color: c })}
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{
                background: dot,
                boxShadow: active
                  ? `0 0 0 2px ${themeStyles.cardBg}, 0 0 0 3.5px ${dot}`
                  : 'none',
                transform: active ? 'scale(1.15)' : 'scale(1)',
                transition: 'transform 150ms ease-out, box-shadow 150ms ease-out',
              }}
              title={c}
            >
              {active && <Check size={10} style={{ color: isDark ? '#000' : '#fff' }} />}
            </button>
          )
        })}
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

      {selected !== '1' && (
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

export function App({ pyInvoke, useActiveTabId, tabId }: AppInfo) {
  const snaptheme = useTheme()
  const isDark = snaptheme.theme === 'dark'
  const activeTabId = useActiveTabId()
  //  Core state 
  const [agents, setAgents] = useState<Record<string, AgentNode>>(INITIAL_AGENTS)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>('1')
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [availableTools, setAvailableTools] = useState<{ name: string; description: string; source: 'internal' | 'mcp' }[]>([])
  const [tools] = useFolder('Tools')
  const [toolFields, setToolFields] = useState<Record<string, any[]>>({})

  useEffect(() => {
    if (activeTabId == tabId) {
      MenuBar.current = MenuBar.current = null
    }
  }, [activeTabId])

  useEffect(() => {
    if (!tools || tools.length === 0) return

    const loadAllToolFields = async () => {
      const fieldsPaths = tools.filter(p => p.endsWith('/fields.ts'))
      const newToolFields: Record<string, any[]> = {}

      await Promise.all(fieldsPaths.map(async (fieldsPath) => {
        try {
          const folderParts = fieldsPath.split('/')
          folderParts.pop() // Remove 'fields.ts'
          const toolFolder = folderParts.join('/')
          const dirName = folderParts[folderParts.length - 1]

          let toolName = dirName
          const manifestPath = `${toolFolder}/manifest.json`
          const hasManifest = tools.includes(manifestPath)
          if (hasManifest) {
            const manifestRes = await pyInvoke('file', {
              command: 'read',
              filename: manifestPath,
              base_dir: 'Tools'
            }) as any
            if (manifestRes?.data?.content) {
              const manifest = JSON.parse(manifestRes.data.content)
              if (manifest.name) {
                toolName = manifest.name
              }
            }
          }

          const fieldsRes = await pyInvoke('file', {
            command: 'read',
            filename: fieldsPath,
            base_dir: 'Tools'
          }) as any

          if (fieldsRes?.data?.content) {
            const content = fieldsRes.data.content
            const parsed = parseFields(content)
            if (parsed && parsed.length > 0) {
              newToolFields[toolName] = parsed
            }
          }
        } catch (e) {
          console.error('Failed to load fields for', fieldsPath, e)
        }
      }))

      setToolFields(newToolFields)
    }

    loadAllToolFields()
  }, [tools, pyInvoke])

  useEffect(() => {
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
      } catch (e) {
        console.error('Error fetching tools:', e)
      }
    }
    fetchTools()
  }, [pyInvoke])

  //  Canvas view state (committed values for React render) 
  const [zoom, setZoom] = useState(1.0)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  //  Refs for real-time interaction (bypass React re-renders) 
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

  //  Undo/Redo — ref-based stack to avoid stale-closure bugs 
  // historyRef.current = { stack: [...snapshots], index: pointer }
  const historyRef = useRef<{ stack: Record<string, AgentNode>[]; index: number }>({
    stack: [INITIAL_AGENTS],
    index: 0,
  })
  // Mirror index in state so toolbar buttons re-render correctly
  const [historyIndex, setHistoryIndex] = useState(0)
  const [historyLength, setHistoryLength] = useState(1)
  // Debounce timer for text-field edits (name, tasks, instruction…)
  const historyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [canvasDimensions, setCanvasDimensions] = useState({ width: 800, height: 600 })

  //  Layout computation (Reingold-Tilford compact agent layout) 
  const agentPositions = useMemo(() => {
    const allChildIds = new Set<string>()
    Object.values(agents).forEach(a => a.children.forEach(c => allChildIds.add(c)))
    const roots = Object.keys(agents).filter(id => !allChildIds.has(id))
    const primaryRoots = roots.length > 0 ? roots : [Object.keys(agents)[0]]

    // Helper to resolve a virtual structure containing placeholder nodes
    const getVirtualAgent = (id: string): AgentNode | undefined => {
      const agent = agents[id]
      if (agent) {
        // If it is a real agent:
        // - If it has no children, add a child placeholder directly below it.
        // - If it has children, append a sibling placeholder next to its children.
        const children = agent.children.length === 0
          ? [`placeholder-child-${id}`]
          : [...agent.children, `placeholder-sibling-${id}`]
        return { ...agent, children }
      }
      if (id.startsWith('placeholder-')) {
        return {
          id,
          name: '+',
          tools: [],
          children: [],
          color: 'neutral'
        }
      }
      return undefined
    }

    // Reingold-Tilford style: assign preliminary x, then shift subtrees
    const prelim: Record<string, number> = {}   // preliminary x position
    const modifier: Record<string, number> = {} // shift to apply to children
    const levels: Record<string, number> = {}   // depth level

    // Collect left contour of a subtree rooted at `id`
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

    // First pass: post-order traversal to assign preliminary x values
    function firstPass(id: string, level: number) {
      const agent = getVirtualAgent(id)
      if (!agent) return
      levels[id] = level
      modifier[id] = 0

      if (agent.children.length === 0) {
        prelim[id] = 0
        return
      }

      // Recursively layout children first
      for (const cid of agent.children) {
        firstPass(cid, level + 1)
      }

      if (agent.children.length === 1) {
        // Single child: center parent above it
        prelim[id] = prelim[agent.children[0]]
        modifier[id] = 0
        return
      }

      // Multiple children: place them side by side, shifting to avoid overlap
      // Start with the first child at its prelim position
      const childShifts: Record<string, number> = {}
      childShifts[agent.children[0]] = 0

      for (let i = 1; i < agent.children.length; i++) {
        const leftSib = agent.children[i - 1]
        const rightChild = agent.children[i]

        // Get right contour of left subtree
        const leftContour: Record<number, number> = {}
        getContour(leftSib, childShifts[leftSib], false, leftContour, level + 1)

        // Get left contour of right subtree (at shift 0)
        const rightContour: Record<number, number> = {}
        getContour(rightChild, 0, true, rightContour, level + 1)

        // Find max overlap across all shared levels
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

        // Minimum separation is node width + gap
        const minSep = CARD_W + SIBLING_SEP
        const shift = maxOverlap === -Infinity
          ? (childShifts[leftSib] + minSep)
          : (maxOverlap + minSep)
        childShifts[rightChild] = shift
      }

      // Apply shifts: update prelim of each child subtree
      for (const cid of agent.children) {
        applyShift(cid, childShifts[cid] || 0)
      }

      // Center parent over children
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

    // Run layout for each root
    for (const rId of primaryRoots) {
      firstPass(rId, 0)
    }

    // Convert prelim values to final positions
    const positions: Record<string, { x: number; y: number; level: number }> = {}
    function assignPositions(id: string) {
      const agent = getVirtualAgent(id)
      if (!agent) return
      positions[id] = {
        x: prelim[id],
        y: 80 + levels[id] * LEVEL_HEIGHT,
        level: levels[id]
      }
      for (const cid of agent.children) assignPositions(cid)
    }
    for (const rId of primaryRoots) assignPositions(rId)

    // Shift entire tree so leftmost node has reasonable padding, and center on canvas
    const allXs = Object.values(positions).map(p => p.x)
    const minX = Math.min(...allXs)
    const maxX = Math.max(...allXs)
    const treeWidth = maxX - minX + CARD_W
    const offsetX = Math.max((canvasDimensions.width - treeWidth) / 2, 50) - minX + CARD_HALF_W

    for (const id of Object.keys(positions)) {
      positions[id].x += offsetX
    }

    return positions
  }, [agents, canvasDimensions])

  //  Direct DOM transform update (zero React re-renders) 
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

  // Keep refs in sync when state commits
  useEffect(() => { panRef.current = pan }, [pan])
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  //  Track Canvas Resize 
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // Set initial size
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

  //  Pan/focus view helper (smooth transitions) 
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

    // Apply transition temporarily
    if (agentLayerRef.current) {
      agentLayerRef.current.style.transition = 'transform 350ms cubic-bezier(0.16, 1, 0.3, 1)'
    }
    if (svgGroupRef.current) {
      svgGroupRef.current.style.transition = 'transform 350ms cubic-bezier(0.16, 1, 0.3, 1)'
    }
    if (gridRef.current) {
      gridRef.current.style.transition = 'background-position 350ms cubic-bezier(0.16, 1, 0.3, 1)'
    }

    // Commit to refs and state
    panRef.current = newPan
    setPan(newPan)
    applyTransform()

    // Remove transition after it finishes
    setTimeout(() => {
      if (agentLayerRef.current) agentLayerRef.current.style.transition = ''
      if (svgGroupRef.current) svgGroupRef.current.style.transition = ''
      if (gridRef.current) gridRef.current.style.transition = ''
    }, 350)
  }, [agentPositions, canvasDimensions, applyTransform])

  //  Handle autofocusing on newly added/deleted agent 
  useEffect(() => {
    if (pendingFocusAgentIdRef.current) {
      const { id, selectText } = pendingFocusAgentIdRef.current
      if (agentPositions[id]) {
        pendingFocusAgentIdRef.current = null
        panToAgent(id)

        if (selectText) {
          // Select agent name input field for fast editing
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

  //  Native wheel listener (passive: false so preventDefault works) 
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

      // Debounce React state commit (single re-render after scrolling stops)
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

  // Push a snapshot immediately (structural changes: add/delete agent)
  const pushHistory = useCallback((newAgents: Record<string, AgentNode>) => {
    const h = historyRef.current
    // Skip push if the new snapshot is identical to the current one
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

  // Push a snapshot after a debounce delay (text-field edits)
  const pushHistoryDebounced = useCallback((newAgents: Record<string, AgentNode>) => {
    if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current)
    historyDebounceRef.current = setTimeout(() => {
      pushHistory(newAgents)
    }, 600)
  }, [pushHistory])

  // Find the most relevant agent that changed between two snapshots.
  // Prefers added agents, then falls back to the first field-changed agent.
  const findChangedAgentId = useCallback((
    from: Record<string, AgentNode>,
    to: Record<string, AgentNode>
  ): string | null => {
    const fromIds = new Set(Object.keys(from))
    const toIds = new Set(Object.keys(to))
    // Agent added in `to`
    for (const id of toIds) {
      if (!fromIds.has(id)) return id
    }
    // Agent removed — return its parent in `to`
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
    // Field-level change — pick the first differing agent
    for (const id of toIds) {
      if (JSON.stringify(from[id]) !== JSON.stringify(to[id])) return id
    }
    return null
  }, [])

  const handleUndo = useCallback(() => {
    const h = historyRef.current
    // Flush any pending debounced entry before undoing
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

  const handleReset = useCallback(() => {
    if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current)
    const h = historyRef.current
    const stack = h.stack.slice(0, h.index + 1)
    stack.push(INITIAL_AGENTS)
    if (stack.length > MAX_HISTORY) stack.shift()
    const newIndex = stack.length - 1
    h.stack = stack
    h.index = newIndex
    setHistoryIndex(newIndex)
    setHistoryLength(stack.length)
    setAgents(INITIAL_AGENTS)
    setSelectedAgentId('1')
    setZoom(1.0)
    setPan({ x: 0, y: 0 })
    panRef.current = { x: 0, y: 0 }
    zoomRef.current = 1.0
    cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(applyTransform)
  }, [applyTransform])

  // Global keyboard shortcuts: Ctrl+Z = Undo, Ctrl+Shift+Z / Ctrl+Y = Redo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      // Skip when focus is inside an input/textarea so normal text editing works
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

  //  Toolbar zoom (discrete clicks — direct state update) 
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

  //  Pan interaction (ref-based, no re-renders during drag) 
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
    // Single React commit when drag ends
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

  //  Agent CRUD (stable callbacks) 
  const handleAddAgent = useCallback((parentId: string) => {
    const newId = String(Date.now())
    const newAgent: AgentNode = {
      id: newId,
      name: 'New Agent',
      tools: [],
      children: [],
      color: 'neutral'
    }
    pendingFocusAgentIdRef.current = { id: newId, selectText: true }
    setAgents(prev => {
      const updated = {
        ...prev,
        [newId]: newAgent,
        [parentId]: { ...prev[parentId], children: [...prev[parentId].children, newId] }
      }
      pushHistory(updated)
      return updated
    })
    setSelectedAgentId(newId)
  }, [pushHistory])

  const handleDeleteAgent = useCallback((idToDelete: string) => {
    if (idToDelete === '1') return

    const agentToDelete = agents[idToDelete]
    if (agentToDelete && agentToDelete.children.length > 0) {
      const confirmed = window.confirm('Are you sure you want to delete this agent and all of its sub-branches?')
      if (!confirmed) return
    }

    // Find parent ID of the agent to be deleted to select/pan to it next
    let parentId: string | null = null
    for (const [id, a] of Object.entries(agents)) {
      if (a.children.includes(idToDelete)) {
        parentId = id
        break
      }
    }

    setAgents(prev => {
      const updated = { ...prev }
      delete updated[idToDelete]
      Object.keys(updated).forEach(id => {
        if (updated[id].children.includes(idToDelete)) {
          updated[id] = { ...updated[id], children: updated[id].children.filter(c => c !== idToDelete) }
        }
      })
      const removeSubtree = (id: string) => {
        const a = prev[id]
        if (!a) return
        for (const cid of a.children) { delete updated[cid]; removeSubtree(cid) }
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

  // isTextField: true = debounce (name/tasks/instruction edits); false = immediate (color, tools)
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

  //  Memoised theme styles 
  const themeStyles = useMemo(() => ({
    canvasBg: 'hsl(var(--bg))',
    cardBg: 'hsl(var(--card))',
    border: 'hsl(var(--border))',
    accent: 'hsl(var(--accent))',
    accentFg: 'hsl(var(--accent-foreground))',
    muted: 'hsl(var(--muted))',
    mutedFg: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)',
    toolbarBg: isDark ? 'rgba(18,18,18,0.92)' : 'rgba(255,255,255,0.92)',
    lineBase: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    lineHover: 'hsl(var(--accent))',
    lineGlowHover: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)',
    gridDot: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)',
    selectedRing: 'hsl(var(--accent))',
    selectedBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
  }), [isDark])

  //  Pre-compute SVG connector paths (avoids work inside render) 
  const connectorData = useMemo(() => {
    const result: { parentId: string; d: string }[] = []
    const agentIds = Object.keys(agents)
    for (const parentId of agentIds) {
      const parentPos = agentPositions[parentId]
      const parentAgent = agents[parentId]
      if (!parentPos || !parentAgent) continue

      // Resolve children including virtual placeholders
      const virtualChildren = parentAgent.children.length === 0
        ? [`placeholder-child-${parentId}`]
        : [...parentAgent.children, `placeholder-sibling-${parentId}`]

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
        const isPlaceholder = cp.id.startsWith('placeholder-')
        const childHalfH = isPlaceholder ? 16 : CARD_HALF_H
        const childTopY = cp.y - childHalfH
        d += ` M ${cp.x} ${busY} L ${cp.x} ${childTopY}`
      }

      result.push({ parentId, d })
    }
    return result
  }, [agents, agentPositions])

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
            backgroundImage: `radial-gradient(circle at 1px 1px, ${themeStyles.gridDot} 1px, transparent 0)`,
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
            {connectorData.map(({ parentId, d }) => {
              const isSubtreeHighlighted =
                hoveredAgentId === parentId ||
                (hoveredAgentId !== null && highlightedAgentSubtreeIds.has(parentId))

              return (
                <g key={`conn-${parentId}`}>
                  <path
                    d={d} fill="none"
                    stroke={isSubtreeHighlighted ? themeStyles.lineGlowHover : 'transparent'}
                    strokeWidth={isSubtreeHighlighted ? 7 : 0}
                    strokeLinecap="round"
                    style={{
                      transition: 'd 350ms cubic-bezier(0.16, 1, 0.3, 1), stroke 300ms ease-out, stroke-width 300ms ease-out'
                    }}
                  />
                  <path
                    d={d} fill="none"
                    stroke={isSubtreeHighlighted ? themeStyles.lineHover : themeStyles.lineBase}
                    strokeWidth={isSubtreeHighlighted ? 2 : 1.5}
                    strokeLinecap="round"
                    style={{
                      transition: 'd 350ms cubic-bezier(0.16, 1, 0.3, 1), stroke 300ms ease-out, stroke-width 300ms ease-out'
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

            const isPlaceholder = id.startsWith('placeholder-')
            if (isPlaceholder) {
              const parentId = id.replace('placeholder-child-', '').replace('placeholder-sibling-', '')
              const parentAgent = agents[parentId]
              const accentColor = parentAgent ? COLOR_DOT[parentAgent.color || 'neutral'] : 'hsl(var(--accent))'
              return (
                <PlaceholderAgent
                  key={id}
                  id={id}
                  posX={pos.x}
                  posY={pos.y}
                  accentColor={accentColor}
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
                id={id}
                agent={agent}
                posX={pos.x}
                posY={pos.y}
                isSelected={selectedAgentId === id}
                isHovered={hoveredAgentId === id}
                isPathHighlight={highlightedAgentSubtreeIds.has(id)}
                isDark={isDark}
                onSelect={handleAgentSelect}
                onHover={handleAgentHover}
                onDelete={handleDeleteAgent}
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
            onClick={fitView}
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

          <div className="w-px h-6 mx-1" style={{ background: themeStyles.border }} />

          <button
            id={isRunning ? 'btn-stop' : 'btn-start'}
            onClick={() => {
              setIsRunning(false)
            }}
            className="p-2 rounded-lg transition-colors"
            style={{ color: themeStyles.mutedFg }}
            title="Start"
          >
            {isRunning ? <Square size={16} className={clsx(
              'dark:text-red-700 dark:fill-red-600 text-red-600 fill-red-500'
            )} /> : <Play size={16} className={clsx(
              'dark:text-green-700 dark:fill-green-600 text-green-600 fill-green-500'
            )} />}
          </button>

        </div>

        {/* Zoom display */}
        <div
          ref={zoomLabelRef}
          className="absolute bottom-4 left-4 px-2.5 py-1 backdrop-blur-md rounded-md text-[10px] font-mono border"
          style={{
            background: themeStyles.toolbarBg,
            borderColor: themeStyles.border,
            color: themeStyles.mutedFg,
          }}
        >
          Zoom: {Math.round(zoom * 100)}%
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
            <AgentEditor selected={selectedAgentId} agents={agents} handleUpdateAgentProperty={handleUpdateAgentProperty} handleAddAgent={handleAddAgent} handleDeleteAgent={handleDeleteAgent} themeStyles={themeStyles} availableTools={availableTools} toolFields={toolFields} />
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