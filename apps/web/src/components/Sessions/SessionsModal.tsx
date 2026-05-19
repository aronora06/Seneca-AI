/**
 * SessionsModal — Priority 2 / Phase 3 (created), Phase D (cards +
 * search + pin + export).
 *
 * Lists every session the user owns, lets them create / rename /
 * delete / pin / export, and switches the active session (which
 * fully re-hydrates the canvas via `loadSession`). Switching also
 * aborts the in-flight `runTurn` stream if any, so a long-running
 * answer in the prior session can't leak into the new one.
 *
 * Phase D additions:
 *   - Preview cards: snippet of the last user message, document
 *     count, and small icons for the canvas tabs that were used.
 *   - Search input that filters by session name + snippet text.
 *   - Pin / unpin star — pinned sessions sort to the top.
 *   - Per-session Download menu item that exports a markdown
 *     transcript of the row.
 *
 * Rendered via a portal so the modal escapes the header's
 * `backdrop-filter`, which would otherwise turn `position: fixed`
 * into `position: absolute` (same gotcha SettingsModal hit).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

import type { SessionUsage } from "@seneca/shared";
import { DEFAULT_DIAGRAMS_STATE, DEFAULT_SESSION_USAGE } from "@seneca/shared";

import { useSenecaStore } from "../../store/seneca";
import {
  createSession,
  deleteSession,
  fetchSessionRow,
  listSessions,
  renameSession,
  setSessionPinned,
  type SessionSummary,
  type SessionTabFlag,
} from "../../lib/sessions";
import {
  normalizeDocuments,
  normalizeMap,
  normalizeWeb,
} from "../../lib/sessionNormalizers";
import { downloadSessionMarkdown } from "../../lib/sessionExport";
import { toast } from "../Toast/toastStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

type ActiveDialog =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "rename"; id: string; name: string }
  | { kind: "delete"; id: string; name: string };

export function SessionsModal({ open, onClose }: Props) {
  const sessionId = useSenecaStore((s) => s.session.id);
  const loadSession = useSenecaStore((s) => s.loadSession);

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>({
    kind: "none",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const overlayRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await listSessions();
      setSessions(rows);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    // Defer focus until the portal mounts so React doesn't strip it.
    const id = window.setTimeout(() => searchRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && activeDialog.kind === "none") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, activeDialog.kind]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current && activeDialog.kind === "none") {
        onClose();
      }
    },
    [onClose, activeDialog.kind],
  );

  const handleSwitch = useCallback(
    async (id: string) => {
      if (id === sessionId) {
        onClose();
        return;
      }
      setBusy(id);
      try {
        const row = await fetchSessionRow(id);
        loadSession({
          id: row.id,
          name: row.name,
          transcript: row.transcript ?? [],
          whiteboard:
            row.whiteboard && Object.keys(row.whiteboard).length > 0
              ? row.whiteboard
              : { elements: [] },
          diagrams: row.diagrams?.xml
            ? row.diagrams
            : { ...DEFAULT_DIAGRAMS_STATE },
          map: normalizeMap(row.map),
          web: normalizeWeb(row.web),
          documents: normalizeDocuments(row.documents),
          activeTab: row.activeTab ?? "whiteboard",
        });
        // loadSession clears usage; hydrate from the row immediately
        // after so the cost pill picks up the persisted total.
        useSenecaStore.getState().setSessionUsage(normalizeUsage(row.usage));
        onClose();
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [sessionId, loadSession, onClose],
  );

  const handleCreate = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setBusy("create");
      try {
        const row = await createSession(trimmed);
        loadSession({
          id: row.id,
          name: row.name,
          transcript: row.transcript ?? [],
          whiteboard:
            row.whiteboard && Object.keys(row.whiteboard).length > 0
              ? row.whiteboard
              : { elements: [] },
          diagrams: row.diagrams?.xml
            ? row.diagrams
            : { ...DEFAULT_DIAGRAMS_STATE },
          map: normalizeMap(row.map),
          web: normalizeWeb(row.web),
          documents: normalizeDocuments(row.documents),
          activeTab: row.activeTab ?? "whiteboard",
        });
        setActiveDialog({ kind: "none" });
        onClose();
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [loadSession, onClose],
  );

  const handleRename = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setBusy(`rename:${id}`);
      try {
        await renameSession(id, trimmed);
        setActiveDialog({ kind: "none" });
        await refresh();
        if (id === sessionId) {
          useSenecaStore.getState().setSession(id, trimmed);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [refresh, sessionId],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setBusy(`delete:${id}`);
      const target = sessions?.find((s) => s.id === id);
      const deletedName = target?.name ?? "Session";
      try {
        await deleteSession(id);
        toast.info({
          title: `Deleted "${deletedName}"`,
          description: "Transcript and attached state are gone.",
        });
        setActiveDialog({ kind: "none" });
        if (id === sessionId) {
          const remaining = (sessions ?? []).filter((s) => s.id !== id);
          if (remaining.length > 0) {
            await handleSwitch(remaining[0]!.id);
          } else {
            const row = await createSession("New session");
            loadSession({
              id: row.id,
              name: row.name,
              transcript: [],
              whiteboard: { elements: [] },
              diagrams: { ...DEFAULT_DIAGRAMS_STATE },
              map: normalizeMap(row.map),
              web: normalizeWeb(row.web),
              documents: normalizeDocuments(row.documents),
              activeTab: row.activeTab ?? "whiteboard",
            });
            onClose();
          }
        } else {
          await refresh();
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [sessionId, sessions, handleSwitch, refresh, loadSession, onClose],
  );

  const handleTogglePin = useCallback(
    async (id: string, current: boolean) => {
      const next = !current;
      // Optimistic local flip so the star feels instant.
      setSessions((prev) =>
        prev ? prev.map((s) => (s.id === id ? { ...s, pinned: next } : s)) : prev,
      );
      try {
        await setSessionPinned(id, next);
        // Re-list to get the server-side sort (pinned first).
        await refresh();
      } catch (err) {
        // Roll back on failure.
        setSessions((prev) =>
          prev
            ? prev.map((s) => (s.id === id ? { ...s, pinned: current } : s))
            : prev,
        );
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const handleExport = useCallback(async (id: string) => {
    setBusy(`export:${id}`);
    setExportError(null);
    try {
      const row = await fetchSessionRow(id);
      downloadSessionMarkdown(row);
      toast.success({
        title: "Session exported",
        description: `Saved ${row.name || "session"} as Markdown.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExportError(msg);
      toast.error({
        title: "Export failed",
        description: msg,
      });
    } finally {
      setBusy(null);
    }
  }, []);

  const sortedSessions = useMemo(() => {
    if (!sessions) return null;
    const sorted = [...sessions].sort((a, b) => {
      if ((a.pinned === true) !== (b.pinned === true)) {
        return a.pinned === true ? -1 : 1;
      }
      const aWhen = a.lastMessageAt ?? a.updated_at;
      const bWhen = b.lastMessageAt ?? b.updated_at;
      return aWhen < bWhen ? 1 : -1;
    });
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((s) => matchesQuery(s, q));
  }, [sessions, query]);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Sessions"
    >
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft dark:shadow-soft-dark">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-serif text-lg text-fg">Sessions</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveDialog({ kind: "create" })}
              className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
            >
              New session
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sessions"
              className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-sunk hover:text-fg"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="border-b border-border px-5 py-2">
          <label className="sr-only" htmlFor="sessions-search">
            Search sessions
          </label>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-fg-subtle"
            >
              ⌕
            </span>
            <input
              ref={searchRef}
              id="sessions-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or last question…"
              className="w-full rounded-md border border-border bg-surface py-1.5 pl-7 pr-3 text-sm text-fg outline-none transition-colors focus:border-accent"
            />
          </div>
        </div>

        {loadError && (
          <div className="border-b border-danger/30 bg-danger-soft px-5 py-2 text-xs text-danger-fg">
            {loadError}
          </div>
        )}
        {exportError && (
          <div className="border-b border-danger/30 bg-danger-soft px-5 py-2 text-xs text-danger-fg">
            Export failed: {exportError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {sortedSessions === null ? (
            <div className="px-3 py-6 text-center text-sm text-fg-muted">
              Loading sessions…
            </div>
          ) : sortedSessions.length === 0 ? (
            <EmptyState query={query} />
          ) : (
            <ul className="flex flex-col gap-2">
              {sortedSessions.map((row) => (
                <li key={row.id}>
                  <SessionCard
                    summary={row}
                    isActive={row.id === sessionId}
                    busy={busy}
                    onSwitch={() => void handleSwitch(row.id)}
                    onRename={() =>
                      setActiveDialog({
                        kind: "rename",
                        id: row.id,
                        name: row.name,
                      })
                    }
                    onDelete={() =>
                      setActiveDialog({
                        kind: "delete",
                        id: row.id,
                        name: row.name,
                      })
                    }
                    onTogglePin={() =>
                      void handleTogglePin(row.id, row.pinned === true)
                    }
                    onExport={() => void handleExport(row.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {activeDialog.kind === "create" && (
        <NameDialog
          title="New session"
          submitLabel="Create"
          initial=""
          busy={busy === "create"}
          onCancel={() => setActiveDialog({ kind: "none" })}
          onSubmit={(name) => void handleCreate(name)}
        />
      )}
      {activeDialog.kind === "rename" && (
        <NameDialog
          title="Rename session"
          submitLabel="Rename"
          initial={activeDialog.name}
          busy={busy === `rename:${activeDialog.id}`}
          onCancel={() => setActiveDialog({ kind: "none" })}
          onSubmit={(name) => void handleRename(activeDialog.id, name)}
        />
      )}
      {activeDialog.kind === "delete" && (
        <ConfirmDeleteDialog
          name={activeDialog.name}
          busy={busy === `delete:${activeDialog.id}`}
          onCancel={() => setActiveDialog({ kind: "none" })}
          onConfirm={() => void handleDelete(activeDialog.id)}
        />
      )}
    </div>,
    document.body,
  );
}

function matchesQuery(s: SessionSummary, q: string): boolean {
  if (s.name.toLowerCase().includes(q)) return true;
  if (
    typeof s.lastUserText === "string" &&
    s.lastUserText.toLowerCase().includes(q)
  ) {
    return true;
  }
  return false;
}

function EmptyState({ query }: { query: string }) {
  if (query.trim().length > 0) {
    return (
      <div className="px-3 py-6 text-center text-sm text-fg-muted">
        No sessions match "<span className="text-fg">{query}</span>". Try a
        different search.
      </div>
    );
  }
  return (
    <div className="px-3 py-6 text-center text-sm text-fg-muted">
      You don't have any sessions yet. Click{" "}
      <strong>New session</strong> above to start one.
    </div>
  );
}

interface SessionCardProps {
  summary: SessionSummary;
  isActive: boolean;
  busy: string | null;
  onSwitch: () => void;
  onRename: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onExport: () => void;
}

function SessionCard({
  summary,
  isActive,
  busy,
  onSwitch,
  onRename,
  onDelete,
  onTogglePin,
  onExport,
}: SessionCardProps) {
  const switching = busy === summary.id;
  const exporting = busy === `export:${summary.id}`;
  const pinned = summary.pinned === true;
  return (
    <div
      className={clsx(
        "group relative flex flex-col gap-2 rounded-xl border px-3 py-2.5 transition-colors",
        isActive
          ? "border-accent/50 bg-accent/10"
          : "border-border bg-surface hover:bg-surface-sunk",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onSwitch}
          disabled={switching}
          className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-progress"
        >
          <span
            className={clsx(
              "mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full",
              isActive ? "bg-accent" : "bg-fg-subtle/40",
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p
                className={clsx(
                  "min-w-0 truncate text-sm",
                  isActive ? "font-medium text-fg" : "text-fg",
                )}
              >
                {summary.name}
              </p>
              {pinned && (
                <span
                  aria-hidden
                  title="Pinned"
                  className="flex-shrink-0 text-[11px] text-accent"
                >
                  ★
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-fg-subtle">
              {summary.lastMessageAt
                ? `Last activity ${formatTimeAgo(summary.lastMessageAt)}`
                : `Updated ${formatTimeAgo(summary.updated_at)}`}
              {typeof summary.documentCount === "number" &&
                summary.documentCount > 0 && (
                  <>
                    {" · "}
                    {summary.documentCount} document
                    {summary.documentCount === 1 ? "" : "s"}
                  </>
                )}
            </p>
            {summary.lastUserText && (
              <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-fg-muted">
                <span aria-hidden className="mr-1 text-fg-subtle">
                  ❝
                </span>
                {summary.lastUserText}
              </p>
            )}
          </div>
          {switching && (
            <span className="text-[11px] text-fg-muted">Loading…</span>
          )}
        </button>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <IconButton
            label={pinned ? "Unpin" : "Pin"}
            onClick={onTogglePin}
            active={pinned}
          >
            ★
          </IconButton>
          <IconButton
            label={exporting ? "Exporting…" : "Download as markdown"}
            onClick={onExport}
            disabled={exporting}
          >
            ⤓
          </IconButton>
          <IconButton label="Rename" onClick={onRename} disabled={switching}>
            ✎
          </IconButton>
          <IconButton
            label="Delete"
            onClick={onDelete}
            disabled={switching}
            danger
          >
            🗑
          </IconButton>
        </div>
      </div>
      {summary.tabs && summary.tabs.length > 0 && (
        <TabFlags tabs={summary.tabs} />
      )}
    </div>
  );
}

function TabFlags({ tabs }: { tabs: ReadonlyArray<SessionTabFlag> }) {
  return (
    <div
      className="ml-5 flex flex-wrap items-center gap-1"
      aria-label="Canvas tabs used in this session"
    >
      {tabs.map((tab) => (
        <span
          key={tab}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-fg-subtle"
          title={tabLabel(tab)}
        >
          <span aria-hidden>{tabIcon(tab)}</span>
          <span>{tabLabel(tab)}</span>
        </span>
      ))}
    </div>
  );
}

function tabIcon(tab: SessionTabFlag): string {
  switch (tab) {
    case "documents":
      return "📄";
    case "web":
      return "◐";
    case "map":
      return "◯";
    case "whiteboard":
      return "▦";
    case "diagrams":
      return "◇";
  }
}

function tabLabel(tab: SessionTabFlag): string {
  switch (tab) {
    case "documents":
      return "Docs";
    case "web":
      return "Web";
    case "map":
      return "Map";
    case "whiteboard":
      return "Board";
    case "diagrams":
      return "Diagrams";
  }
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  children: React.ReactNode;
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  active,
  children,
}: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={clsx(
        "flex h-7 w-7 items-center justify-center rounded-md text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "text-accent hover:bg-accent/15"
          : danger
            ? "text-danger hover:bg-danger-soft"
            : "text-fg-muted hover:bg-surface hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

interface NameDialogProps {
  title: string;
  submitLabel: string;
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

function NameDialog({
  title,
  submitLabel,
  initial,
  busy,
  onCancel,
  onSubmit,
}: NameDialogProps) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  const submit = () => {
    if (busy) return;
    if (!value.trim()) return;
    onSubmit(value);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-soft dark:shadow-soft-dark">
        <h3 className="font-serif text-base text-fg">{title}</h3>
        <input
          ref={inputRef}
          type="text"
          value={value}
          maxLength={120}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="e.g. Tax research"
          className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-accent"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:bg-surface-sunk hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !value.trim()}
            className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Working…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmDeleteDialogProps {
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDeleteDialog({
  name,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-soft dark:shadow-soft-dark">
        <h3 className="font-serif text-base text-fg">Delete session?</h3>
        <p className="mt-2 text-sm text-fg-muted">
          <strong className="text-fg">{name}</strong> and all of its
          documents, pages, embeddings and bytes will be permanently
          removed. This can't be undone.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:bg-surface-sunk hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md border border-danger/40 bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function normalizeUsage(raw: unknown): SessionUsage {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SESSION_USAGE };
  const u = raw as Partial<SessionUsage>;
  return {
    inputTokens: numOr(u.inputTokens, 0),
    outputTokens: numOr(u.outputTokens, 0),
    cacheReadInputTokens: numOr(u.cacheReadInputTokens, 0),
    cacheCreationInputTokens: numOr(u.cacheCreationInputTokens, 0),
    inputCostUSD: numOr(u.inputCostUSD, 0),
    outputCostUSD: numOr(u.outputCostUSD, 0),
    ttsCharacters: numOr(u.ttsCharacters, 0),
    ttsCostUSD: numOr(u.ttsCostUSD, 0),
    updatedAt:
      typeof u.updatedAt === "string"
        ? u.updatedAt
        : DEFAULT_SESSION_USAGE.updatedAt,
  };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
