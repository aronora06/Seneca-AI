/**
 * Sanitised browsing surface. Owns the iframe + the search overlay state,
 * exposes a WebApi via the bridge so the action dispatcher can drive it.
 *
 * Same shape as MapTab / WhiteboardTab:
 *   - snapshot store ONCE on mount; mutate via the bridge.
 *   - register a capturer for the vision pipeline.
 *   - debounced PUT for persistence (only `url` + `history` cross the wire).
 *
 * Sanitisation, SSRF guard, and URL rewriting all live server-side in
 * `apps/api/src/lib/webProxy.ts`. This component never trusts arbitrary
 * HTML directly — it only writes whatever the proxy returned.
 */

import * as htmlToImage from "html-to-image";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WebSearchResult, WebState } from "@seneca/shared";

import { apiJson } from "../../lib/api";
import { registerCapturer } from "../../lib/captureCanvas";
import { setWebApi, type WebApi } from "../../lib/webBridge";
import { useSenecaStore } from "../../store/seneca";
import { WebSearchOverlay } from "./WebSearchOverlay";
import { WebUrlBar } from "./WebUrlBar";

const PERSIST_DEBOUNCE_MS = 600;

interface FetchedPage {
  html: string;
  finalUrl: string;
  title: string | null;
  status: number;
}

export function WebTab() {
  const sessionId = useSenecaStore((s) => s.session.id);
  const setWebStore = useSenecaStore((s) => s.setWeb);

  // Snapshot once; subsequent mutation flows through the bridge so the
  // store/UI never feedback-loop with our imperative iframe writes.
  const [stateSnapshot] = useState<WebState>(
    () => useSenecaStore.getState().webState ?? defaultWebState(),
  );

  const stateRef = useRef<WebState>(stateSnapshot);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastSavedJson = useRef<string>(JSON.stringify(stateSnapshot));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [search, setSearch] = useState<{
    query: string;
    results: WebSearchResult[];
  } | null>(null);
  const [, forceRender] = useState(0);

  // ── persistence ────────────────────────────────────────────────────────────

  const schedulePersist = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const sid = useSenecaStore.getState().session.id;
      if (!sid) return;
      const json = JSON.stringify(stateRef.current);
      if (json === lastSavedJson.current) return;
      lastSavedJson.current = json;
      apiJson(`/api/sessions/${sid}/web`, {
        method: "PUT",
        body: stateRef.current,
      }).catch((err) => {
        console.warn("[seneca] web save failed", err);
      });
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  // ── core fetch + render ───────────────────────────────────────────────────

  const renderHtml = useCallback((html: string) => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = html;
  }, []);

  const fetchPage = useCallback(async (url: string): Promise<FetchedPage> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      return await apiJson<FetchedPage>("/api/fetch-page", {
        method: "POST",
        body: { url },
        signal: controller.signal,
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const navigateInternal = useCallback(
    async (url: string, opts?: { recordHistory?: boolean }): Promise<void> => {
      const recordHistory = opts?.recordHistory ?? true;
      setError(null);
      setLoading(true);
      try {
        const page = await fetchPage(url);
        renderHtml(page.html);
        setSearch(null);
        const finalUrl = page.finalUrl || url;

        if (recordHistory) {
          // Truncate forward history before appending.
          const head = stateRef.current.historyIndex + 1;
          const truncated = stateRef.current.history.slice(0, head);
          const last = truncated[truncated.length - 1];
          const next: WebState =
            last === finalUrl
              ? {
                  url: finalUrl,
                  history: truncated,
                  historyIndex: truncated.length - 1,
                }
              : {
                  url: finalUrl,
                  history: [...truncated, finalUrl],
                  historyIndex: truncated.length,
                };
          stateRef.current = next;
        } else {
          stateRef.current = { ...stateRef.current, url: finalUrl };
        }
        setWebStore(stateRef.current);
        schedulePersist();
        forceRender((n) => n + 1);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        // Bubble back to the caller (the dispatcher) so the chip turns red.
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fetchPage, renderHtml, schedulePersist, setWebStore],
  );

  // ── one-shot bootstrap ───────────────────────────────────────────────────

  useEffect(() => {
    // If the snapshot already had a URL, restore the page on mount.
    const initialUrl = stateRef.current.url;
    if (initialUrl) {
      void navigateInternal(initialUrl, { recordHistory: false });
    }

    const api: WebApi = {
      navigate: (url) => navigateInternal(url, { recordHistory: true }),
      back: () => {
        const idx = stateRef.current.historyIndex;
        if (idx <= 0) return;
        const url = stateRef.current.history[idx - 1];
        if (!url) return;
        stateRef.current = {
          ...stateRef.current,
          historyIndex: idx - 1,
          url,
        };
        setWebStore(stateRef.current);
        schedulePersist();
        void navigateInternal(url, { recordHistory: false });
      },
      forward: () => {
        const idx = stateRef.current.historyIndex;
        if (idx >= stateRef.current.history.length - 1) return;
        const url = stateRef.current.history[idx + 1];
        if (!url) return;
        stateRef.current = {
          ...stateRef.current,
          historyIndex: idx + 1,
          url,
        };
        setWebStore(stateRef.current);
        schedulePersist();
        void navigateInternal(url, { recordHistory: false });
      },
      reload: async () => {
        const url = stateRef.current.url;
        if (!url) return;
        setIframeKey((n) => n + 1); // force a fresh iframe so srcdoc replays
        await navigateInternal(url, { recordHistory: false });
      },
      showSearchResults: (query, results) => setSearch({ query, results }),
      clearSearchResults: () => setSearch(null),
    };
    setWebApi(api);

    return () => {
      setWebApi(null);
      abortRef.current?.abort();
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // navigateInternal & friends are stable via useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── vision capture ──────────────────────────────────────────────────────

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const unregister = registerCapturer("web", async () => {
      try {
        const iframe = iframeRef.current;
        const doc = iframe?.contentDocument?.documentElement;
        // Prefer the iframe contents (the actual page); fall back to the
        // host div so the user always gets *something* if the iframe is
        // empty or its contents taint the canvas.
        const target = doc ?? host;
        return await htmlToImage.toBlob(target as HTMLElement, {
          cacheBust: true,
          pixelRatio: window.devicePixelRatio || 1,
          backgroundColor: "#ffffff",
        });
      } catch (err) {
        console.warn("[seneca] web capture failed", err);
        try {
          // Last-ditch: snapshot the wrapper. Works even if the iframe
          // contents are tainted.
          return await htmlToImage.toBlob(host, { cacheBust: true });
        } catch {
          return null;
        }
      }
    });
    return unregister;
  }, []);

  // ── persist on unmount in case a debounce is still pending ───────────────

  useEffect(() => {
    return () => {
      if (!saveTimer.current) return;
      window.clearTimeout(saveTimer.current);
      const sid = useSenecaStore.getState().session.id;
      if (!sid) return;
      apiJson(`/api/sessions/${sid}/web`, {
        method: "PUT",
        body: stateRef.current,
      }).catch(() => {
        // best-effort
      });
    };
  }, [sessionId]);

  // ── render ──────────────────────────────────────────────────────────────

  const idx = stateRef.current.historyIndex;
  const canBack = idx > 0;
  const canForward = idx >= 0 && idx < stateRef.current.history.length - 1;
  const currentUrl = stateRef.current.url;

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full flex-col bg-surface"
    >
      <WebUrlBar
        url={currentUrl}
        loading={loading}
        canBack={canBack}
        canForward={canForward}
        onBack={navigateBack}
        onForward={navigateForward}
        onReload={() => {
          if (!currentUrl) return;
          setIframeKey((n) => n + 1);
          void navigateInternal(currentUrl, { recordHistory: false });
        }}
        onSubmit={(url) => {
          void navigateInternal(url, { recordHistory: true });
        }}
      />
      <div className="relative flex-1 overflow-hidden">
        {!currentUrl && !search && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="card max-w-md p-6 text-center">
              <p className="font-serif text-lg text-fg">
                A sanitised reading view.
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                Enter a URL above, or ask Seneca to find a primary source.
              </p>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-x-0 top-0 z-20 border-b border-danger/30 bg-danger-soft px-4 py-2 text-xs text-danger-fg">
            {error}
          </div>
        )}
        <iframe
          ref={iframeRef}
          key={iframeKey}
          title="Web view"
          // sandbox keeps any leftover JS isolated; allow-same-origin lets
          // html-to-image reach into contentDocument for vision capture.
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          className="absolute inset-0 h-full w-full border-0 bg-white"
        />
        {search && (
          <WebSearchOverlay
            query={search.query}
            results={search.results}
            onPick={(url) => {
              setSearch(null);
              void navigateInternal(url, { recordHistory: true });
            }}
            onClose={() => setSearch(null)}
          />
        )}
      </div>
      <div className="border-t border-border bg-card/50 px-3 py-1.5 text-[11px] text-fg-subtle">
        Scripts and dynamic content are stripped — many sites won&rsquo;t render
        perfectly. Links open in a new browser tab.
      </div>
    </div>
  );

  function navigateBack(): void {
    const i = stateRef.current.historyIndex;
    if (i <= 0) return;
    const url = stateRef.current.history[i - 1];
    if (!url) return;
    stateRef.current = { ...stateRef.current, historyIndex: i - 1, url };
    setWebStore(stateRef.current);
    schedulePersist();
    void navigateInternal(url, { recordHistory: false });
  }

  function navigateForward(): void {
    const i = stateRef.current.historyIndex;
    if (i >= stateRef.current.history.length - 1) return;
    const url = stateRef.current.history[i + 1];
    if (!url) return;
    stateRef.current = { ...stateRef.current, historyIndex: i + 1, url };
    setWebStore(stateRef.current);
    schedulePersist();
    void navigateInternal(url, { recordHistory: false });
  }
}

function defaultWebState(): WebState {
  return { url: null, history: [], historyIndex: -1 };
}

export type { WebApi };
