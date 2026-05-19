/**
 * Empty draw.io diagram — mandatory structural cells only (id 0 and 1).
 * AI-generated diagrams must include these; see draw.io style reference.
 */

export const EMPTY_DIAGRAM_XML = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>`;

export interface DiagramsState {
  /** Uncompressed draw.io XML (mxGraphModel or mxfile). */
  xml: string;
}

export const DEFAULT_DIAGRAMS_STATE: DiagramsState = {
  xml: EMPTY_DIAGRAM_XML,
};

/** True when the diagram has no user-authored cells beyond the structural layer. */
export function isEmptyDiagram(xml: string): boolean {
  const trimmed = xml.trim();
  if (!trimmed) return true;
  if (trimmed === EMPTY_DIAGRAM_XML) return true;
  // Any vertex/edge beyond id 0 and 1 means content exists.
  const vertexOrEdge =
    /vertex="1"/.test(trimmed) ||
    /edge="1"/.test(trimmed) ||
    /<mxCell[^>]+value=/.test(trimmed);
  return !vertexOrEdge;
}
