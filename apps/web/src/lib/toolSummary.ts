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
  map_fly_to: "fly to",
  map_drop_pin: "drop pin",
  map_draw_shape: "draw on map",
  map_set_layer: "switch layer",
  web_navigate: "navigate",
  web_search: "web search",
  web_read_page: "read page",
  document_go_to_page: "open page",
  document_read_page: "read page",
  document_list: "list docs",
  document_search: "search docs",
  document_create: "write doc",
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
  if (name === "map_fly_to") {
    const ll = formatLatLng(input.lat, input.lng);
    const z = num(input.zoom);
    const label = typeof input.label === "string" ? input.label : "";
    const labelPart = label ? ` — ${truncate(label, 24)}` : "";
    const zoomPart = z !== null ? ` z${z}` : "";
    return `${ll}${zoomPart}${labelPart}`;
  }
  if (name === "map_drop_pin") {
    const ll = formatLatLng(input.lat, input.lng);
    const label = typeof input.label === "string" ? input.label : "";
    return label ? `“${truncate(label, 32)}” at ${ll}` : ll;
  }
  if (name === "map_draw_shape") {
    const t = String(input.type ?? "shape");
    const pts = Array.isArray(input.points) ? input.points.length : 0;
    const label = typeof input.label === "string" ? input.label : "";
    const labelPart = label ? ` — ${truncate(label, 24)}` : "";
    return `${t} (${pts} pts)${labelPart}`;
  }
  if (name === "map_set_layer") {
    return String(input.layer ?? "—");
  }
  if (name === "web_navigate") {
    const u = typeof input.url === "string" ? input.url : "";
    return prettyUrl(u);
  }
  if (name === "web_search") {
    const q = typeof input.query === "string" ? input.query : "";
    const max =
      typeof input.max_results === "number" && Number.isFinite(input.max_results)
        ? input.max_results
        : 5;
    return `“${truncate(q, 36)}” (top ${max})`;
  }
  if (name === "web_read_page") {
    const u = typeof input.url === "string" && input.url ? input.url : "";
    return u ? prettyUrl(u) : "current page";
  }
  if (name === "document_go_to_page") {
    const p = num(input.page);
    const docId =
      typeof input.document_id === "string" ? input.document_id : "";
    const tail = docId ? ` (doc ${truncate(docId, 8)})` : "";
    return p !== null ? `page ${p}${tail}` : "—";
  }
  if (name === "document_read_page") {
    const p = num(input.page);
    const docId =
      typeof input.document_id === "string" ? input.document_id : "";
    const tail = docId ? ` (doc ${truncate(docId, 8)})` : "";
    return p !== null ? `page ${p}${tail}` : "current doc";
  }
  if (name === "document_list") {
    return "loaded documents";
  }
  if (name === "document_search") {
    const q = typeof input.query === "string" ? input.query : "";
    const max =
      typeof input.top_k === "number" && Number.isFinite(input.top_k)
        ? input.top_k
        : 5;
    const docId =
      typeof input.document_id === "string" ? input.document_id : "";
    const scope = docId ? ` in doc ${truncate(docId, 8)}` : "";
    return `“${truncate(q, 36)}” (top ${max})${scope}`;
  }
  if (name === "document_create") {
    const title = typeof input.title === "string" ? input.title : "";
    return title ? `“${truncate(title, 36)}”` : "new document";
  }
  // Generic fallback.
  const keys = Object.keys(input).slice(0, 3);
  if (keys.length === 0) return "—";
  return keys.map((k) => `${k}=${shortValue(input[k])}`).join(", ");
}

function formatLatLng(lat: unknown, lng: unknown): string {
  const a = typeof lat === "number" && Number.isFinite(lat) ? lat : null;
  const b = typeof lng === "number" && Number.isFinite(lng) ? lng : null;
  if (a === null || b === null) return "—";
  return `(${a.toFixed(2)}, ${b.toFixed(2)})`;
}

function prettyUrl(raw: string): string {
  if (!raw) return "—";
  try {
    const u = new URL(raw);
    const tail = u.pathname === "/" ? "" : u.pathname;
    return truncate(`${u.hostname.replace(/^www\./, "")}${tail}`, 48);
  } catch {
    return truncate(raw, 48);
  }
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
