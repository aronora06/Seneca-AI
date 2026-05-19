/**
 * Whiteboard spatial helpers: viewport bounds, scene digest, placement lint.
 */

import type {
  WorkspaceSceneElementDigest,
  WorkspaceViewportBounds,
  WhiteboardPlacementResult,
} from "@seneca/shared";

const DEFAULT_VIEWPORT_PX = { width: 1200, height: 800 };
const MAX_DIGEST = 20;
/** Fallback when canvas measureText is unavailable (tests / SSR). */
const CHAR_WIDTH_FACTOR = 0.62;
const WIDTH_SAFETY_MARGIN = 1.12;

type ElementLike = Record<string, unknown>;

let measureCanvas: HTMLCanvasElement | null = null;

/**
 * Measure the pixel width Excalidraw needs for a single-line label.
 * Uses canvas measureText after fonts load; adds margin for Virgil / emoji.
 */
export function measureTextWidth(
  text: string,
  fontSize: number,
): number {
  const lines = text.split("\n");
  let maxLine = 0;
  for (const line of lines) {
    maxLine = Math.max(maxLine, measureLineWidth(line, fontSize));
  }
  return Math.ceil(maxLine * WIDTH_SAFETY_MARGIN) + 16;
}

function measureLineWidth(line: string, fontSize: number): number {
  if (typeof document !== "undefined") {
    measureCanvas ??= document.createElement("canvas");
    const ctx = measureCanvas.getContext("2d");
    if (ctx) {
      ctx.font = `${fontSize}px Virgil, Excalifont, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      return ctx.measureText(line).width;
    }
  }
  return fallbackLineWidth(line, fontSize);
}

function fallbackLineWidth(line: string, fontSize: number): number {
  let w = 0;
  for (const char of line) {
    const cp = char.codePointAt(0) ?? 0;
    if (isEmojiCodePoint(cp)) {
      w += fontSize * 1.15;
    } else if (char === " ") {
      w += fontSize * 0.28;
    } else {
      w += fontSize * CHAR_WIDTH_FACTOR;
    }
  }
  return w;
}

function isEmojiCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x1f600 && cp <= 0x1f64f)
  );
}

export function estimateTextWidth(
  text: string,
  fontSize: number,
  explicitWidth?: number,
): number {
  if (explicitWidth != null && explicitWidth > 0) {
    return Math.max(explicitWidth, measureTextWidth(text, fontSize));
  }
  return measureTextWidth(text, fontSize);
}

export function computeViewportBounds(
  appState: Record<string, unknown> | undefined,
): WorkspaceViewportBounds {
  const zoomRaw = appState?.zoom;
  const zoom =
    typeof zoomRaw === "object" &&
    zoomRaw != null &&
    "value" in (zoomRaw as object)
      ? Number((zoomRaw as { value: number }).value)
      : Number(zoomRaw);
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const scrollX = Number(appState?.scrollX ?? 0);
  const scrollY = Number(appState?.scrollY ?? 0);
  const w = DEFAULT_VIEWPORT_PX.width / z;
  const h = DEFAULT_VIEWPORT_PX.height / z;
  return {
    minX: -scrollX,
    minY: -scrollY,
    maxX: -scrollX + w,
    maxY: -scrollY + h,
  };
}

export function elementBounds(el: ElementLike): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const x = Number(el.x ?? 0);
  const y = Number(el.y ?? 0);
  const w = Number(el.width ?? 0);
  const h = Number(el.height ?? 0);
  return { x, y, width: w, height: h };
}

export function buildSceneDigest(
  elements: unknown[],
  max = MAX_DIGEST,
): WorkspaceSceneElementDigest[] {
  if (!Array.isArray(elements) || elements.length === 0) return [];
  const slice = elements.slice(-max) as ElementLike[];
  return slice.map((el) => {
    const { x, y, width, height } = elementBounds(el);
    const type = String(el.type ?? "unknown");
    const text =
      type === "text" && typeof el.text === "string"
        ? truncate(el.text, 60)
        : undefined;
    return {
      id: String(el.id ?? ""),
      type,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
      ...(text ? { text } : {}),
      ...(typeof el.strokeColor === "string"
        ? { strokeColor: el.strokeColor }
        : {}),
    };
  });
}

export function lintWhiteboardPlacement(
  el: ElementLike,
  viewport: WorkspaceViewportBounds,
  requestedText?: string,
): string[] {
  const warnings: string[] = [];
  const { x, y, width, height } = elementBounds(el);
  const right = x + width;
  const bottom = y + height;

  if (right > viewport.maxX + 8) {
    warnings.push(
      `Element extends past the visible right edge (x+width=${Math.round(right)}, viewport maxX=${Math.round(viewport.maxX)}).`,
    );
  }
  if (bottom > viewport.maxY + 8) {
    warnings.push(
      `Element extends below the visible area (y+height=${Math.round(bottom)}, viewport maxY=${Math.round(viewport.maxY)}).`,
    );
  }
  if (x < viewport.minX - 8 || y < viewport.minY - 8) {
    warnings.push("Element is placed above/left of the current visible viewport.");
  }

  if (String(el.type) === "text" && requestedText) {
    const fontSize = Number(el.fontSize ?? 20);
    const needed = measureTextWidth(requestedText, fontSize);
    if (width > 0 && width < needed * 0.92) {
      warnings.push(
        `Text may be clipped: box width ${Math.round(width)}px but content likely needs ~${Math.round(needed)}px. Pass a larger width or shorten the label.`,
      );
    }
    if (height > 0 && height < fontSize * 1.1 && !requestedText.includes("\n")) {
      warnings.push(
        `Text box height ${Math.round(height)}px may clip ${fontSize}px type.`,
      );
    }
  }

  return warnings;
}

export function placementFromElement(
  el: ElementLike,
  appliedStrokeColor: string,
  warnings: string[],
): WhiteboardPlacementResult {
  const { x, y, width, height } = elementBounds(el);
  const out: WhiteboardPlacementResult = {
    elementId: String(el.id ?? ""),
    type: String(el.type ?? "unknown"),
    x,
    y,
    width,
    height,
    appliedStrokeColor,
  };
  if (typeof el.text === "string") out.text = el.text;
  if (warnings.length > 0) out.warnings = warnings;
  return out;
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}
