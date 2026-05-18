/**
 * Shared visual primitives used by every settings panel.
 * Keeps each panel small and the visual language consistent.
 */
import clsx from "clsx";

/** Top-of-panel intro: short description + optional auto-save hint. */
export function PanelIntro(props: {
  description: string;
  autoSaves?: boolean;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <p className="text-sm text-fg-muted">{props.description}</p>
      {props.autoSaves && (
        <span className="shrink-0 rounded-full border border-ok/30 bg-ok-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ok">
          Auto-saves
        </span>
      )}
    </div>
  );
}

/** Coloured callout used to flag placeholder or upcoming features. */
export function PreviewBanner(props: { children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-fg">
      <span className="mr-2 inline-block rounded bg-accent/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-fg">
        Preview
      </span>
      {props.children}
    </div>
  );
}

/** Standard fieldset wrapper for an individual control or group. */
export function Section(props: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="mb-5 last:mb-0">
      <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">
        {props.label}
      </legend>
      {props.hint && (
        <p className="mb-2 text-xs text-fg-subtle">{props.hint}</p>
      )}
      {props.children}
    </fieldset>
  );
}

/** A clearly marked "danger zone" container for destructive actions. */
export function DangerZone(props: { children: React.ReactNode }) {
  return (
    <div className="mt-8 rounded-lg border border-danger/30 bg-danger-soft/40 p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-danger">
        Danger zone
      </div>
      <div className="space-y-3">{props.children}</div>
    </div>
  );
}

/** A small inline button that looks ghosted but stays accessible. */
export function GhostLink(props: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={clsx(
        "text-sm text-accent underline-offset-2 hover:underline",
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}
