import { DangerZone, PanelIntro, PreviewBanner, Section } from "./_shared";

export function DataPrivacyPanel() {
  return (
    <>
      <PanelIntro description="Manage your data — what's stored, what gets exported, what gets deleted." />

      <PreviewBanner>
        Export and account-deletion endpoints aren't built yet. The buttons
        below are placeholders showing the eventual flow.
      </PreviewBanner>

      <Section
        label="Export"
        hint="Download your data in a portable format."
      >
        <div className="space-y-2">
          <ExportRow
            title="Export all sessions"
            desc="Transcripts, whiteboard scenes, map state, web history, and document metadata as a single ZIP."
          />
          <ExportRow
            title="Export memories"
            desc="Everything Seneca has remembered about you, as JSON."
          />
          <ExportRow
            title="Export documents"
            desc="The original PDFs you've uploaded."
          />
        </div>
      </Section>

      <Section
        label="Memory privacy"
        hint="Use the Memory tab to pause memory collection or remove individual entries."
      >
        <p className="text-sm text-fg-subtle">
          Memories are never used to train Anthropic's models. They live in
          your account only and are sent to Claude as part of the system
          context on each turn.
        </p>
      </Section>

      <DangerZone>
        <DangerRow
          title="Clear all sessions"
          desc="Delete every conversation, whiteboard, map state, and document. Your account stays."
          buttonLabel="Clear sessions"
        />
        <DangerRow
          title="Delete account"
          desc="Permanently remove your account, sessions, memories, and uploaded files. This cannot be undone."
          buttonLabel="Delete account"
        />
      </DangerZone>
    </>
  );
}

function ExportRow(props: { title: string; desc: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card/60 p-3">
      <div>
        <p className="text-sm font-medium text-fg">{props.title}</p>
        <p className="mt-0.5 text-xs text-fg-subtle">{props.desc}</p>
      </div>
      <button type="button" disabled className="btn-soft shrink-0 cursor-not-allowed opacity-60">
        Export
      </button>
    </div>
  );
}

function DangerRow(props: {
  title: string;
  desc: string;
  buttonLabel: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-fg">{props.title}</p>
        <p className="mt-0.5 text-xs text-fg-muted">{props.desc}</p>
      </div>
      <button
        type="button"
        disabled
        className="shrink-0 cursor-not-allowed rounded-md border border-danger/40 bg-card px-3 py-1.5 text-sm text-danger opacity-70"
      >
        {props.buttonLabel}
      </button>
    </div>
  );
}
