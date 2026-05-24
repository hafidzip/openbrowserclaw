import {
  Dialog as DialogPrimitive,
  DialogContent,
  DialogTrigger,
} from "./ui/dialog"
import clsx from "clsx";

export function Dialog({children, content, className} : {children: React.ReactNode, content: React.JSX.Element, className?: string}) {
  return (
    <DialogPrimitive>
        <DialogTrigger asChild>
            {children}
        </DialogTrigger>
        <DialogContent className={clsx(className)}>
            {content}
        </DialogContent>
    </DialogPrimitive>
  )
}
