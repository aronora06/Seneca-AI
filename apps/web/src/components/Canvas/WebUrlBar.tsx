/**
 * URL bar for the web tab. Pure UI — all navigation flows back to the
 * parent component which owns the Leaflet-style imperative handle.
 */

import clsx from "clsx";
import { useEffect, useState } from "react";

interface WebUrlBarProps {
  url: string | null;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onSubmit: (url: string) => void;
}

export function WebUrlBar({
  url,
  loading,
  canBack,
  canForward,
  onBack,
  onForward,
  onReload,
  onSubmit,
}: WebUrlBarProps) {
  const [draft, setDraft] = useState<string>(url ?? "");

  // Keep the input in sync with whatever the AI / back / forward did.
  useEffect(() => {
    setDraft(url ?? "");
  }, [url]);

  const submit = () => {
    const next = draft.trim();
    if (!next) return;
    const normalised = /^https?:\/\//i.test(next) ? next : `https://${next}`;
    setDraft(normalised);
    onSubmit(normalised);
  };

  return (
    <div className="flex items-center gap-1.5 border-b border-border bg-card/70 px-3 py-2 backdrop-blur">
      <IconButton
        label="Back"
        disabled={!canBack || loading}
        onClick={onBack}
      >
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
      <IconButton
        label="Forward"
        disabled={!canForward || loading}
        onClick={onForward}
      >
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
      <IconButton
        label="Reload"
        disabled={!url || loading}
        onClick={onReload}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path
            d="M13 8a5 5 0 1 1-1.46-3.54L13 3v4h-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </IconButton>
      <input
        type="url"
        inputMode="url"
        spellCheck={false}
        autoCapitalize="none"
        placeholder="Enter a URL or let Seneca search…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        className="ml-1 h-8 flex-1 rounded-md border border-border bg-surface px-2.5 font-mono text-xs text-fg placeholder:text-fg-subtle focus:border-fg/50 focus:outline-none"
      />
      <button
        type="button"
        onClick={submit}
        disabled={loading || !draft.trim()}
        className={clsx(
          "btn h-8 px-3 text-xs font-medium",
          loading || !draft.trim()
            ? "cursor-not-allowed bg-surface-sunk text-fg-subtle"
            : "bg-fg text-fg-on hover:opacity-90",
        )}
      >
        {loading ? "Loading…" : "Go"}
      </button>
      {loading && <Spinner />}
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
  disabled: boolean;
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

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="ml-1 inline-block h-4 w-4 animate-spin rounded-full border-2 border-fg-subtle/40 border-t-fg-muted"
    />
  );
}
