/**
 * Bridge so ActionDispatcher can drive the draw.io embed without prop-drilling.
 * DiagramsTab registers an implementation on mount.
 */

export interface DiagramMergeResult {
  merged: boolean;
  error?: string;
}

export type DiagramLayoutAlgorithm =
  | "horizontalFlow"
  | "verticalFlow"
  | "organic";

export interface DiagramBridgeApi {
  /** True after embed init + initial load. */
  isReady(): boolean;
  /** Last autosave / load / mutation XML (may be ahead of Zustand debounce). */
  getLiveXml(): string | null;
  loadXml(xml: string): Promise<void>;
  loadMermaid(data: string): Promise<void>;
  mergeXml(xml: string): Promise<DiagramMergeResult>;
  clear(): Promise<void>;
  layout(algorithm: DiagramLayoutAlgorithm): Promise<void>;
  exportPng(): Promise<Blob | null>;
}

let api: DiagramBridgeApi | null = null;

export function setDiagramBridge(next: DiagramBridgeApi | null): void {
  api = next;
}

export function getDiagramBridge(): DiagramBridgeApi | null {
  return api;
}
