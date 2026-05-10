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
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

import type { WhiteboardAddElementInput } from "@seneca/shared";

const DEFAULT_STROKE = "#1e1e1e";
const DEFAULT_FILL = "transparent";

export function applyWhiteboardAdd(
  api: ExcalidrawImperativeAPI,
  rawInput: unknown,
): void {
  const input = coerceAddInput(rawInput);
  const skeleton = buildSkeleton(input);
  if (!skeleton) return;
  const newElements = convertToExcalidrawElements(
    [skeleton] as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: true },
  );
  const existing = api.getSceneElements() as readonly OrderedExcalidrawElement[];
  api.updateScene({
    elements: [...existing, ...(newElements as ExcalidrawElement[])],
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
): ExcalidrawElementSkeleton | null {
  const strokeColor = input.strokeColor ?? DEFAULT_STROKE;
  switch (input.type) {
    case "text": {
      if (!input.text || !input.text.trim()) {
        throw new Error("Text element requires non-empty `text`.");
      }
      return {
        type: "text",
        x: input.x,
        y: input.y,
        text: input.text,
        fontSize: input.fontSize ?? 20,
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
      // Excalidraw's freedraw element requires pressure data and a bunch of
      // other internal fields we can't easily synthesize. We approximate
      // freehand by rendering Seneca's intent as a `line` with many points;
      // it looks the same once stroke-roundness is applied.
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
