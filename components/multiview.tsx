import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "./ui/resizable";
import React, { useRef, useEffect, useLayoutEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useSnapshot } from "valtio";
import { DragState, KeyState, reorderChildren, TabInfo, TabState, Viewport } from "../utils/state";
import { cn } from "../lib/utils";
import type { ImperativePanelHandle } from "react-resizable-panels";

export type LayoutType =
  | "horizontal"    // Side by side (1x2)
  | "vertical"      // Top and bottom (2x1)
  | "grid2x2"       // 2x2 grid (4 views) 
  | "triple"        // 3 views: 3 horizontal stacked
  | "triple-left"   // 3 views: 1 left, 2 right stacked
  | "triple-right"  // 3 views: 2 left stacked, 1 right
  | "triple-top"    // 3 views: 1 top, 2 bottom side by side
  | "triple-bottom" // 3 views: 2 top side by side, 1 bottom
  | "single";       // Single view (no split)
interface MultiViewProps {
  actives: number[] | readonly number[];
  layout?: LayoutType;
  children: React.ReactNode[] | React.ReactNode;
  defaultSizes?: number[];
  className?: string;
}

const ViewSlot = ({ node, id }: { node: HTMLElement | undefined, id: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { record } = useSnapshot(DragState);
  const tabInfo = useSnapshot(TabInfo);
  const { ctrl, shift } = useSnapshot(KeyState);
  const active = ctrl && shift && tabInfo.switchMode;
  // Replace all drag state with pointer state
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const DRAG_THRESHOLD = 6; // px before drag is "committed"
  useLayoutEffect(() => {
    if (node && ref.current) {
      ref.current.appendChild(node);
    }
  }, [node]);
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!active) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startPos.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;
    DragState.set("id", id);
    DragState.set("over", id);
  }, [active, id]);
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!active || !DragState.record["id"]) return;
    const dx = Math.abs(e.clientX - startPos.current.x);
    const dy = Math.abs(e.clientY - startPos.current.y);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
      isDragging.current = true;
    }
    if (!isDragging.current) return;
    // Hit-test which slot the pointer is over
    e.currentTarget.releasePointerCapture(e.pointerId); // allow hit-testing other elements
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const slot = el?.closest("[data-slot-id]");
    const overId = slot?.getAttribute("data-slot-id");
    if (overId) DragState.set("over", overId);
  }, [active]);
  const handlePointerUp = useCallback(() => {
    if (!active) return;
    const fromId = DragState.record["id"]?.replace(".$", "");
    const toId = DragState.record["over"]?.replace(".$", "");
    if (isDragging.current && fromId && toId && fromId !== toId) {
      const fromIndex = TabInfo.children.findIndex(c => c === fromId);
      const toIndex = TabInfo.children.findIndex(c => c === toId);
      if (fromIndex !== -1 && toIndex !== -1) {
        TabInfo.children = reorderChildren(tabInfo.active, fromIndex, toIndex);
        TabInfo.switchMode = false;
      }
    } else if (!isDragging.current) {
      // It was a click, not a drag
      TabInfo.switchMode = false;
    }
    DragState.set("id", null);
    DragState.set("over", null);
    isDragging.current = false;
  }, [active, tabInfo.active]);
  return (
    <div
      data-slot-id={id}           // ← used by hit-test in pointerMove
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={() => { TabInfo.switchMode = false; }}
      style={{ touchAction: "none" }}  // required for pointer capture on touch/stylus
      className={cn(
        (active && record["id"] === id) ? "opacity-[0.25] bg-transparent"
          : record["over"] === id ? "bg-blue-500/25 cursor-grabbing"
            : "",
        "w-full h-full absolute flex items-center justify-center"
      )}
    >
      <div className={cn(
        "w-full h-full absolute transform",
        active && "scale-[0.85] shadow-md transition-all duration-100 hover:ring-2 hover:ring-blue-500",
        active && id === record["id"] && "cursor-grab"
      )}>
        <div className={cn(
          "w-full h-full relative bg-card overflow-hidden",
          active && "pointer-events-none select-none"
        )} ref={ref} />
      </div>
    </div>
  );
};

const getVisibleSlots = (layout: LayoutType): number => {
  switch (layout) {
    case "single": return 1;
    case "horizontal":
    case "vertical": return 2;
    case "triple-left":
    case "triple-right":
    case "triple-top":
    case "triple":
    case "triple-bottom": return 3;
    case "grid2x2": return 4;
    default: return 1;
  }
};

export default function MultiView({
  actives = [0],
  layout = "horizontal",
  children,
  defaultSizes,
  className = ""
}: MultiViewProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const childArray = React.Children.toArray(children);
  const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const hiddenRef = useRef<HTMLDivElement>(null);
  // Initialize nodes for new children
  childArray.forEach(child => {
    const key = (child as any).key;
    if (typeof document !== 'undefined' && !nodesRef.current.has(key)) {
      const node = document.createElement('div');
      node.style.width = '100%';
      node.style.height = '100%';
      node.style.position = 'absolute';
      nodesRef.current.set(key, node);
    }
  });
  // Cleanup unused nodes
  useEffect(() => {
    const currentKeys = new Set(childArray.map(c => (c as any).key));
    for (const [key, node] of nodesRef.current) {
      if (!currentKeys.has(key)) {
        node.remove();
        nodesRef.current.delete(key);
      }
    }
  }, [childArray]);
  // Helper to save scroll positions of all scrollable elements within a node
  // const saveScrollPositions = useCallback((node: HTMLElement): Map<Element, { top: number; left: number }> => {
  //   const scrollMap = new Map<Element, { top: number; left: number }>();
  //   // Save the node's own scroll position if it's scrollable
  //   if (node.scrollTop !== 0 || node.scrollLeft !== 0) {
  //     scrollMap.set(node, { top: node.scrollTop, left: node.scrollLeft });
  //   }
  //   // Find all scrollable descendants
  //   const scrollableElements = node.querySelectorAll('*');
  //   scrollableElements.forEach((el) => {
  //     if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
  //       scrollMap.set(el, { top: el.scrollTop, left: el.scrollLeft });
  //     }
  //   });
  //   return scrollMap;
  // }, []);
  // // Helper to restore scroll positions
  // const restoreScrollPositions = useCallback((scrollMap: Map<Element, { top: number; left: number }>) => {
  //   // Use requestAnimationFrame to ensure DOM has settled
  //   requestAnimationFrame(() => {
  //     scrollMap.forEach((pos, el) => {
  //       if (el && el.isConnected) {
  //         el.scrollTop = pos.top;
  //         el.scrollLeft = pos.left;
  //       }
  //     });
  //   });
  // }, []);
  // Move inactive nodes to hidden area and manage scroll positions
  useLayoutEffect(() => {
    const visibleSlots = getVisibleSlots(layout);
    const activeKeys = new Set<string>();
    for (let i = 0; i < visibleSlots; i++) {
      const childIndex = actives[i] ?? i;
      const child = childArray[childIndex];
      if (child) {
        activeKeys.add((child as any).key);
      }
    }
    if (hiddenRef.current) {
      // Collect all scroll positions before moving any nodes
      // const allScrollPositions = new Map<Element, { top: number; left: number }>();
      // nodesRef.current.forEach((node) => {
      //   const scrollPositions = saveScrollPositions(node);
      //   scrollPositions.forEach((pos, el) => allScrollPositions.set(el, pos));
      // });
      // Move inactive nodes to hidden area
      nodesRef.current.forEach((node, key) => {
        if (!activeKeys.has(key)) {
          hiddenRef.current!.appendChild(node);
        }
      });
      // Restore all scroll positions after DOM moves
      // restoreScrollPositions(allScrollPositions);
    }
  }, [actives, layout, childArray]);
  const getSlot = (slotIndex: number) => {
    const childIndex = actives[slotIndex] ?? slotIndex;
    const child = childArray[childIndex];
    const key = child ? (child as any).key : null;
    const node = key ? nodesRef.current.get(key) : undefined;
    return <ViewSlot key={key || `slot-${slotIndex}`} node={node} id={key} />;
  };
  const { size } = useSnapshot(TabInfo);
  const { aspectRatio } = useSnapshot(Viewport);
  const renderLayout = useCallback(() => {
    const { ctrl, shift } = useSnapshot(KeyState);
    const tabInfo = useSnapshot(TabInfo);
    const active = tabInfo.switchMode;
    const dragEvent = {
      className: ctrl && shift && active ? "bg-accent/50 dark:bg-accent/25" : "bg-[hsl(var(--chat-border))]/50 dark:bg-[hsl(var(--chat-border))]",
    }
    function handleResize(e: number, index: number) {
      if (TabInfo.active !== "" && TabInfo.size[index]) TabInfo.size[index] = e;
      if (TabState[TabInfo.active] && TabState[TabInfo.active].size[index]) TabState[TabInfo.active].size[index] = e;
    }
    const refs = [
      useRef<ImperativePanelHandle>(null),
      useRef<ImperativePanelHandle>(null),
      useRef<ImperativePanelHandle>(null),
      useRef<ImperativePanelHandle>(null),
      useRef<ImperativePanelHandle>(null),
    ];
    useLayoutEffect(() => {
      refs.forEach((ref, i) => {
        if (ref.current) {
          const defaultSize = layout === "triple" ? 33.33 : 50;
          ref.current.resize(TabInfo.size[i] ?? defaultSize); // 👈 use saved size
        }
      });
    }, [layout]);
    const currentLayout = layout === "single" ? "single" : aspectRatio === "9:16" ? 'vertical' : layout;
    // Horizontal split (1x2 or grid1x2) - 2 views side by side
    if ((currentLayout === "horizontal")) {
      return (
        <ResizablePanelGroup
          key="layout-horizontal"
          direction="horizontal"
        >
          <ResizablePanel ref={refs[0]} onResize={(e) => handleResize(e, 0)} className={className} defaultSize={size?.[0] || 50} minSize={20}>
            {getSlot(0)}
          </ResizablePanel>
          <ResizableHandle {...dragEvent} />
          <ResizablePanel ref={refs[1]} onResize={(e) => handleResize(e, 1)} className={className} defaultSize={size?.[1] || 50} minSize={20}>
            {getSlot(1)}
          </ResizablePanel>
        </ResizablePanelGroup>
      );
    }
    // Vertical split (2x1 or grid2x1) - 2 views top and bottom
    if ((currentLayout === "vertical")) {
      return (
        <ResizablePanelGroup
          key="layout-vertical"
          direction="vertical"
        >
          <ResizablePanel ref={refs[0]} className={className} onResize={(e) => handleResize(e, 0)} defaultSize={size?.[0] || 50} minSize={30}>
            {getSlot(0)}
          </ResizablePanel>
          <ResizableHandle {...dragEvent} />
          <ResizablePanel ref={refs[1]} className={className} onResize={(e) => handleResize(e, 1)} defaultSize={size?.[1] || 50} minSize={30}>
            {getSlot(1)}
          </ResizablePanel>
        </ResizablePanelGroup>
      );
    }
    // Grid 2x2 - 4 views in a grid
    if (currentLayout === "grid2x2") {
      return (
        <ResizablePanelGroup
          key="layout-grid2x2"
          direction="vertical"
        >
          {/* Top row */}
          <ResizablePanel ref={refs[0]} onResize={(e) => handleResize(e, 0)} defaultSize={size?.[0] || 50} minSize={30}>
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel ref={refs[1]} onResize={(e) => handleResize(e, 1)} className={className} defaultSize={size?.[1] || 50} minSize={20}>
                {getSlot(0)}
              </ResizablePanel>
              <ResizableHandle {...dragEvent} />
              <ResizablePanel ref={refs[2]} onResize={(e) => handleResize(e, 2)} className={className} defaultSize={size?.[2] || 50} minSize={20}>
                {getSlot(1)}
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle {...dragEvent} />
          {/* Bottom row */}
          <ResizablePanel ref={refs[3]} onResize={(e) => handleResize(e, 3)} defaultSize={size?.[3] || 50} minSize={30}>
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel ref={refs[4]} onResize={(e) => handleResize(e, 4)} className={className} defaultSize={size?.[4] || 50} minSize={20}>
                {getSlot(2)}
              </ResizablePanel>
              <ResizableHandle {...dragEvent} />
              <ResizablePanel ref={refs[5]} onResize={(e) => handleResize(e, 5)} className={className} defaultSize={size?.[5] || 50} minSize={20}>
                {getSlot(3)}
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      );
    }
    // Triple: 3 horizontal stacked
    if (currentLayout === "triple") {
      return (
        <ResizablePanelGroup
          key="layout-triple"
          direction="horizontal"
        >
          <ResizablePanel ref={refs[0]} onResize={(e) => handleResize(e, 0)} className={className} defaultSize={size?.[0] || 50} minSize={20}>
            {getSlot(0)}
          </ResizablePanel>
          <ResizableHandle {...dragEvent} />
          <ResizablePanel ref={refs[1]} onResize={(e) => handleResize(e, 1)} className={className} defaultSize={size?.[1] || 50} minSize={20}>
            {getSlot(1)}
          </ResizablePanel>
          <ResizableHandle {...dragEvent} />
          <ResizablePanel ref={refs[2]} onResize={(e) => handleResize(e, 2)} className={className} defaultSize={size?.[2] || 50} minSize={20}>
            {getSlot(2)}
          </ResizablePanel>
        </ResizablePanelGroup>
      );
    }
    // Triple-left: 1 left panel, 2 right panels stacked
    if (currentLayout === "triple-left") {
      return (
        <ResizablePanelGroup
          key="layout-triple-left"
          direction="horizontal"
        >
          <ResizablePanel ref={refs[0]} onResize={(e) => handleResize(e, 0)} className={className} defaultSize={size?.[0] || 50} minSize={30}>
            {getSlot(0)}
          </ResizablePanel>
          <ResizableHandle {...dragEvent} />
          <ResizablePanel ref={refs[1]} onResize={(e) => handleResize(e, 1)} defaultSize={size?.[1] || 50} minSize={20}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel ref={refs[2]} onResize={(e) => handleResize(e, 2)} className={className} defaultSize={defaultSizes?.[2] || 50} minSize={30}>
                {getSlot(1)}
              </ResizablePanel>
              <ResizableHandle {...dragEvent} />
              <ResizablePanel ref={refs[3]} onResize={(e) => handleResize(e, 3)} className={className} defaultSize={size?.[3] || 50} minSize={30}>
                {getSlot(2)}
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      );
    }
    // Triple-right: 2 left panels stacked, 1 right panel
    if (currentLayout === "triple-right") {
      return (
        <ResizablePanelGroup
          key="layout-triple-right"
          direction="horizontal"
        >
          <ResizablePanel ref={refs[0]} onResize={(e) => handleResize(e, 0)} defaultSize={size?.[0] || 50} minSize={20}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel ref={refs[1]} onResize={(e) => handleResize(e, 1)} className={className} defaultSize={size?.[1] || 50} minSize={30}>
                {getSlot(0)}
              </ResizablePanel>
              <ResizableHandle {...dragEvent} />
              <ResizablePanel ref={refs[2]} onResize={(e) => handleResize(e, 2)} className={className} defaultSize={size?.[2] || 50} minSize={30}>
                {getSlot(1)}
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle {...dragEvent} />
          <ResizablePanel ref={refs[3]} onResize={(e) => handleResize(e, 3)} className={className} defaultSize={size?.[3] || 50} minSize={30}>
            {getSlot(2)}
          </ResizablePanel>
        </ResizablePanelGroup>
      );
    }
    // Triple-top: 1 top panel, 2 bottom panels side by side
    if (currentLayout === "triple-top") {
      return (
        <ResizablePanelGroup
          key="layout-triple-top"
          direction="vertical"
        >
          <ResizablePanel ref={refs[0]} onResize={(e) => handleResize(e, 0)} className={className} defaultSize={size?.[0] || 50} minSize={30}>
            {getSlot(0)}
          </ResizablePanel>
          <ResizableHandle {...dragEvent} />
          <ResizablePanel ref={refs[1]} onResize={(e) => handleResize(e, 1)} defaultSize={size?.[1] || 50} minSize={30}>
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel ref={refs[2]} onResize={(e) => handleResize(e, 2)} className={className} defaultSize={size?.[2] || 50} minSize={20}>
                {getSlot(1)}
              </ResizablePanel>
              <ResizableHandle {...dragEvent} />
              <ResizablePanel ref={refs[3]} onResize={(e) => handleResize(e, 3)} className={className} defaultSize={size?.[3] || 50} minSize={20}>
                {getSlot(2)}
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      );
    }
    // Triple-bottom: 2 top panels side by side, 1 bottom panel
    if (currentLayout === "triple-bottom") {
      return (
        <ResizablePanelGroup
          key="layout-triple-bottom"
          direction="vertical"
        >
          <ResizablePanel ref={refs[0]} onResize={(e) => handleResize(e, 0)} defaultSize={size?.[0] || 50} minSize={30}>
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel ref={refs[1]} onResize={(e) => handleResize(e, 1)} className={className} defaultSize={size?.[1] || 50} minSize={20}>
                {getSlot(0)}
              </ResizablePanel>
              <ResizableHandle {...dragEvent} />
              <ResizablePanel ref={refs[2]} onResize={(e) => handleResize(e, 2)} className={className} defaultSize={size?.[2] || 50} minSize={20}>
                {getSlot(1)}
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle {...dragEvent} />
          <ResizablePanel ref={refs[3]} onResize={(e) => handleResize(e, 3)} className={className} defaultSize={size?.[3] || 50} minSize={30}>
            {getSlot(2)}
          </ResizablePanel>
        </ResizablePanelGroup>
      );
    }
    // Single view
    return <div key="layout-single" className={'absolute top-0 left-0 w-full h-full'}>{getSlot(0)}</div>;
  }, [layout, size, actives, aspectRatio])
  return (
    <>
      {renderLayout()}
      <div ref={hiddenRef} style={{ display: 'none' }} />
      {mounted && childArray.map((child) => {
        const key = (child as any).key;
        const node = nodesRef.current.get(key);
        if (node) {
          return createPortal(child, node, key);
        }
        return null;
      })}
    </>
  );
}
