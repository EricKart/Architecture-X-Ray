"use client";
import { useRef, useState } from "react";
import clsx from "clsx";

/**
 * Minimal draggable-divider primitives for resizable layout panels.
 * No dependency: pointer capture + a persisted size in localStorage per key.
 * The stored size is read in a lazy useState initializer (not an effect) so the
 * panel is the right size on first paint instead of jumping after mount.
 */
export function useResizablePanel(key: string, initial: number, min: number, max: number) {
  const [size, setSizeState] = useState(() => {
    if (typeof window === "undefined") return initial;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored) {
        const n = Number(stored);
        if (Number.isFinite(n)) return clamp(n, min, max);
      }
    } catch {
      /* localStorage unavailable (private mode, etc.) - keep the default */
    }
    return initial;
  });

  const setSize = (updater: number | ((prev: number) => number)) => {
    setSizeState((prev) => {
      const next = clamp(typeof updater === "function" ? (updater as (p: number) => number)(prev) : updater, min, max);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return [size, setSize] as const;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function Divider({ axis, onDelta, className, title }: { axis: "x" | "y"; onDelta: (deltaPx: number) => void; className?: string; title?: string }) {
  const draggingRef = useRef(false);
  const lastRef = useRef(0);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    lastRef.current = axis === "x" ? e.clientX : e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const cur = axis === "x" ? e.clientX : e.clientY;
    onDelta(cur - lastRef.current);
    lastRef.current = cur;
  };
  const endDrag = () => {
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      title={title ?? "Drag to resize"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={clsx(
        "group relative shrink-0 touch-none bg-transparent",
        axis === "x" ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize",
        className,
      )}
    >
      <div className={clsx("pointer-events-none absolute inset-0 m-auto rounded bg-line-2 opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100 group-active:bg-terra", axis === "x" ? "w-0.5" : "h-0.5")} />
    </div>
  );
}
