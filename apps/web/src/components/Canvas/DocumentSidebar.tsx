/**
 * Sidebar listing every uploaded document plus an "add" affordance.
 * Inline confirm-on-delete keeps accidents recoverable without a modal.
 */

import clsx from "clsx";
import { useCallback, useRef, useState } from "react";

import type {
  DocumentIndexStatus,
  DocumentRecord,
  DocumentTextStatus,
} from "@seneca/shared";

interface DocumentSidebarProps {
  items: DocumentRecord[];
  activeId: string | null;
  uploading: boolean;
  uploadError: string | null;
  onPick: (documentId: string) => void;
  onUpload: (file: File) => void;
  onDelete: (documentId: string) => void;
}

const MAX_BYTES = 25 * 1024 * 1024;

export function DocumentSidebar({
  items,
  activeId,
  uploading,
  uploadError,
  onPick,
  onUpload,
  onDelete,
}: DocumentSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const triggerPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      const localError = validateFile(file);
      if (localError) {
        // Surface client-side validation in the same banner the upload uses.
        // The component exposes uploadError via prop so we synthesise an
        // upload attempt: the parent will set the same banner if the server
        // rejects, so for client-side rejection we just bail with a noop —
        // the parent passes uploadError back when an upload actually fails.
        // For client-side rejection, we throw via the picker to avoid a
        // pointless POST round-trip:
        alert(localError);
        return;
      }
      onUpload(file);
    },
    [onUpload],
  );

  return (
    <aside
      className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card/40"
      aria-label="Documents list"
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
          Documents
          {items.length > 0 && (
            <span className="ml-1.5 font-mono text-fg-muted">
              ({items.length})
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={triggerPicker}
          disabled={uploading}
          className={clsx(
            "btn h-7 px-2 text-[11px] font-medium",
            uploading
              ? "cursor-not-allowed bg-surface-sunk text-fg-subtle"
              : "bg-fg text-fg-on hover:opacity-90",
          )}
        >
          {uploading ? "Adding…" : "+ Add"}
        </button>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          handleFile(file);
          // Reset so picking the same file twice still triggers onChange.
          e.target.value = "";
        }}
      />

      {uploadError && (
        <div className="border-b border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger-fg">
          {uploadError}
        </div>
      )}

      <ul className="flex-1 overflow-y-auto p-2">
        {items.length === 0 && !uploading && (
          <li className="px-2 py-6 text-center text-xs italic text-fg-subtle">
            Nothing here yet. Drop a file or use “Add” above. Supports PDF,
            .docx, .pptx, .md, .txt, .html.
          </li>
        )}
        {items.map((doc) => {
          const isActive = doc.id === activeId;
          const isConfirming = confirmingId === doc.id;
          return (
            <li key={doc.id}>
              <div
                className={clsx(
                  "group flex flex-col gap-0.5 rounded-md border px-2.5 py-2 transition-colors",
                  isActive
                    ? "border-accent/50 bg-surface-sunk"
                    : "border-transparent hover:bg-surface-sunk",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (isConfirming) setConfirmingId(null);
                    if (!isActive) onPick(doc.id);
                  }}
                  className="flex items-start gap-2 text-left"
                >
                  <span
                    className={clsx(
                      "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm",
                      isActive ? "bg-accent text-accent-fg" : "text-fg-subtle",
                    )}
                    aria-hidden
                  >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M3 2h7l3 3v9H3z"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M10 2v3h3"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5">
                      {doc.origin === "ai-created" && (
                        <span
                          title="Authored by Seneca"
                          aria-label="Authored by Seneca"
                          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-[10px] font-semibold text-accent-fg"
                        >
                          ✦
                        </span>
                      )}
                      <span className="truncate text-xs font-medium text-fg">
                        {doc.name}
                      </span>
                      <TextStatusPill status={doc.textStatus} />
                      <IndexStatusPill status={doc.indexStatus} />
                    </span>
                    <span className="truncate text-[10px] text-fg-subtle">
                      {doc.pageCount > 0
                        ? `Page ${doc.currentPage} / ${doc.pageCount}`
                        : "Loading…"}{" "}
                      · {formatBytes(doc.size)}
                    </span>
                  </span>
                </button>

                {isConfirming ? (
                  <div className="mt-1 flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="btn h-6 px-2 text-[10px] font-medium text-fg-muted hover:bg-surface hover:text-fg"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingId(null);
                        onDelete(doc.id);
                      }}
                      className="btn h-6 px-2 text-[10px] font-medium bg-danger text-fg-on hover:opacity-90"
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <div className="mt-1 flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setConfirmingId(doc.id)}
                      className="btn h-6 px-2 text-[10px] font-medium text-fg-subtle hover:bg-surface hover:text-danger"
                      aria-label={`Delete ${doc.name}`}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/**
 * Tiny dot + label showing whether Seneca can read this PDF cheaply.
 * Hidden when status is undefined (legacy records pre-Priority 1a) — we
 * don't want to add noise for docs that predate the feature.
 *
 * Colours:
 *   green  → extracted text available, cheap reads via document_read_page
 *   amber  → scanned PDF; Seneca will read it via a server-rendered image
 *            (slightly slower, slightly more expensive, still transparent)
 *   red    → extraction failed entirely; only the eye toggle works
 *   muted  → extraction hasn't run yet (lazy / pending)
 */
function TextStatusPill({ status }: { status?: DocumentTextStatus }) {
  if (!status) return null;
  const config: Record<
    DocumentTextStatus,
    { color: string; label: string; tooltip: string }
  > = {
    extracted: {
      color: "bg-ok",
      label: "Text",
      tooltip: "Searchable, cheap to read",
    },
    scanned: {
      color: "bg-accent",
      label: "Scan",
      tooltip:
        "Scanned PDF — Seneca will read it visually (slightly more expensive)",
    },
    failed: {
      color: "bg-danger",
      label: "?",
      tooltip:
        "Text extraction failed. Toggle the eye icon to share what you see.",
    },
    pending: {
      color: "bg-fg-subtle",
      label: "…",
      tooltip: "Text not yet extracted",
    },
  };
  const c = config[status];
  return (
    <span
      title={c.tooltip}
      className={clsx(
        "inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 py-px text-[8px] font-medium uppercase tracking-wide text-fg-on",
        c.color,
      )}
      aria-label={c.tooltip}
    >
      {c.label}
    </span>
  );
}

/**
 * Tiny pill showing whether `document_search` will run as a semantic
 * cosine top-k lookup ("Index") or fall back to substring on this doc.
 * Hidden for legacy records pre-Priority 1b (`undefined` status).
 *
 * Colours mirror the text-status pill so the user can scan them together:
 *   blue   → embeddings indexed; semantic search is on
 *   amber  → indexing in progress
 *   muted  → not started yet
 *   red    → indexing failed; substring fallback in use
 *   slate  → skipped (no extracted text, or VOYAGE_API_KEY unset)
 */
function IndexStatusPill({ status }: { status?: DocumentIndexStatus }) {
  if (!status) return null;
  const config: Record<
    DocumentIndexStatus,
    { color: string; label: string; tooltip: string }
  > = {
    indexed: {
      color: "bg-accent",
      label: "Index",
      tooltip: "Semantic search enabled (cosine top-k)",
    },
    indexing: {
      color: "bg-fg-muted",
      label: "Idx…",
      tooltip: "Indexing in progress; search will be substring until it's done",
    },
    pending: {
      color: "bg-fg-subtle",
      label: "…",
      tooltip: "Embedding index not built yet",
    },
    skipped: {
      color: "bg-fg-subtle",
      label: "—",
      tooltip:
        "No embeddings available (no extracted text, or VOYAGE_API_KEY not set). Search uses substring fallback.",
    },
    failed: {
      color: "bg-danger",
      label: "Idx!",
      tooltip:
        "Embedding indexing failed. Search falls back to substring; we'll retry.",
    },
  };
  const c = config[status];
  return (
    <span
      title={c.tooltip}
      className={clsx(
        "inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 py-px text-[8px] font-medium uppercase tracking-wide text-fg-on",
        c.color,
      )}
      aria-label={c.tooltip}
    >
      {c.label}
    </span>
  );
}

// Phase 5: mirrored from the server's extractor registry. Kept here as
// a const so the file picker, the validator, and the empty state all
// reference the same canonical list. If you add a new extractor on the
// server, append the matching extension (and mime if known) here so the
// `<input accept>` filter and the client-side reject message stay aligned.
const SUPPORTED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".pptx",
  ".md",
  ".markdown",
  ".txt",
  ".html",
  ".htm",
] as const;
const SUPPORTED_MIMES: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/markdown",
  "text/x-markdown",
  "text/plain",
  "text/html",
  "application/xhtml+xml",
  "application/zip", // Some browsers send OOXML as zip.
]);
const ACCEPTED_FILE_TYPES = [
  ...SUPPORTED_MIMES,
  ...SUPPORTED_EXTENSIONS,
].join(",");

function validateFile(file: File): string | null {
  const lowerName = file.name.toLowerCase();
  const hasExt = SUPPORTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const hasMime = file.type && SUPPORTED_MIMES.has(file.type);
  if (!hasExt && !hasMime) {
    return "Unsupported file type. Seneca accepts PDF, .docx, .pptx, .md, .txt, .html.";
  }
  if (file.size > MAX_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max upload size is ${MAX_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
