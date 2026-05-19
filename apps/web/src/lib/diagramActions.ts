/**
 * Client-side diagram tool handlers (draw.io embed).
 */

import type {
  DiagramAddNodesInput,
  DiagramLayoutInput,
  DiagramLoadInput,
  DiagramMergeInput,
  DiagramRemoveCellsInput,
  DiagramSetLabelInput,
  DiagramToolResult,
} from "@seneca/shared";
import {
  diffDiagramGraph,
  EMPTY_DIAGRAM_XML,
  lintDiagramGraph,
  parseDiagramGraph,
  removeCells,
  setCellLabel,
} from "@seneca/shared";

import { getDiagramBridge } from "./diagramBridge";
import { diagramXmlDigest } from "./diagramXmlDigest";
import { validateDiagramXml } from "./diagramXmlDigest";
import { useSenecaStore } from "../store/seneca";

function resolveLiveXml(): string {
  const bridge = getDiagramBridge();
  const live = bridge?.getLiveXml?.();
  if (live?.trim()) return live;
  return useSenecaStore.getState().diagrams?.xml ?? EMPTY_DIAGRAM_XML;
}

function buildToolResult(
  beforeXml: string,
  afterXml: string,
  extra: Partial<DiagramToolResult> = {},
): DiagramToolResult {
  const graph = parseDiagramGraph(afterXml);
  const digest = diagramXmlDigest(afterXml);
  const diff = diffDiagramGraph(beforeXml, afterXml);
  const warnings = lintDiagramGraph(graph);
  return {
    cellCount: digest.cellCount,
    hasContent: digest.hasContent,
    labels: digest.labelDigest,
    bounds: digest.bounds,
    diff: {
      addedVertices: diff.addedVertices,
      removedVertices: diff.removedVertices,
      addedEdges: diff.addedEdges,
      removedEdges: diff.removedEdges,
      labelChanges: diff.labelChanges,
    },
    ...(warnings.length > 0 ? { warnings } : {}),
    ...extra,
  };
}

export function coerceDiagramLoadInput(raw: unknown): DiagramLoadInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("diagram_load: invalid input.");
  }
  const o = raw as Record<string, unknown>;
  const format = o.format;
  const data = o.data;
  if (format !== "xml" && format !== "mermaid") {
    throw new Error("diagram_load: format must be 'xml' or 'mermaid'.");
  }
  if (typeof data !== "string" || !data.trim()) {
    throw new Error("diagram_load: data is required.");
  }
  return { format, data: data.trim() };
}

export function coerceDiagramMergeInput(raw: unknown): DiagramMergeInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("diagram_merge: invalid input.");
  }
  const xml = (raw as { xml?: unknown }).xml;
  if (typeof xml !== "string" || !xml.trim()) {
    throw new Error("diagram_merge: xml is required.");
  }
  return { xml: xml.trim() };
}

export function coerceDiagramSetLabelInput(raw: unknown): DiagramSetLabelInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("diagram_set_label: invalid input.");
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.cellId !== "string" || !o.cellId.trim()) {
    throw new Error("diagram_set_label: cellId is required.");
  }
  if (typeof o.text !== "string") {
    throw new Error("diagram_set_label: text is required.");
  }
  return { cellId: o.cellId.trim(), text: o.text };
}

export function coerceDiagramRemoveCellsInput(
  raw: unknown,
): DiagramRemoveCellsInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("diagram_remove_cells: invalid input.");
  }
  const ids = (raw as { cellIds?: unknown }).cellIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("diagram_remove_cells: cellIds must be a non-empty array.");
  }
  const cellIds = ids.filter((x): x is string => typeof x === "string" && !!x.trim());
  if (cellIds.length === 0) {
    throw new Error("diagram_remove_cells: cellIds must contain strings.");
  }
  return { cellIds };
}

export function coerceDiagramAddNodesInput(raw: unknown): DiagramAddNodesInput {
  return coerceDiagramMergeInput(raw) as DiagramAddNodesInput;
}

export function coerceDiagramLayoutInput(raw: unknown): DiagramLayoutInput {
  if (!raw || typeof raw !== "object") {
    return { algorithm: "verticalFlow" };
  }
  const algo = (raw as { algorithm?: unknown }).algorithm;
  if (
    algo === "horizontalFlow" ||
    algo === "verticalFlow" ||
    algo === "organic"
  ) {
    return { algorithm: algo };
  }
  return { algorithm: "verticalFlow" };
}

export async function applyDiagramLoad(
  input: DiagramLoadInput,
): Promise<DiagramToolResult> {
  const bridge = getDiagramBridge();
  if (!bridge?.isReady()) {
    throw new Error("Diagram editor is not mounted.");
  }
  const before = resolveLiveXml();
  if (input.format === "xml") {
    const err = validateDiagramXml(input.data);
    if (err) throw new Error(`diagram_load: ${err}`);
    await bridge.loadXml(input.data);
  } else {
    await bridge.loadMermaid(input.data);
  }
  return buildToolResult(before, resolveLiveXml());
}

export async function applyDiagramMerge(
  input: DiagramMergeInput,
): Promise<DiagramToolResult> {
  const bridge = getDiagramBridge();
  if (!bridge?.isReady()) {
    throw new Error("Diagram editor is not mounted.");
  }
  const err = validateDiagramXml(input.xml);
  if (err) throw new Error(`diagram_merge: ${err}`);
  const before = resolveLiveXml();
  const result = await bridge.mergeXml(input.xml);
  if (!result.merged) {
    throw new Error(result.error ?? "diagram_merge failed.");
  }
  return buildToolResult(before, resolveLiveXml(), { merged: true });
}

export async function applyDiagramClear(): Promise<DiagramToolResult> {
  const bridge = getDiagramBridge();
  if (!bridge?.isReady()) {
    throw new Error("Diagram editor is not mounted.");
  }
  const before = resolveLiveXml();
  await bridge.clear();
  return buildToolResult(before, resolveLiveXml(), { cleared: true });
}

export async function applyDiagramSetLabel(
  input: DiagramSetLabelInput,
): Promise<DiagramToolResult> {
  const bridge = getDiagramBridge();
  if (!bridge?.isReady()) {
    throw new Error("Diagram editor is not mounted.");
  }
  const before = resolveLiveXml();
  const next = setCellLabel(before, input.cellId, input.text);
  if (!next) {
    throw new Error(`diagram_set_label: cell ${input.cellId} not found.`);
  }
  const err = validateDiagramXml(next);
  if (err) throw new Error(`diagram_set_label: ${err}`);
  await bridge.loadXml(next);
  return buildToolResult(before, resolveLiveXml());
}

export async function applyDiagramRemoveCells(
  input: DiagramRemoveCellsInput,
): Promise<DiagramToolResult> {
  const bridge = getDiagramBridge();
  if (!bridge?.isReady()) {
    throw new Error("Diagram editor is not mounted.");
  }
  const before = resolveLiveXml();
  const next = removeCells(before, input.cellIds);
  const err = validateDiagramXml(next);
  if (err) throw new Error(`diagram_remove_cells: ${err}`);
  await bridge.loadXml(next);
  return buildToolResult(before, resolveLiveXml());
}

export async function applyDiagramAddNodes(
  input: DiagramAddNodesInput,
): Promise<DiagramToolResult> {
  const err = validateDiagramXml(input.xml);
  if (err) throw new Error(`diagram_add_nodes: ${err}`);
  return applyDiagramMerge(input);
}

export async function applyDiagramLayout(
  input: DiagramLayoutInput,
): Promise<DiagramToolResult> {
  const bridge = getDiagramBridge();
  if (!bridge?.isReady()) {
    throw new Error("Diagram editor is not mounted.");
  }
  const before = resolveLiveXml();
  await bridge.layout(input.algorithm ?? "verticalFlow");
  return buildToolResult(before, resolveLiveXml());
}
