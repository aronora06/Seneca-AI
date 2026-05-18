/**
 * Phase D — "Welcome back" banner shown above the transcript when a
 * session loads with prior context. It summarises what's already
 * loaded so a returning user can re-enter the conversation without
 * scrolling back to the top of a 200-turn transcript.
 *
 * Lifetimes:
 *   - Visible after `loadSession` (modal switch) or `setTranscript`
 *     (boot) when `transcript.length > 0`.
 *   - Hidden as soon as the user sends or receives a new message
 *     (the `appendTranscript` reducer flips `resumeBannerVisible`
 *     off — see store/seneca.ts).
 *   - Dismiss button hides it explicitly.
 */

import type { TranscriptMessage } from "@seneca/shared";

import { useSenecaStore } from "../../store/seneca";

interface SummaryPart {
  /** Plain label, e.g. "Spinoza Letters is open on page 47". */
  label: string;
  /** Optional emphasised value rendered after the label. */
  value?: string;
}

export function ResumeBanner() {
  const visible = useSenecaStore((s) => s.resumeBannerVisible);
  const transcript = useSenecaStore((s) => s.transcript);
  const documents = useSenecaStore((s) => s.documentsState);
  const sessionName = useSenecaStore((s) => s.session.name);
  const dismiss = useSenecaStore((s) => s.dismissResumeBanner);

  if (!visible) return null;
  if (transcript.length === 0) return null;

  const lastUser = findLastUserMessage(transcript);
  const docs = documents?.items ?? [];
  const activeDoc = docs.find((d) => d.id === documents?.activeId) ?? null;

  const parts: SummaryPart[] = [];
  if (docs.length === 1 && activeDoc) {
    const pageHint =
      activeDoc.pageCount > 0
        ? `page ${activeDoc.currentPage} of ${activeDoc.pageCount}`
        : `page ${activeDoc.currentPage}`;
    parts.push({ label: `${activeDoc.name} on ${pageHint}` });
  } else if (docs.length > 1) {
    parts.push({ label: `${docs.length} documents loaded` });
  }
  if (lastUser) {
    parts.push({ label: "Last asked", value: truncate(lastUser.text, 110) });
  }

  return (
    <div
      className="mx-3 mt-3 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-fg"
      role="status"
      aria-label="Resume hint"
    >
      <span aria-hidden className="mt-0.5 text-base">
        ◌
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-serif text-[15px] leading-snug text-fg">
          Welcome back to{" "}
          <span className="font-medium">{sessionName || "this session"}</span>.
        </p>
        {parts.length > 0 && (
          <p className="mt-0.5 text-[13px] leading-snug text-fg-muted">
            {parts.map((p, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden> · </span>}
                {p.value ? (
                  <>
                    {p.label}: <em className="text-fg">{p.value}</em>
                  </>
                ) : (
                  <span>{p.label}</span>
                )}
              </span>
            ))}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss welcome banner"
        title="Dismiss"
        className="-mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-accent/10 hover:text-fg"
      >
        ✕
      </button>
    </div>
  );
}

function findLastUserMessage(
  transcript: ReadonlyArray<TranscriptMessage>,
): TranscriptMessage | null {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m && m.role === "user" && typeof m.text === "string" && m.text.trim()) {
      return m;
    }
  }
  return null;
}

function truncate(raw: string, max: number): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1) + "…";
}
