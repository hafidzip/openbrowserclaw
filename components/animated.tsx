"use client"
import clsx from "clsx"
import { useEffect, useState } from "react"

export const Aspan = ({ children, isCollapsed, className }: { children: React.ReactNode, isCollapsed: boolean, className?: string }) => {
    const [isHidden, setIsHidden] = useState(isCollapsed)
    useEffect(() => {
        if (isCollapsed) {
            // When collapsing, hide after transition completes
            const timer = setTimeout(() => setIsHidden(true), 150)
            return () => clearTimeout(timer)
        } else {
            // When expanding, show immediately so transition can play
            setIsHidden(false)
        }
    }, [isCollapsed])
    return (
        <span
            style={{
                opacity: isCollapsed ? 0 : 1,
                willChange: "opacity",
                transitionProperty: "opacity",
                transitionDuration: isCollapsed ? "0ms" : "50ms",
                transitionTimingFunction: "ease-out",
                transitionDelay: isCollapsed ? "0ms" : "50ms",
            }}
            className={clsx(isHidden ? "hidden" : "", className)}
        >
            {children}
        </span>
    )
}