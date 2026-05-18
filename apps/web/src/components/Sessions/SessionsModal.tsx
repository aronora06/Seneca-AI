/**
 * SessionsModal — Priority 2 / Phase 3.
 *
 * Lists every session the user owns, lets them create / rename / delete,
 * and switches the active session (which fully re-hydrates the canvas
 * via `loadSession`). Switching also abort the in-flight `runTurn`
 * stream if any, so a long-running answer in the prior session can't
 * leak into the new one.
 *
 * Rendered via a portal so the modal escapes the header's
 * `backdrop-filter`, which would otherwise turn `position: fixed` into
 * `position: absolute` (same gotcha SettingsModal hit).
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
import { DEFAULT_SESSION_USAGE } from "@seneca/shared";

import { useSenecaStore } from "../../store/seneca";
import {
  createSession,
  deleteSession,
  fetchSessionRow,
  listSessions,
  renameSession,
  type SessionSummary,
} from "../../lib/sessions";
import {
  normalizeDocuments,
  normalizeMap,
  normalizeWeb,
} from "../../lib/sessionNormalizers";

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
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>({
    kind: "none",
  });
  const [busy, setBusy] = useState<string | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);

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
          map: normalizeMap(row.map),
          web: normalizeWeb(row.web),
          documents: normalizeDocuments(row.documents),
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
          map: normalizeMap(row.map),
          web: normalizeWeb(row.web),
          documents: normalizeDocuments(row.documents),
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
        // If we just renamed the active session, sync the header label.
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
      try {
        await deleteSession(id);
        setActiveDialog({ kind: "none" });
        // If the user deleted the session they're currently in, fall
        // back to whichever session is most recently used (or create a
        // fresh one if they wiped everything).
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
              map: normalizeMap(row.map),
              web: normalizeWeb(row.web),
              documents: normalizeDocuments(row.documents),
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

  const sortedSessions = useMemo(() => {
    if (!sessions) return null;
    return [...sessions].sort((a, b) =>
      a.updated_at < b.updated_at ? 1 : -1,
    );
  }, [sessions]);

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
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft dark:shadow-soft-dark">
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

        {loadError && (
          <div className="border-b border-danger/30 bg-danger-soft px-5 py-2 text-xs text-danger-fg">
            {loadError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {sortedSessions === null ? (
            <div className="px-3 py-6 text-center text-sm text-fg-muted">
              Loading sessions…
            </div>
          ) : sortedSessions.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-fg-muted">
              You don't have any sessions yet. Click{" "}
              <strong>New session</strong> above to start one.
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {sortedSessions.map((row) => (
                <li key={row.id}>
                  <SessionRow
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

interface SessionRowProps {
  summary: SessionSummary;
  isActive: boolean;
  busy: string | null;
  onSwitch: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function SessionRow({
  summary,
  isActive,
  busy,
  onSwitch,
  onRename,
  onDelete,
}: SessionRowProps) {
  const switching = busy === summary.id;
  return (
    <div
      className={clsx(
        "group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors",
        isActive ? "bg-accent/10" : "hover:bg-surface-sunk",
      )}
    >
      <button
        type="button"
        onClick={onSwitch}
        disabled={switching}
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-progress"
      >
        <span
          className={clsx(
            "h-2.5 w-2.5 flex-shrink-0 rounded-full",
            isActive ? "bg-accent" : "bg-fg-subtle/40",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p
            className={clsx(
              "truncate text-sm",
              isActive ? "font-medium text-fg" : "text-fg",
            )}
          >
            {summary.name}
          </p>
          <p className="truncate text-[11px] text-fg-subtle">
            Updated {formatTimeAgo(summary.updated_at)}
            {" · "}created {formatDate(summary.created_at)}
          </p>
        </div>
        {switching && (
          <span className="text-[11px] text-fg-muted">Loading…</span>
        )}
      </button>
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton
          label="Rename"
          onClick={onRename}
          disabled={switching}
        >
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
  );
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
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
        danger
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
    updatedAt:
      typeof u.updatedAt === "string"
        ? u.updatedAt
        : DEFAULT_SESSION_USAGE.updatedAt,
  };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
