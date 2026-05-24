import { type ReactNode, type FC, type HTMLAttributes, useState, useEffect, useMemo, memo, createContext, useContext } from "react";
import { evaluate } from '@mdx-js/mdx'
import remarkGfm from 'remark-gfm'
import * as runtime from 'react/jsx-runtime'
import { MessageParser } from "../utils/message-parser";
import { ChevronRight, Lightbulb, Plug } from "lucide-react";
import clsx from "clsx";
import { useGlobal } from "./useGlobal/useGlobal";
// ============================================
// Component Props Types
// ============================================
interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  type?: 'info' | 'warning' | 'error'
  children: ReactNode
}
interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'primary' | 'success' | 'danger'
  children: ReactNode
}
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  children: ReactNode
}
interface ButtonProps extends HTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'success' | 'danger'
  onClick?: () => void
  children: ReactNode
}
interface ToolCallProps {
  name: string;
  id: string;
  parameters?: string;
}
interface ThinkProps {
  children: ReactNode;
}
// ============================================
// Custom JSX Components
// ============================================

const AlertBox: FC<AlertProps> = ({ type = 'info', children, ...props }) => {
  const backgrounds: Record<NonNullable<AlertProps['type']>, string> = {
    info: '#e3f2fd',
    warning: '#fff3cd',
    error: '#f8d7da'
  }
  const borders: Record<NonNullable<AlertProps['type']>, string> = {
    info: '#2196F3',
    warning: '#ffc107',
    error: '#dc3545'
  }
  return (
    <div
      style={{
        background: backgrounds[type],
        borderLeft: `4px solid ${borders[type]}`,
        padding: '12px',
        borderRadius: '4px',
        marginBottom: '12px'
      }}
      {...props}
    >
      {children}
    </div>
  )
}

const BadgeTag: FC<BadgeProps> = ({ variant = 'primary', children, ...props }) => {
  const colors: Record<NonNullable<BadgeProps['variant']>, string> = {
    primary: '#007bff',
    success: '#28a745',
    danger: '#dc3545'
  }
  return (
    <span
      style={{
        background: colors[variant],
        color: 'white',
        padding: '4px 8px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        marginRight: '4px'
      }}
      {...props}
    >
      {children}
    </span>
  )
}

const CardBox: FC<CardProps> = ({ title, children, ...props }) => (
  <div
    style={{
      border: '1px solid #ddd',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '12px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    }}
    {...props}
  >
    {title && <h3 style={{ marginTop: 0 }}>{title}</h3>}
    {children}
  </div>
)

const ActionButton: FC<ButtonProps> = ({ variant = 'primary', children, onClick, ...props }) => {
  const colors: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary: '#007bff',
    success: '#28a745',
    danger: '#dc3545'
  }
  return (
    <button
      onClick={onClick}
      style={{
        background: colors[variant],
        color: 'white',
        border: 'none',
        padding: '8px 8px',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '14px'
      }}
      {...props}
    >
      {children}
    </button>
  )
}

const User: FC<ThinkProps> = ({ children }) => {
  return (
    <div
      style={{
        whiteSpace: 'pre-wrap',
        wordWrap: 'break-word',
      }}
      className="flex items-end mb-5">
      <span className="ml-auto p-2 px-4 bg-accent/5 rounded-3xl max-w-[70%]">
        {children}
      </span>
    </div>
  );
};

const ToolCall: FC<ToolCallProps> = memo(({ name, id }) => {
  return (
    <div id={`tool-call-${id}`} className={clsx(
      "tc-container overflow-hidden inline-flex flex-col",
    )}>
      {/* Clickable header toggles state */}
      <button
        className="text-xs font-bold opacity-50 flex items-center gap-1"
      >
        <Plug size={12} />
        <span className="thought-container">{name}</span>
      </button>
    </div>
  );
});
interface CodeBlockProps {
  children: ReactNode;
  id?: string;
}

const CodeBlock: FC<CodeBlockProps> = memo(({ children, id }) => {
  return (
    <div id={id} className="">
      {children}
    </div>
  );
});
// ============================================
// Contexts for Message-wide state (split for performance)
// ============================================
// Separate contexts to prevent cascading re-renders
// - Components that only WRITE (Think) subscribe to DispatchContext
// - Components needing the message ID subscribe to IdContext

const MessageIdContext = createContext<string>('');

const ActiveMessageIdContext = createContext<string | null>(null);
// Think only needs to WRITE - subscribe only to dispatch context

const Think: FC<ThinkProps> = ({ children }) => {
  const id = useContext(MessageIdContext);
  const [open, setOpen] = useGlobal("think" + id, false)
  return (
    <div id={`think-${id}`} className={clsx(
      "thinkel overflow-hidden flex flex-col",
      open ? "pb-4" : "pb-1"
    )}>
      {/* Clickable header toggles state */}
      <button
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(prev=>!prev) }}
        className="text-xs font-bold opacity-50 flex items-center gap-1"
      >
        <Lightbulb size={12} />
        <span className="thought-container">THOUGHT</span>
        <ChevronRight
          size={12}
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {/* Body shown/hidden based on context */}
      <div className={`border-l border-[hsl(var(--border))] text-xs ml-1.5 pl-2 opacity-50 italic transition-all ${open ? "h-auto" : "h-0 hidden"}`}>
        {children}
      </div>
    </div>
  );
};
// ============================================
// Message Component
// ============================================
interface MessageProps {
  response: string,
  id: string,
  activeId: string | null,
}

export default function Message({ response, id, activeId }: MessageProps) {
  const [MDXContent, setMDXContent] = useState<any>(null);
  const [LastValidMDXContent, setLastValidMDXContent] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  // ============================================
  // Components Registry
  // ============================================
  const components = useMemo(() => ({
    // Support both PascalCase and lowercase
    Alert: AlertBox,
    alert: AlertBox,
    Button: ActionButton,
    button: ActionButton,
    Badge: BadgeTag,
    badge: BadgeTag,
    Card: CardBox,
    card: CardBox,
    User: User,
    user: User,
    Think: Think,
    think: Think,
    ToolCall: ToolCall,
    toolcall: ToolCall,
    CodeBlock: CodeBlock,
    // Also keep the original names for backward compatibility
    AlertBox,
    alertbox: AlertBox,
    ActionButton,
    actionbutton: ActionButton,
    BadgeTag,
    badgetag: BadgeTag,
    CardBox,
    cardbox: CardBox,
  }), [id]); // Stable components registry
  useEffect(() => {
    let mounted = true;
    const processContent = async () => {
      try {
        // Use MessageParser to handle cleanup, custom tags like <think>, and tool calls
        const processedFile = MessageParser.process(response);
        // evaluate compiles and executes the MDX
        const { default: Content } = await evaluate(processedFile, {
          ...runtime,
          remarkPlugins: [remarkGfm],
        } as any)
        if (mounted) {
          setMDXContent(() => Content)
          setLastValidMDXContent(() => Content)
          setError(null)
        }
      } catch (firstErr: any) {
        // Second pass: aggressive fallback  escape ALL HTML and braces, keep only markdown
        try {
          const aggressiveFallback = MessageParser.aggressiveEscape(response);
          const { default: FallbackContent } = await evaluate(aggressiveFallback, {
            ...runtime,
            remarkPlugins: [remarkGfm],
          } as any)
          if (mounted) {
            setMDXContent(() => FallbackContent)
            setLastValidMDXContent(() => FallbackContent)
            setError(null)
          }
        } catch (secondErr: any) {
          console.error('MDX fallback also failed:', secondErr.message)
          if (mounted) {
            setError(secondErr.message)
          }
        }
      }
    }
    processContent()
    return () => {
      mounted = false
    }
  }, [response, id])
  const MemoizedMDX = useMemo(() => {
    if (!MDXContent) return null;
    return <MDXContent components={components} />;
  }, [MDXContent, id, components]);
  // Update your component to always have the ID on the container
  if (error) {
    // If we're actively streaming and have a last valid render, show that
    if ((activeId === id) && LastValidMDXContent) {
      return (
        <ActiveMessageIdContext.Provider value={activeId}>
          <MessageIdContext.Provider value={id}>
            <div id={id} className="llm-response markdown-body pt-4 px-2">
              {MemoizedMDX}
            </div>
          </MessageIdContext.Provider>
        </ActiveMessageIdContext.Provider>
      )
    }
    // Graceful plaintext fallback  render content as-is instead of ugly error
    return (
      <div id={id} className="llm-response markdown-body pt-12">
        <div style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
          {response}
        </div>
      </div>
    )
  }
  if (!MDXContent) {
    return <>
    </>
  }
  return (
    <ActiveMessageIdContext.Provider value={activeId}>
      <MessageIdContext.Provider value={id}>
        <div id={id} className="llm-response markdown-body pt-4 px-2">
          {MemoizedMDX}
        </div>
      </MessageIdContext.Provider>
    </ActiveMessageIdContext.Provider>
  )
}