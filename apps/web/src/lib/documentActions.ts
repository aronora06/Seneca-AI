/**
 * Coerce + apply for the `document_go_to_page` tool.
 *
 * Mirrors the map / web equivalents. Coercer validates raw JSON from
 * Anthropic into a strongly-typed shape; apply resolves the live document
 * handle from the bridge and mutates it.
 */

import type { DocumentGoToPageInput } from "@seneca/shared";

import { getDocumentApi } from "./documentBridge";

const requireDocumentApi = () => {
  const api = getDocumentApi();
  if (!api) throw new Error("Documents tab is not mounted yet.");
  return api;
};

export function coerceGoToPageInput(raw: unknown): DocumentGoToPageInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Tool input was not an object.");
  }
  const obj = raw as Record<string, unknown>;
  const page = Number(obj.page);
  if (!Number.isFinite(page)) {
    throw new Error("`page` must be a finite number.");
  }
  const out: DocumentGoToPageInput = {
    page: Math.max(1, Math.floor(page)),
  };
  if (typeof obj.document_id === "string" && obj.document_id.trim()) {
    out.document_id = obj.document_id.trim();
  }
  return out;
}

export function applyDocumentGoToPage(input: DocumentGoToPageInput): void {
  requireDocumentApi().goToPage(input.page, input.document_id);
}
