import { useState, useEffect, useLayoutEffect, useRef } from "react";

function classifyAspectRatio(width: number, height: number) {
  const targetRatios = {
    "16:9": 16 / 9,
    "9:16": 9 / 16,
    "1:1": 1 / 1,
    "4:3": 4 / 3,
    "21:9": 21 / 9
  };
  // Calculate actual ratio
  const actualRatio = width / height;
  // Find closest match
  let closestRatio = null;
  let smallestDifference = Infinity;
  for (const [name, value] of Object.entries(targetRatios)) {
    const difference = Math.abs(actualRatio - value);
    if (difference < smallestDifference) {
      smallestDifference = difference;
      closestRatio = name;
    }
  }
  return closestRatio;
}
// Examples
console.log(classifyAspectRatio(1920, 1080)); // "16:9"
console.log(classifyAspectRatio(1080, 1920)); // "9:16"
console.log(classifyAspectRatio(1000, 1000)); // "1:1"
console.log(classifyAspectRatio(1024, 768));  // "4:3"
console.log(classifyAspectRatio(2560, 1080)); // "21:9"
console.log(classifyAspectRatio(1400, 1000)); // "4:3" (1.4 is closest to 1.333...)

export default function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [state, setState] = useState({
    width: 0,
    height: 0,
    overflowX: false,
    overflowY: false,
    aspectRatio: "16:9",
  });
  useEffect(() => {
    if (!ref.current) return;
    const element = ref.current;
    const observer = new ResizeObserver((entries) => {
      if (!Array.isArray(entries) || !entries.length) return;
      const entry = entries[0];
      let width: number;
      let height: number;
      if (entry.borderBoxSize && entry.borderBoxSize.length > 0) {
        width = entry.borderBoxSize[0].inlineSize;
        height = entry.borderBoxSize[0].blockSize;
      } else {
        width = entry.contentRect.width;
        height = entry.contentRect.height;
      }
      const isHidden = width === 0 && height === 0;
      if (!isHidden) {
        setState((prev) => {
          if (prev.width === width && prev.height === height) {
            return prev;
          }
          return { ...prev, width, height, aspectRatio: classifyAspectRatio(width, height) || "16:9" };
        });
      }
    });
    observer.observe(element, { box: "border-box" });
    return () => {
      observer.disconnect();
    };
  }, []);
  // Check overflow after layout updates (when content changes)
  useLayoutEffect(() => {
    if (!ref.current) return;
    const element = ref.current;
    const overflowX = element.scrollWidth > element.clientWidth;
    const overflowY = element.scrollHeight > element.clientHeight;
    setState((prev) => {
      if (prev.overflowX === overflowX && prev.overflowY === overflowY) {
        return prev;
      }
      return { ...prev, overflowX, overflowY };
    });
  }, [state.width, state.height]);
  return [ref, state] as const;
}