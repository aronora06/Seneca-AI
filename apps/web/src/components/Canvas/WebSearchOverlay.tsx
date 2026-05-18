/**
 * Card list shown over the iframe when web_search returns results.
 * Vision §8.6 acceptance line 5 makes this UI mandatory ("results render
 * as a clickable list").
 */

import type { WebSearchResult } from "@seneca/shared";

interface WebSearchOverlayProps {
  query: string;
  results: WebSearchResult[];
  onPick: (url: string) => void;
  onClose: () => void;
}

export function WebSearchOverlay({
  query,
  results,
  onPick,
  onClose,
}: WebSearchOverlayProps) {
  return (
    <div className="absolute inset-0 flex flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-border bg-card/70 px-4 py-2">
        <div className="flex flex-col">
          <span className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
            Search results
          </span>
          <span className="font-serif text-sm italic text-fg">
            &ldquo;{truncate(query, 80)}&rdquo;
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn h-8 px-3 text-xs font-medium text-fg-muted hover:bg-surface-sunk hover:text-fg"
        >
          Close results
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {results.length === 0 ? (
          <div className="mt-12 text-center text-sm text-fg-muted">
            No results for that query.
          </div>
        ) : (
          <ol className="mx-auto flex max-w-3xl flex-col gap-3">
            {results.map((r) => (
              <li key={r.url}>
                <button
                  type="button"
                  onClick={() => onPick(r.url)}
                  className="card flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors hover:bg-surface-sunk"
                >
                  <span className="font-serif text-base text-fg">
                    {truncate(r.title, 120)}
                  </span>
                  <span className="font-mono text-[11px] text-accent">
                    {hostname(r.url)}
                  </span>
                  {r.snippet && (
                    <span className="text-sm text-fg-muted">
                      {truncate(r.snippet, 240)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "\u2026";
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
