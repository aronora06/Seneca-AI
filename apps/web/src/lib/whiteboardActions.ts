/**
 * Translates `whiteboard.*` tool inputs into Excalidraw scene mutations.
 *
 * Uses Excalidraw's own `convertToExcalidrawElements` to fill in defaults
 * (seeds, versions, bound element ids, etc.) so what Seneca produces is
 * indistinguishable from what the user draws.
 */

import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

import type {
  WhiteboardAddElementInput,
  WhiteboardPlacementResult,
} from "@seneca/shared";

import { ensureReadableStroke } from "./whiteboardTheme";
import {
  computeViewportBounds,
  estimateTextWidth,
  lintWhiteboardPlacement,
  measureTextWidth,
  placementFromElement,
} from "./whiteboardScene";

const DEFAULT_FILL = "transparent";

export async function applyWhiteboardAdd(
  api: ExcalidrawImperativeAPI,
  rawInput: unknown,
): Promise<WhiteboardPlacementResult> {
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const input = coerceAddInput(rawInput);
  const appState = api.getAppState() as unknown as Record<string, unknown>;
  const bg =
    (appState.viewBackgroundColor as string | undefined) ?? "#f8f6f1";
  const viewport = computeViewportBounds(appState);
  const skeleton = buildSkeleton(input, bg, viewport);
  if (!skeleton) {
    throw new Error("Could not build whiteboard element.");
  }

  const newElements = convertToExcalidrawElements(
    [skeleton] as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: true },
  );
  const created = newElements[0] as ExcalidrawElement | undefined;
  if (!created) {
    throw new Error("Excalidraw did not produce an element.");
  }

  let sceneElements = [
    ...api.getSceneElements(),
    created,
  ] as ExcalidrawElement[];

  if (input.type === "text" && input.text) {
    sceneElements = widenTextElementIfNeeded(
      sceneElements,
      String(created.id),
      input.text,
      input.fontSize ?? 20,
      viewport,
    );
  }

  api.updateScene({ elements: sceneElements });

  const strokeColor = ensureReadableStroke(input.strokeColor, bg);
  const placed =
    sceneElements.find((e) => e.id === created.id) ?? created;
  const el = placed as unknown as Record<string, unknown>;
  const warnings = lintWhiteboardPlacement(
    el,
    viewport,
    input.type === "text" ? input.text : undefined,
  );

  return placementFromElement(el, strokeColor, warnings);
}

/**
 * Excalidraw sometimes finalizes a narrower width than the skeleton asked for
 * (font metrics, emoji). Bump width on the placed text element when needed.
 */
function widenTextElementIfNeeded(
  elements: ExcalidrawElement[],
  elementId: string,
  text: string,
  fontSize: number,
  viewport: ReturnType<typeof computeViewportBounds>,
): ExcalidrawElement[] {
  const needed = measureTextWidth(text, fontSize);
  const maxW = viewport.maxX - viewport.minX;
  const targetWidth = Math.min(Math.max(needed, 80), maxW);

  return elements.map((e) => {
    if (e.id !== elementId || e.type !== "text") return e;
    const current = Number(e.width ?? 0);
    if (current >= targetWidth * 0.98) return e;
    return { ...e, width: targetWidth } as ExcalidrawElement;
  });
}

export function applyWhiteboardClear(api: ExcalidrawImperativeAPI): void {
  api.updateScene({ elements: [] });
}

function coerceAddInput(raw: unknown): WhiteboardAddElementInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Tool input was not an object.");
  }
  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  if (
    type !== "text" &&
    type !== "rectangle" &&
    type !== "ellipse" &&
    type !== "line" &&
    type !== "arrow" &&
    type !== "freedraw"
  ) {
    throw new Error(`Unsupported element type: ${String(type)}`);
  }
  const x = Number(obj.x);
  const y = Number(obj.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Element coordinates must be finite numbers.");
  }
  const out: WhiteboardAddElementInput = { type, x, y };
  if (typeof obj.text === "string") out.text = obj.text;
  if (typeof obj.width === "number") out.width = obj.width;
  if (typeof obj.height === "number") out.height = obj.height;
  if (typeof obj.strokeColor === "string") out.strokeColor = obj.strokeColor;
  if (typeof obj.fontSize === "number") out.fontSize = obj.fontSize;
  if (Array.isArray(obj.points)) {
    out.points = obj.points
      .filter(
        (p): p is [number, number] =>
          Array.isArray(p) &&
          p.length === 2 &&
          Number.isFinite(p[0]) &&
          Number.isFinite(p[1]),
      )
      .map(([dx, dy]) => [Number(dx), Number(dy)] as [number, number]);
  }
  return out;
}

function buildSkeleton(
  input: WhiteboardAddElementInput,
  backgroundColor: string,
  viewport: ReturnType<typeof computeViewportBounds>,
): ExcalidrawElementSkeleton | null {
  const strokeColor = ensureReadableStroke(input.strokeColor, backgroundColor);
  switch (input.type) {
    case "text": {
      if (!input.text || !input.text.trim()) {
        throw new Error("Text element requires non-empty `text`.");
      }
      const fontSize = input.fontSize ?? 20;
      const maxW = viewport.maxX - viewport.minX - (input.x - viewport.minX);
      const width = estimateTextWidth(input.text, fontSize, input.width);
      const capped =
        Number.isFinite(maxW) && maxW > 80
          ? Math.min(width, maxW - 16)
          : width;
      return {
        type: "text",
        x: input.x,
        y: input.y,
        text: input.text,
        fontSize,
        width: capped,
        strokeColor,
      };
    }
    case "rectangle":
    case "ellipse": {
      return {
        type: input.type,
        x: input.x,
        y: input.y,
        width: input.width ?? 120,
        height: input.height ?? 80,
        strokeColor,
        backgroundColor: DEFAULT_FILL,
      };
    }
    case "line":
    case "arrow": {
      const pts = (input.points ?? [
        [0, 0],
        [input.width ?? 120, input.height ?? 0],
      ]) as [number, number][];
      return {
        type: input.type,
        x: input.x,
        y: input.y,
        points: pts,
        strokeColor,
      };
    }
    case "freedraw": {
      const pts = (input.points ?? [
        [0, 0],
        [40, 0],
      ]) as [number, number][];
      return {
        type: "line",
        x: input.x,
        y: input.y,
        points: pts,
        strokeColor,
      };
    }
    default:
      return null;
  }
}
