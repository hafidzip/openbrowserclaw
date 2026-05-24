import * as React from "react"
import { Loader2 } from "lucide-react"
import { iconList, LucideIcons } from "../utils/state"
import { cn } from "../lib/utils"
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandList,
} from "./ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "./ui/popover"
// Filter out non-icon exports from lucide-react
interface IconPopoverProps {
    children: React.ReactNode
    onSelect: (iconName: string) => void
    className?: string
}

export function IconPopover({ children, onSelect }: IconPopoverProps) {
    const [open, setOpen] = React.useState(false)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [limit, setLimit] = React.useState(50)
    const fullIconList = React.useMemo(() => {
        const defaultIconRegistry = (window as any).defaultIconRegistry || {};
        return Array.from(new Set([...Object.keys(defaultIconRegistry), ...iconList]));
    }, []);
    // Use a callback ref to setup observer when the element is mounted
    const observer = React.useRef<IntersectionObserver | null>(null)
    const lastElementRef = React.useCallback((node: HTMLDivElement | null) => {
        if (observer.current) observer.current.disconnect()
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && limit < fullIconList.length) { // Use simpler condition first
                setLimit(prev => prev + 50)
            }
        })
        if (node) observer.current.observe(node)
    }, [limit, fullIconList.length])
    // Filter icons based on search
    const allFilteredIcons = React.useMemo(() => {
        if (!searchQuery) return fullIconList;
        return fullIconList.filter((name) => name.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [searchQuery, fullIconList]);
    const displayedIcons = React.useMemo(() => {
        return allFilteredIcons.slice(0, limit)
    }, [allFilteredIcons, limit])
    const hasMore = limit < allFilteredIcons.length
    // Reset limit when search changes
    React.useEffect(() => {
        setLimit(50)
    }, [searchQuery])
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                {children}
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder="Search icon..."
                        value={searchQuery}
                        onValueChange={setSearchQuery}
                    />
                    {/* CommandList has max-h-[300px] and overflow-y-auto by default in shadcn/ui */}
                    <CommandList className="h-[300px] max-h-[300px]">
                        {allFilteredIcons.length === 0 && <CommandEmpty>No icon found.</CommandEmpty>}
                        <div className="grid grid-cols-7 gap-1 p-1">
                            {displayedIcons.map((iconName) => {
                                const defaultIconRegistry = (window as any).defaultIconRegistry || {};
                                const Icon = defaultIconRegistry[iconName] || (LucideIcons as any)[iconName]
                                if (!Icon) return null;
                                return (
                                    <div
                                        key={iconName}
                                        className={cn(
                                            "flex flex-col py-2 items-center justify-center gap-1 rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors",
                                        )}
                                        onClick={() => {
                                            onSelect(iconName)
                                            setOpen(false)
                                        }}
                                        title={iconName}
                                    >
                                        <Icon className="h-4 w-4" />
                                    </div>
                                )
                            })}
                        </div>
                        {hasMore && (
                            <div ref={lastElementRef} className="flex justify-center p-4 w-full">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
