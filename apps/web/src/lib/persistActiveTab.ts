/**
 * Debounced persistence of the user's focused canvas tab.
 */

import type { ActiveTab } from "@seneca/shared";

import { apiJson } from "./api";

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSaved: { sessionId: string; tab: ActiveTab } | null = null;

export function schedulePersistActiveTab(
  sessionId: string | null,
  tab: ActiveTab,
): void {
  if (!sessionId) return;
  if (
    lastSaved?.sessionId === sessionId &&
    lastSaved.tab === tab
  ) {
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void apiJson(`/api/sessions/${sessionId}/active-tab`, {
      method: "PUT",
      body: { activeTab: tab },
    })
      .then(() => {
        lastSaved = { sessionId, tab };
      })
      .catch((err) => {
        console.warn("[seneca] active tab save failed", err);
      });
  }, 400);
}

export function resetActiveTabPersistence(): void {
  lastSaved = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
