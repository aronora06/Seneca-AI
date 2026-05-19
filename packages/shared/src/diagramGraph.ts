/**
 * Pure draw.io mxGraphModel parser (no DOM / iframe).
 */

import { isEmptyDiagram } from "./diagramEmpty.js";

export interface DiagramVertex {
  id: string;
  label: string;
  style?: string;
  shape?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramEdge {
  id: string;
  label: string;
  source: string;
  target: string;
}

export interface DiagramBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiagramGraph {
  vertices: DiagramVertex[];
  edges: DiagramEdge[];
  cellCount: number;
  hasContent: boolean;
  bounds?: DiagramBounds;
}

export interface DiagramGraphDigestCaps {
  maxVertices?: number;
  maxEdges?: number;
  maxLabelLen?: number;
}

export interface DiagramGraphDigest {
  cellCount: number;
  hasContent: boolean;
  labelDigest: string[];
  vertexCount: number;
  edgeCount: number;
  vertices: { id: string; label: string; shape?: string }[];
  edges: { id: string; from: string; to: string; label?: string }[];
  bounds?: DiagramBounds;
}

export interface DiagramGraphDiff {
  addedVertices: string[];
  removedVertices: string[];
  addedEdges: string[];
  removedEdges: string[];
  labelChanges: { id: string; from: string; to: string }[];
}

const STRUCTURAL_IDS = new Set(["0", "1"]);
const MAX_LINT_CELLS = 200;
const MAX_BBOX_DIM = 20_000;

/** Group 2 is `/>` (self-close) or `>` (open); open cells use group 3 as inner XML. */
const MX_CELL_RE =
  /<mxCell\b([^>]*?)\s*(\/>|>([\s\S]*?)<\/mxCell>)/g;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    out[m[1]!] = decodeXmlEntities(m[2]!);
  }
  return out;
}

function attr(tag: string, name: string): string | undefined {
  return parseAttrs(tag)[name];
}

function parseGeometry(inner: string): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const geo =
    /<mxGeometry\b([^>]*)(?:\/>|>)/.exec(inner)?.[1] ??
    /<mxGeometry\b([^>]*)(?:\/>|>)/.exec(inner)?.[0] ??
    "";
  const num = (n: string | undefined, fallback: number) => {
    const v = n != null ? Number(n) : NaN;
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    x: num(attr(geo, "x"), 0),
    y: num(attr(geo, "y"), 0),
    width: num(attr(geo, "width"), 80),
    height: num(attr(geo, "height"), 40),
  };
}

/** Extract a human-readable shape hint from draw.io style string. */
export function shapeHintFromStyle(style: string | undefined): string | undefined {
  if (!style) return undefined;
  const shape = /shape=([^;]+)/.exec(style)?.[1];
  if (shape) return shape;
  if (/ellipse/i.test(style)) return "ellipse";
  if (/rhombus/i.test(style)) return "rhombus";
  if (/swimlane/i.test(style)) return "swimlane";
  return undefined;
}

function unionBounds(vertices: DiagramVertex[]): DiagramBounds | undefined {
  if (vertices.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x + v.width);
    maxY = Math.max(maxY, v.y + v.height);
  }
  if (!Number.isFinite(minX)) return undefined;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function parseDiagramGraph(xml: string): DiagramGraph {
  const vertices: DiagramVertex[] = [];
  const edges: DiagramEdge[] = [];
  const labels: string[] = [];

  let m: RegExpExecArray | null;
  MX_CELL_RE.lastIndex = 0;
  while ((m = MX_CELL_RE.exec(xml)) !== null) {
    const attrs = m[1]!;
    const inner = m[2] === "/>" ? "" : (m[3] ?? "");
    const id = attr(attrs, "id");
    if (!id || STRUCTURAL_IDS.has(id)) continue;

    const parsed = parseAttrs(attrs);
    const value = parsed.value ?? "";
    const isVertex = parsed.vertex === "1";
    const isEdge = parsed.edge === "1";

    if (isVertex) {
      const style = parsed.style;
      const geo = parseGeometry(inner);
      const label = value.trim();
      if (label) labels.push(label);
      vertices.push({
        id,
        label,
        style,
        shape: shapeHintFromStyle(style),
        ...geo,
      });
    } else if (isEdge) {
      const source = parsed.source ?? "";
      const target = parsed.target ?? "";
      const label = value.trim();
      if (label) labels.push(label);
      edges.push({ id, label, source, target });
    } else if (value.trim()) {
      labels.push(value.trim());
    }
  }

  const cellCount = vertices.length + edges.length;
  return {
    vertices,
    edges,
    cellCount,
    hasContent: !isEmptyDiagram(xml) && cellCount > 0,
    bounds: unionBounds(vertices),
  };
}

export function digestDiagramGraph(
  graph: DiagramGraph,
  caps: DiagramGraphDigestCaps = {},
): DiagramGraphDigest {
  const maxV = caps.maxVertices ?? 20;
  const maxE = caps.maxEdges ?? 30;
  const maxLabelLen = caps.maxLabelLen ?? 80;

  const truncate = (s: string) =>
    s.length > maxLabelLen ? `${s.slice(0, maxLabelLen)}…` : s;

  const labelDigest: string[] = [];
  for (const v of graph.vertices) {
    if (!v.label.trim()) continue;
    if (labelDigest.length >= maxV) break;
    labelDigest.push(truncate(v.label));
  }
  for (const e of graph.edges) {
    if (!e.label.trim()) continue;
    if (labelDigest.length >= maxV + maxE) break;
    labelDigest.push(truncate(e.label));
  }

  return {
    cellCount: graph.cellCount,
    hasContent: graph.hasContent,
    labelDigest,
    vertexCount: graph.vertices.length,
    edgeCount: graph.edges.length,
    vertices: graph.vertices.slice(0, maxV).map((v) => ({
      id: v.id,
      label: truncate(v.label || v.id),
      ...(v.shape ? { shape: v.shape } : {}),
    })),
    edges: graph.edges.slice(0, maxE).map((e) => ({
      id: e.id,
      from: e.source,
      to: e.target,
      ...(e.label ? { label: truncate(e.label) } : {}),
    })),
    bounds: graph.bounds,
  };
}

export function diffDiagramGraph(
  beforeXml: string,
  afterXml: string,
): DiagramGraphDiff {
  const before = parseDiagramGraph(beforeXml);
  const after = parseDiagramGraph(afterXml);

  const beforeV = new Map(before.vertices.map((v) => [v.id, v]));
  const afterV = new Map(after.vertices.map((v) => [v.id, v]));
  const beforeE = new Map(before.edges.map((e) => [e.id, e]));
  const afterE = new Map(after.edges.map((e) => [e.id, e]));

  const addedVertices: string[] = [];
  const removedVertices: string[] = [];
  const addedEdges: string[] = [];
  const removedEdges: string[] = [];
  const labelChanges: { id: string; from: string; to: string }[] = [];

  for (const id of afterV.keys()) {
    if (!beforeV.has(id)) addedVertices.push(id);
    else {
      const b = beforeV.get(id)!;
      const a = afterV.get(id)!;
      if (b.label !== a.label) {
        labelChanges.push({ id, from: b.label, to: a.label });
      }
    }
  }
  for (const id of beforeV.keys()) {
    if (!afterV.has(id)) removedVertices.push(id);
  }

  for (const id of afterE.keys()) {
    if (!beforeE.has(id)) addedEdges.push(id);
  }
  for (const id of beforeE.keys()) {
    if (!afterE.has(id)) removedEdges.push(id);
  }

  return {
    addedVertices,
    removedVertices,
    addedEdges,
    removedEdges,
    labelChanges,
  };
}

export function lintDiagramGraph(graph: DiagramGraph): string[] {
  const warnings: string[] = [];
  const vertexIds = new Set(graph.vertices.map((v) => v.id));

  if (graph.cellCount > MAX_LINT_CELLS) {
    warnings.push(
      `Diagram has ${graph.cellCount} cells (>${MAX_LINT_CELLS}); consider simplifying.`,
    );
  }

  if (graph.bounds) {
    if (graph.bounds.w > MAX_BBOX_DIM || graph.bounds.h > MAX_BBOX_DIM) {
      warnings.push("Diagram bounding box is very large; layout may be hard to read.");
    }
  }

  const labelCounts = new Map<string, number>();
  for (const v of graph.vertices) {
    const key = v.label.trim().toLowerCase();
    if (!key) continue;
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }
  for (const [label, count] of labelCounts) {
    if (count > 1) {
      warnings.push(`Duplicate vertex label "${label}" appears ${count} times.`);
    }
  }

  for (const e of graph.edges) {
    if (
      e.source &&
      !STRUCTURAL_IDS.has(e.source) &&
      !vertexIds.has(e.source)
    ) {
      warnings.push(`Edge ${e.id} references missing source cell ${e.source}.`);
    }
    if (
      e.target &&
      !STRUCTURAL_IDS.has(e.target) &&
      !vertexIds.has(e.target)
    ) {
      warnings.push(`Edge ${e.id} references missing target cell ${e.target}.`);
    }
  }

  return warnings;
}

export const MERMAID_MAX_VERTICES = 40;

export interface GraphToMermaidOptions {
  direction?: "TD" | "LR";
  maxNodes?: number;
  maxEdges?: number;
}

function mermaidId(cellId: string): string {
  const safe = cellId.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z_]/.test(safe) ? safe : `n_${safe}`;
}

function mermaidLabel(text: string): string {
  const t = text.replace(/"/g, "'").replace(/[\[\]{}|]/g, " ").trim();
  return t.slice(0, 60);
}

/** Build a flowchart Mermaid string from a parsed graph (capped). */
export function graphToMermaid(
  graph: DiagramGraph,
  opts: GraphToMermaidOptions = {},
): string | undefined {
  const maxNodes = opts.maxNodes ?? MERMAID_MAX_VERTICES;
  const maxEdges = opts.maxEdges ?? 60;
  const dir = opts.direction ?? "TD";

  if (graph.vertices.length === 0) return undefined;
  if (graph.vertices.length > maxNodes) return undefined;

  const lines: string[] = [`flowchart ${dir}`];
  const idMap = new Map<string, string>();

  for (const v of graph.vertices.slice(0, maxNodes)) {
    const mid = mermaidId(v.id);
    idMap.set(v.id, mid);
    const label = mermaidLabel(v.label || v.id);
    lines.push(`  ${mid}["${label}"]`);
  }

  let edgeCount = 0;
  for (const e of graph.edges) {
    if (edgeCount >= maxEdges) break;
    const from = idMap.get(e.source);
    const to = idMap.get(e.target);
    if (!from || !to) continue;
    if (e.label.trim()) {
      lines.push(`  ${from} -->|${mermaidLabel(e.label)}| ${to}`);
    } else {
      lines.push(`  ${from} --> ${to}`);
    }
    edgeCount++;
  }

  return lines.length > 1 ? lines.join("\n") : undefined;
}
