/**
 * Phase D — convert a session row into a downloadable markdown
 * transcript. The "Download" item in the SessionsModal calls
 * `downloadSessionMarkdown(row)`, which builds the document via
 * `buildSessionMarkdown` and triggers a Blob download.
 *
 * The markdown is intentionally human-readable: a `# {name}` heading,
 * the date the session was created and last updated, an
 * `## Attached documents` list (with current page on each), and an
 * `## Transcript` block where each turn is a `### {role}` heading
 * followed by the text. System notices are skipped (they're
 * UI-internal); tool chips are rendered as inline italic notes.
 *
 * `buildSessionMarkdown` is exported separately and pure so the unit
 * tests can assert on the exact string without poking the DOM.
 */

import type {
  DocumentRecord,
  SessionRecord,
  TranscriptMessage,
} from "@seneca/shared";

const FILENAME_SAFE = /[^a-z0-9-_]+/gi;

export function buildSessionMarkdown(row: SessionRecord): string {
  const lines: string[] = [];
  lines.push(`# ${row.name || "Untitled session"}`);
  lines.push("");
  lines.push(
    `*Created ${formatDate(row.created_at)} · last updated ${formatDate(
      row.updated_at,
    )}*`,
  );
  lines.push("");

  const docs = Array.isArray(row.documents?.items) ? row.documents.items : [];
  if (docs.length > 0) {
    lines.push("## Attached documents");
    lines.push("");
    for (const doc of docs) {
      lines.push(`- ${renderDoc(doc)}`);
    }
    lines.push("");
  }

  const transcript: TranscriptMessage[] = Array.isArray(row.transcript)
    ? row.transcript
    : [];
  if (transcript.length === 0) {
    lines.push("## Transcript");
    lines.push("");
    lines.push("_(empty)_");
    return lines.join("\n");
  }

  lines.push("## Transcript");
  lines.push("");
  for (const msg of transcript) {
    if (msg.role === "system") {
      // System notices are UI banners — they shouldn't end up in an
      // export because they're not part of the conversation.
      continue;
    }
    const label = msg.role === "user" ? "You" : "Seneca";
    lines.push(`### ${label} · ${formatDate(msg.ts)}`);
    lines.push("");
    if (msg.text && msg.text.trim().length > 0) {
      lines.push(msg.text.trim());
      lines.push("");
    }
    if (msg.tools && msg.tools.length > 0) {
      for (const tool of msg.tools) {
        const outcome = tool.ok === false ? "failed" : "ok";
        lines.push(`> *tool: \`${tool.name}\` (${outcome})*`);
      }
      lines.push("");
    }
  }
  return lines.join("\n").trim() + "\n";
}

function renderDoc(doc: DocumentRecord): string {
  const page =
    doc.pageCount > 0
      ? ` — page ${doc.currentPage} of ${doc.pageCount}`
      : "";
  return `**${doc.name}** (${doc.filename})${page}`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Browser-side trigger: build the markdown, wrap it in a Blob, and
 * use a hidden anchor click to ask the browser to save it. Returns
 * the filename used so callers can show a confirmation toast if
 * they want.
 */
export function downloadSessionMarkdown(row: SessionRecord): string {
  const md = buildSessionMarkdown(row);
  const filename = sessionFilename(row);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Microtask-defer the revoke so Safari still has the URL when it
  // resolves the click navigation in its own task.
  setTimeout(() => URL.revokeObjectURL(url), 100);
  return filename;
}

export function sessionFilename(row: SessionRecord): string {
  const safeName = (row.name || "session")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(FILENAME_SAFE, "");
  const trimmed = safeName.slice(0, 60) || "session";
  const datePart = new Date(row.updated_at ?? Date.now())
    .toISOString()
    .slice(0, 10);
  return `${trimmed}-${datePart}.md`;
}
