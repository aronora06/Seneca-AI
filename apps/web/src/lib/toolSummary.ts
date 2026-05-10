/**
 * One-line summaries for tool chips. Keeps tool-specific knowledge in one
 * file so the transcript bubble doesn't grow a switch statement per tool.
 */

import type { ToolCallRecord } from "@seneca/shared";

export interface ToolPresentation {
  /** Short label to show on the chip. */
  label: string;
  /** One-line summary of what the tool did. */
  summary: string;
}

const FRIENDLY_NAMES: Record<string, string> = {
  whiteboard_add_element: "draw",
  whiteboard_clear: "clear board",
};

export function presentTool(rec: ToolCallRecord): ToolPresentation {
  const label = FRIENDLY_NAMES[rec.name] ?? rec.name;
  return { label, summary: summarizeInput(rec.name, rec.input) };
}

function summarizeInput(
  name: string,
  input: Record<string, unknown>,
): string {
  if (name === "whiteboard_clear") return "wiped the whiteboard";
  if (name === "whiteboard_add_element") {
    const t = String(input.type ?? "element");
    const x = num(input.x);
    const y = num(input.y);
    const at = x !== null && y !== null ? ` at (${x}, ${y})` : "";
    if (t === "text") {
      return `text “${truncate(String(input.text ?? ""), 36)}”${at}`;
    }
    if (t === "rectangle" || t === "ellipse") {
      const w = num(input.width) ?? 120;
      const h = num(input.height) ?? 80;
      return `${t} ${w}×${h}${at}`;
    }
    if (t === "line" || t === "arrow" || t === "freedraw") {
      const pts = Array.isArray(input.points) ? input.points.length : 0;
      return `${t} (${pts} pts)${at}`;
    }
    return `${t}${at}`;
  }
  // Generic fallback.
  const keys = Object.keys(input).slice(0, 3);
  if (keys.length === 0) return "—";
  return keys.map((k) => `${k}=${shortValue(input[k])}`).join(", ");
}

function num(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.round(v);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function shortValue(v: unknown): string {
  if (typeof v === "string") return `"${truncate(v, 16)}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (v && typeof v === "object") return `{…}`;
  return String(v);
}
