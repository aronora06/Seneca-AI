/**
 * Imperative handle for the live Web tab.
 *
 * Mirrors `mapBridge` and `whiteboardBridge`: the WebTab component owns
 * the iframe and the search-results overlay state; this bridge lets the
 * action dispatcher trigger navigation / search without importing the
 * component or subscribing to the Zustand store.
 */

import type { WebSearchResult } from "@seneca/shared";

export interface WebApi {
  /** Fetch + render a URL in the iframe. Resolves once the iframe paints. */
  navigate(url: string): Promise<void>;
  /** Step back through history. No-op at index 0. */
  back(): void;
  /** Step forward through history. No-op at the head. */
  forward(): void;
  /** Re-fetch the current URL. */
  reload(): Promise<void>;
  /** Show a card list of results overlaid on the page. */
  showSearchResults(query: string, results: WebSearchResult[]): void;
  /** Hide the overlay; the underlying page becomes visible again. */
  clearSearchResults(): void;
}

let api: WebApi | null = null;

export function setWebApi(next: WebApi | null): void {
  api = next;
}

export function getWebApi(): WebApi | null {
  return api;
}
