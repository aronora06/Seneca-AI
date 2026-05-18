/**
 * Top toolbar for the Documents tab. Owns the page navigation controls
 * (prev / next / jump / page-of-N) and the sidebar collapse toggle. Pure
 * UI — all interaction routes back to DocumentTab via callbacks.
 */

import clsx from "clsx";
import { useEffect, useState } from "react";

import type { DocumentRecord } from "@seneca/shared";

interface DocumentToolbarProps {
  document: DocumentRecord | null;
  page: number;
  pageCount: number;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
  onJump: (page: number) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function DocumentToolbar({
  document,
  page,
  pageCount,
  loading,
  onPrev,
  onNext,
  onJump,
  sidebarOpen,
  onToggleSidebar,
}: DocumentToolbarProps) {
  const [draft, setDraft] = useState<string>(String(page));

  useEffect(() => {
    setDraft(String(page));
  }, [page]);

  const submitJump = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(page));
      return;
    }
    const clamped = Math.max(1, Math.min(pageCount || 1, Math.floor(n)));
    onJump(clamped);
  };

  const canPrev = !loading && pageCount > 0 && page > 1;
  const canNext = !loading && pageCount > 0 && page < pageCount;

  return (
    <div className="flex items-center gap-1.5 border-b border-border bg-card/70 px-3 py-2 backdrop-blur">
      <IconButton
        label={sidebarOpen ? "Hide documents list" : "Show documents list"}
        onClick={onToggleSidebar}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect
            x="2"
            y="3"
            width="12"
            height="10"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <line
            x1="6.5"
            y1="3"
            x2="6.5"
            y2="13"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      </IconButton>

      <div className="ml-1 mr-3 flex min-w-0 flex-col">
        <span className="font-serif text-sm text-fg truncate">
          {document?.name ?? "No document open"}
        </span>
        {document && (
          <span className="text-[10px] text-fg-subtle truncate">
            {document.filename} · {formatBytes(document.size)}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <IconButton label="Previous page" disabled={!canPrev} onClick={onPrev}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 3L5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </IconButton>

        <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg-muted">
          <input
            type="text"
            inputMode="numeric"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={submitJump}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitJump();
                (e.target as HTMLInputElement).blur();
              }
            }}
            disabled={!document || loading}
            aria-label="Page number"
            className="w-10 bg-transparent text-center font-mono text-xs text-fg outline-none"
          />
          <span className="font-mono text-fg-subtle">/</span>
          <span className="font-mono text-fg-muted">
            {pageCount > 0 ? pageCount : "—"}
          </span>
        </div>

        <IconButton label="Next page" disabled={!canNext} onClick={onNext}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 3l5 5-5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
        disabled
          ? "cursor-not-allowed text-fg-subtle/60"
          : "text-fg-muted hover:bg-surface-sunk hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
