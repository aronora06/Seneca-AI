import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  clampPanelPosition,
  defaultFloatingVoicePosition,
} from "../lib/panelPosition";
import { readPrefs, writePrefs } from "../lib/userPreferences";

const DRAG_THRESHOLD_PX = 4;

export const WORKSPACE_STAGE_ID = "workspace-stage";

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

export function useDraggablePosition(options: {
  enabled: boolean;
  dockSide: "left" | "right";
  panelRef: React.RefObject<HTMLElement | null>;
}): {
  position: { x: number; y: number };
  dragHandleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
  isDragging: boolean;
} {
  const { enabled, dockSide, panelRef } = options;
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const positionRef = useRef(position);
  positionRef.current = position;

  const measure = useCallback(() => {
    const boundsEl = document.getElementById(WORKSPACE_STAGE_ID);
    const panel = panelRef.current;
    if (!boundsEl || !panel) return null;
    const bounds = boundsEl.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      bounds: { width: bounds.width, height: bounds.height },
      panel: { width: panelRect.width, height: panelRect.height },
    };
  }, [panelRef]);

  const applyPosition = useCallback(
    (next: { x: number; y: number }, persist: boolean) => {
      const m = measure();
      if (!m) {
        setPosition(next);
        return;
      }
      const clamped = clampPanelPosition(next, m.panel, m.bounds);
      setPosition(clamped);
      if (persist) {
        writePrefs({ floatingVoicePosition: clamped });
      }
    },
    [measure],
  );

  // Seed from storage or default when the dock becomes visible.
  useLayoutEffect(() => {
    if (!enabled) return;
    const m = measure();
    if (!m) return;
    const stored = readPrefs().floatingVoicePosition;
    if (stored) {
      applyPosition(stored, false);
    } else {
      applyPosition(
        defaultFloatingVoicePosition(m.bounds, m.panel, dockSide),
        false,
      );
    }
  }, [enabled, dockSide, measure, applyPosition]);

  // Keep inside bounds on window resize.
  useEffect(() => {
    if (!enabled) return;
    const boundsEl = document.getElementById(WORKSPACE_STAGE_ID);
    if (!boundsEl) return;
    const ro = new ResizeObserver(() => {
      applyPosition(positionRef.current, false);
    });
    ro.observe(boundsEl);
    return () => ro.disconnect();
  }, [enabled, applyPosition]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: positionRef.current.x,
      originY: positionRef.current.y,
      moved: false,
    };
    setIsDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      applyPosition(
        { x: drag.originX + dx, y: drag.originY + dy },
        false,
      );
    },
    [applyPosition],
  );

  const finishDrag = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      setIsDragging(false);
      if (drag.moved) {
        applyPosition(positionRef.current, true);
      }
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [applyPosition],
  );

  return {
    position,
    isDragging,
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
    },
  };
}
