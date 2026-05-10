/**
 * Thin bridge so non-React code (the ActionDispatcher) can read/write the
 * Excalidraw scene without prop-drilling. The Whiteboard tab calls
 * `setWhiteboardApi` on mount and clears it on unmount.
 */

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

let api: ExcalidrawImperativeAPI | null = null;

export function setWhiteboardApi(next: ExcalidrawImperativeAPI | null): void {
  api = next;
}

export function getWhiteboardApi(): ExcalidrawImperativeAPI | null {
  return api;
}
