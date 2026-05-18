/**
 * Imperative handle for the live Documents tab.
 *
 * The DocumentTab component owns the react-pdf viewer state; this bridge
 * lets the action dispatcher trigger page navigation / document switching
 * without importing the component or subscribing to the Zustand store.
 *
 * Mirrors `mapBridge` and `webBridge`.
 */

export interface DocumentApi {
  /**
   * Switch the active document AND navigate to the requested page.
   * If `documentId` is omitted, stays on the current document.
   * Pages are 1-indexed; the implementation clamps out-of-range values.
   * Throws when no documents are loaded.
   */
  goToPage(page: number, documentId?: string): void;
}

let api: DocumentApi | null = null;

export function setDocumentApi(next: DocumentApi | null): void {
  api = next;
}

export function getDocumentApi(): DocumentApi | null {
  return api;
}
