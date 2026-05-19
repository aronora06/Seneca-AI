/**
 * Hybrid web surface (Phase E).
 *
 * Owns:
 *   - URL bar / nav stack
 *   - The render engine pick (static iframe / headless screenshot)
 *   - Live / Reader view toggle
 *   - Vision-capture registration
 *   - Per-session render budget pill (shown when the headless engine
 *     ran at least once)
 *   - Debounced PUT for persistence
 *
 * The server-side hybrid resolver in `/api/web/render` decides which
 * engine produced a page. We render either:
 *   - engine="static":   sanitised HTML in a sandboxed iframe (today's
 *                        behaviour).
 *   - engine="headless": viewport screenshot + overlayed link bboxes,
 *                        with a Reader toggle that swaps the screenshot
 *                        for the extracted text.
 *
 * When `playwright-core` isn't installed server-side, the engine
 * never flips to "headless" and the Live/Reader toggle stays hidden,
 * preserving today's exact UX.
 */

import * as htmlToImage from "html-to-image";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";

import type { WebSearchResult, WebState } from "@seneca/shared";

import { apiJson } from "../../lib/api";
import { registerCapturer } from "../../lib/captureCanvas";
import {
  fetchRenderConfig,
  renderWebPage,
  type RenderBudget,
  type RenderResult,
} from "../../lib/webRender";
import { setWebApi, type WebApi } from "../../lib/webBridge";
import { useSenecaStore } from "../../store/seneca";
import { WebHeadlessView } from "./WebHeadlessView";
import { WebReaderView } from "./WebReaderView";
import { WebSearchOverlay } from "./WebSearchOverlay";
import { WebUrlBar } from "./WebUrlBar";

const PERSIST_DEBOUNCE_MS = 600;

type ViewMode = "live" | "reader";

interface RenderedPage {
  result: RenderResult;
  /** What the URL bar should show; mirrors `finalUrl` of the engine payload. */
  finalUrl: string;
  /** When this is the static engine, the HTML we wrote into the iframe. */
  staticHtml: string | null;
}

export function WebTab() {
  const sessionId = useSenecaStore((s) => s.session.id);
  const setWebStore = useSenecaStore((s) => s.setWeb);

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
  const [headlessAvailable, setHeadlessAvailable] = useState(false);
  const [page, setPage] = useState<RenderedPage | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [budget, setBudget] = useState<RenderBudget | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [search, setSearch] = useState<{
    query: string;
    results: WebSearchResult[];
  } | null>(null);
  const [, forceRender] = useState(0);

  // ── persistence ────────────────────────────────────────────────────────

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

  // ── core fetch + render ────────────────────────────────────────────────

  const writeStaticHtml = useCallback((html: string) => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = html;
  }, []);

  const fetchAndRender = useCallback(
    async (url: string): Promise<RenderedPage> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const sid = useSenecaStore.getState().session.id ?? undefined;
      try {
        const result = await renderWebPage(url, {
          signal: controller.signal,
          sessionId: sid,
        });
        const finalUrl =
          result.engine === "static"
            ? result.static.finalUrl
            : result.headless.finalUrl;
        return {
          result,
          finalUrl,
          staticHtml: result.engine === "static" ? result.static.html : null,
        };
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [],
  );

  const navigateInternal = useCallback(
    async (url: string, opts?: { recordHistory?: boolean }): Promise<void> => {
      const recordHistory = opts?.recordHistory ?? true;
      setError(null);
      setLoading(true);
      try {
        const next = await fetchAndRender(url);
        setPage(next);
        if (next.result.budget) setBudget(next.result.budget);
        // Reset view mode to "live" on a fresh navigation so the user
        // doesn't get stranded in Reader after switching pages.
        setViewMode("live");
        if (next.staticHtml) writeStaticHtml(next.staticHtml);
        setSearch(null);
        useSenecaStore.getState().setWebSearchOverlayOpen(false);
        const finalUrl = next.finalUrl || url;

        if (recordHistory) {
          const head = stateRef.current.historyIndex + 1;
          const truncated = stateRef.current.history.slice(0, head);
          const last = truncated[truncated.length - 1];
          const nextState: WebState =
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
          stateRef.current = nextState;
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
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fetchAndRender, writeStaticHtml, schedulePersist, setWebStore],
  );

  // ── one-shot bootstrap ─────────────────────────────────────────────────

  useEffect(() => {
    void fetchRenderConfig().then((cfg) => {
      setHeadlessAvailable(cfg.headlessAvailable);
    });

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
        setIframeKey((n) => n + 1);
        await navigateInternal(url, { recordHistory: false });
      },
      showSearchResults: (query, results) => {
        setSearch({ query, results });
        useSenecaStore.getState().setWebSearchOverlayOpen(true);
      },
      clearSearchResults: () => {
        setSearch(null);
        useSenecaStore.getState().setWebSearchOverlayOpen(false);
      },
    };
    setWebApi(api);

    return () => {
      setWebApi(null);
      abortRef.current?.abort();
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── vision capture ─────────────────────────────────────────────────────

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const unregister = registerCapturer("web", async () => {
      try {
        const engine = page?.result.engine;
        // For the headless engine the screenshot IS the rendered
        // view; capture the host (with the <img> in it). For the
        // static engine the iframe carries the visual.
        if (engine === "headless") {
          return await htmlToImage.toBlob(host, {
            cacheBust: true,
            pixelRatio: window.devicePixelRatio || 1,
            backgroundColor: "#ffffff",
          });
        }
        const iframe = iframeRef.current;
        const doc = iframe?.contentDocument?.documentElement;
        const target = doc ?? host;
        return await htmlToImage.toBlob(target as HTMLElement, {
          cacheBust: true,
          pixelRatio: window.devicePixelRatio || 1,
          backgroundColor: "#ffffff",
        });
      } catch (err) {
        console.warn("[seneca] web capture failed", err);
        try {
          return await htmlToImage.toBlob(host, { cacheBust: true });
        } catch {
          return null;
        }
      }
    });
    return unregister;
  }, [page?.result.engine]);

  // ── persist on unmount in case a debounce is still pending ─────────────

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

  // ── render ─────────────────────────────────────────────────────────────

  const idx = stateRef.current.historyIndex;
  const canBack = idx > 0;
  const canForward = idx >= 0 && idx < stateRef.current.history.length - 1;
  const currentUrl = stateRef.current.url;
  const engine = page?.result.engine ?? "static";
  const showReaderToggle = engine === "headless";

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col bg-transparent">
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
                {headlessAvailable
                  ? "A hybrid reading view."
                  : "A sanitised reading view."}
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

        {/* Static engine — iframe is always mounted so vision capture
            still has a target even when the headless view is showing. */}
        <iframe
          ref={iframeRef}
          key={iframeKey}
          title="Web view"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          className={clsx(
            "absolute inset-0 h-full w-full border-0 bg-white",
            engine === "static" ? "block" : "hidden",
          )}
        />

        {/* Headless engine — screenshot + overlay or reader mode. */}
        {engine === "headless" && page?.result.engine === "headless" && (
          <>
            {viewMode === "live" ? (
              <WebHeadlessView
                screenshotBase64={page.result.headless.screenshot}
                links={page.result.headless.links}
                viewport={page.result.headless.viewport}
                onLinkClick={(href) =>
                  void navigateInternal(href, { recordHistory: true })
                }
              />
            ) : (
              <WebReaderView
                text={page.result.headless.readerText}
                title={page.result.headless.title}
                url={page.result.headless.finalUrl}
              />
            )}
          </>
        )}

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

      <div className="flex items-center justify-between border-t border-border bg-card/50 px-3 py-1.5 text-[11px] text-fg-subtle">
        <span>
          {engine === "static" ? (
            <>
              Static engine — scripts are stripped, many SPAs won't render
              perfectly.
            </>
          ) : (
            <>
              Live engine — page rendered by headless Chromium.
              {(page?.result as { headlessError?: { code: string } })
                ?.headlessError && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">
                  (degraded)
                </span>
              )}
            </>
          )}
        </span>
        <div className="flex items-center gap-2">
          {budget && budget.budget > 0 && (
            <BudgetPill budget={budget} />
          )}
          {showReaderToggle && (
            <ViewModeToggle value={viewMode} onChange={setViewMode} />
          )}
        </div>
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

interface BudgetPillProps {
  budget: RenderBudget;
}

function BudgetPill({ budget }: BudgetPillProps) {
  const used = budget.used;
  const limit = budget.budget;
  const pct = limit > 0 ? used / limit : 0;
  const tone =
    pct >= 1
      ? "bg-danger/15 text-danger border-danger/30"
      : pct >= 0.8
        ? "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300"
        : "bg-surface text-fg-subtle border-border";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}
      title={`Headless renders used: ${used} of ${limit} per hour`}
    >
      Live {used}/{limit}
    </span>
  );
}

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
}

function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      className="flex items-center rounded-full border border-border bg-surface p-0.5 text-[10px] uppercase tracking-wider"
    >
      {(["live", "reader"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          onClick={() => onChange(mode)}
          className={clsx(
            "rounded-full px-2 py-0.5 transition-colors",
            value === mode
              ? "bg-accent text-accent-fg"
              : "text-fg-subtle hover:text-fg",
          )}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

function defaultWebState(): WebState {
  return { url: null, history: [], historyIndex: -1 };
}

export type { WebApi };
