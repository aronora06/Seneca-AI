/**
 * Server resolver for `diagram_read` — parses persisted session XML.
 */

import type { DiagramReadInput, DiagramReadResult } from "@seneca/shared";
import {
  EMPTY_DIAGRAM_XML,
  graphToMermaid,
  isEmptyDiagram,
  lintDiagramGraph,
  MERMAID_MAX_VERTICES,
  parseDiagramGraph,
} from "@seneca/shared";

export function resolveDiagramRead(
  xml: string,
  rawInput: unknown,
): string {
  const input = coerceDiagramReadInput(rawInput);
  const trimmed = xml?.trim() ? xml : EMPTY_DIAGRAM_XML;
  const graph = parseDiagramGraph(trimmed);
  const empty = isEmptyDiagram(trimmed) || graph.cellCount === 0;
  const warnings = lintDiagramGraph(graph);

  const result: DiagramReadResult = {
    empty,
    cellCount: graph.cellCount,
    vertices: graph.vertices,
    edges: graph.edges,
    bounds: graph.bounds,
    warnings,
  };

  const includeMermaid = input.includeMermaid !== false;
  if (
    includeMermaid &&
    graph.vertices.length > 0 &&
    graph.vertices.length <= MERMAID_MAX_VERTICES
  ) {
    const mermaid = graphToMermaid(graph);
    if (mermaid) result.mermaid = mermaid;
  }

  return JSON.stringify(result, null, 2);
}

function coerceDiagramReadInput(raw: unknown): DiagramReadInput {
  if (!raw || typeof raw !== "object") return {};
  const includeMermaid = (raw as { includeMermaid?: unknown }).includeMermaid;
  if (typeof includeMermaid === "boolean") {
    return { includeMermaid };
  }
  return {};
}
