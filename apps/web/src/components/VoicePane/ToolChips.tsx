import { useState } from "react";
import clsx from "clsx";
import type { ToolCallRecord } from "@seneca/shared";
import { presentTool } from "../../lib/toolSummary";

interface Props {
  tools: ToolCallRecord[];
  /** True while the turn is still in flight; chips render a pending dot. */
  pending?: boolean;
}

export function ToolChips({ tools, pending }: Props) {
  if (!tools.length) return null;
  return (
    <div className="-mx-1 mt-2 flex max-w-full flex-wrap gap-1.5 overflow-x-auto px-1 pb-1">
      {tools.map((t) => (
        <ToolChip key={t.id} record={t} pending={pending} />
      ))}
    </div>
  );
}

function ToolChip({
  record,
  pending,
}: {
  record: ToolCallRecord;
  pending?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { label, summary } = presentTool(record);

  const status =
    pending && record.ok === undefined
      ? "pending"
      : record.ok === false
        ? "error"
        : "ok";

  const dotClass =
    status === "pending"
      ? "bg-fg-subtle/60 animate-pulse"
      : status === "error"
        ? "bg-danger"
        : "bg-ok";

  const wrapperClass = clsx(
    "group inline-flex max-w-full flex-col rounded-lg border text-[11px] shadow-sm transition-colors",
    status === "error"
      ? "border-danger/40 bg-danger-soft/60"
      : status === "pending"
        ? "border-accent/40 bg-accent/10 hover:bg-accent/20"
        : "border-accent/30 bg-surface hover:bg-surface-sunk",
  );

  return (
    <div className={wrapperClass}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex max-w-[260px] items-center gap-2 px-2 py-1 text-left"
        title={`${record.name} — click to ${expanded ? "collapse" : "see input"}`}
      >
        <span
          className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)}
          aria-hidden
        />
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
          {label}
        </span>
        <span className="truncate text-fg-muted">{summary}</span>
        <span
          className={clsx(
            "ml-auto text-fg-subtle transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/60 px-2 py-1.5">
          <div className="mb-1 font-mono text-[10px] text-fg-subtle">
            {record.name}
          </div>
          <pre className="max-h-48 max-w-[420px] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-card p-2 font-mono text-[10px] leading-relaxed text-fg">
            {JSON.stringify(record.input, null, 2)}
          </pre>
          {record.error && (
            <div className="mt-1.5 rounded border border-danger/40 bg-danger-soft px-2 py-1 text-[11px] text-danger-fg">
              {record.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
