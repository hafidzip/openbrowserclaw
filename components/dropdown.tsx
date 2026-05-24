import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Command, CommandInput, CommandItem } from "./ui/command";
import { Fragment, useEffect, useState } from "react";
import { CommandEmpty, CommandGroup, CommandList } from "cmdk";
import { Plus } from "lucide-react";
import { ScrollArea } from "./ui";
interface DropdownProps {
  children: React.ReactNode;
  content: DropdownMenuItemProps[];
  align?: "start" | "center" | "end";
  className?: string;
  search?: string;
  setSearch?: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}

export interface DropdownMenuItemProps {
  content: React.ReactNode;
  category?: string;
  text?: String;
  shortcut?: React.ReactNode | null;
  children?: DropdownMenuItemProps[] | null;
  separator?: boolean;
  trigger?: () => void;
  huggingface?: boolean;
  hidden?: boolean;
  addModel?: boolean;
}

export function Dropdown({ children, content, align = "start", className = "w-56", search, setSearch, onOpenChange, open }: DropdownProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [value, setValue] = useState("");
  useEffect(() => {
    if (open !== undefined && open !== null) {
      setMenuOpen(open);
    }
  }, [open])
  return (
    <DropdownMenu open={menuOpen} onOpenChange={(open) => {
      setMenuOpen(open);
      if (onOpenChange) onOpenChange(open);
    }}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent className={className} align={align}>
        {setSearch && <>
          <Command onKeyDown={(e) => {
            e.stopPropagation();
          }} className="bg-transparent overflow-visible">
            <CommandInput
              value={search}
              onValueChange={(value) => {
                if (setSearch) setSearch(value);
              }}
              placeholder="Search..."
              autoFocus={true}
              className="h-7 text-[0.875rem]"
            />
          </Command>
          <DropdownMenuSeparator />
        </>}
        <ScrollArea className="max-h-[300px] overflow-y-auto">
          {content.map((item, index) => (
            <Fragment key={index}>
              {item.children?.length ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>{item.content}</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {
                        item.children.every(({ children }) => children?.length) ?
                          <Fragment key="sub-grouped">
                            <Command className="bg-transparent">
                              <CommandInput
                                onValueChange={() => {
                                }}
                                placeholder="Search..."
                                autoFocus={true}
                                className="h-7 text-[0.875rem]"
                              />
                            </Command>
                            {item.children.filter(({ hidden }) => !hidden).map((child, childIndex) =>
                              <DropdownMenuSub key={childIndex}>
                                <DropdownMenuSubTrigger>
                                  {child.content}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  <Command className="bg-transparent">
                                    <CommandInput
                                      onValueChange={(value) => {
                                        setValue(value);
                                        console.log(value);
                                      }}
                                      placeholder="Search..."
                                      autoFocus={true}
                                      className="h-7 text-[0.875rem]"
                                    />
                                    <CommandList>
                                      <CommandEmpty className="text-[10pt] text-center opacity-[0.5] p-2">No results found.</CommandEmpty>
                                      <CommandGroup className="max-h-[300px] max-w-none overflow-y-auto overflow-x-hidden">
                                        {child.children && child.children.filter(({ hidden }) => !hidden).map((subChild, subChildIndex) => (
                                          <Fragment key={subChildIndex}>
                                            {subChild.category && value === "" &&
                                              <>
                                                {subChildIndex !== 0 && <DropdownMenuSeparator />}
                                                <div className="text-xs text-gray-500">
                                                  {subChild.category}
                                                </div>
                                              </>
                                            }
                                            <CommandItem
                                              className="data-[selected=true]:bg-[hsl(var(--hoverfloat))]"
                                              value={subChild.text + subChildIndex.toString()}
                                              onSelect={() => {
                                                if (subChild.trigger) subChild.trigger();
                                              }}
                                            >
                                              {subChild.content}
                                            </CommandItem>
                                            {subChild.separator && <DropdownMenuSeparator />}
                                          </Fragment>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                    {item.huggingface && <CommandItem className="cursor-pointer flex items-center rounded-none border-solid border-t-[1px] border-[hsl(var(--accent))]/10 ">
                                      <div>Download model from Hugging Face.</div>
                                      <Plus className="ml-auto" />
                                    </CommandItem>}
                                  </Command>
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                            )}
                          </Fragment>
                          :
                          <Command className="bg-transparent">
                            <CommandInput
                              onValueChange={(value) => {
                                setValue(value);
                                console.log(value);
                              }}
                              placeholder="Search..."
                              autoFocus={true}
                              className="h-7 text-[0.875rem]"
                            />
                            <CommandList>
                              <CommandEmpty className="text-[10pt] text-center opacity-[0.5] p-2">No results found.</CommandEmpty>
                              <CommandGroup className="max-h-[300px] max-w-none overflow-y-auto overflow-x-hidden">
                                {item.children.filter(({ hidden }) => !hidden).map((child, childIndex) => (
                                  <Fragment key={childIndex}>
                                    {child.category && value === "" &&
                                      <>
                                        {childIndex !== 0 && <DropdownMenuSeparator />}
                                        <div className="text-xs text-gray-500">
                                          {child.category}
                                        </div>
                                      </>
                                    }
                                    <CommandItem
                                      className="data-[selected=true]:bg-[hsl(var(--hoverfloat))]"
                                      value={child.text + childIndex.toString()}
                                      onSelect={() => {
                                        setMenuOpen(false);
                                        if (child.trigger) child.trigger();
                                      }}
                                    >
                                      {child.content}
                                    </CommandItem>
                                    {child.separator && <DropdownMenuSeparator />}
                                  </Fragment>
                                ))}
                              </CommandGroup>
                            </CommandList>
                            {item.huggingface && <CommandItem className="cursor-pointer flex items-center rounded-none border-solid border-t-[1px] border-[hsl(var(--accent))]/10 ">
                              <div>Download model from Hugging Face.</div>
                              <Plus className="ml-auto" />
                            </CommandItem>}
                          </Command>
                      }
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              ) : (
                <DropdownMenuItem className={item.content == "Recent" ? "focus:bg-transparent opacity-[0.5] text-[10pt] py-1" : ""} onClick={item.trigger}>
                  {item.content}
                  {item.shortcut && (
                    <DropdownMenuShortcut className="opacity-100" >{item.shortcut}</DropdownMenuShortcut>
                  )}
                </DropdownMenuItem>
              )}
              {item.separator && <DropdownMenuSeparator />}
            </Fragment>
          ))}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}