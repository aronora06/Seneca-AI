/**
 * Cheap parse of draw.io XML for workspace context (no iframe round-trip).
 * Delegates graph parsing to @seneca/shared.
 */

import {
  digestDiagramGraph,
  isEmptyDiagram,
  parseDiagramGraph,
} from "@seneca/shared";

export interface DiagramXmlDigest {
  cellCount: number;
  labelDigest: string[];
  hasContent: boolean;
  vertexCount?: number;
  edgeCount?: number;
  vertices?: { id: string; label: string; shape?: string }[];
  edges?: { id: string; from: string; to: string; label?: string }[];
  bounds?: { x: number; y: number; w: number; h: number };
}

export function diagramXmlDigest(xml: string): DiagramXmlDigest {
  const graph = parseDiagramGraph(xml);
  const d = digestDiagramGraph(graph);
  return {
    cellCount: d.cellCount,
    labelDigest: d.labelDigest,
    hasContent: d.hasContent || !isEmptyDiagram(xml),
    vertexCount: d.vertexCount,
    edgeCount: d.edgeCount,
    vertices: d.vertices,
    edges: d.edges,
    bounds: d.bounds,
  };
}

/** Structural cells id 0 and 1 are mandatory for valid draw.io XML. */
export function hasDiagramStructuralCells(xml: string): boolean {
  return /id="0"/.test(xml) && /id="1"/.test(xml);
}

export const MAX_DIAGRAM_XML_BYTES = 500_000;

export function validateDiagramXml(xml: string): string | null {
  if (!xml.trim()) return "Diagram XML is empty.";
  if (xml.length > MAX_DIAGRAM_XML_BYTES) {
    return `Diagram XML exceeds ${MAX_DIAGRAM_XML_BYTES} bytes.`;
  }
  if (!hasDiagramStructuralCells(xml)) {
    return 'Diagram XML must include structural cells id="0" and id="1".';
  }
  return null;
}
