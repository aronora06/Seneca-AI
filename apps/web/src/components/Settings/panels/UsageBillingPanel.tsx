import { PanelIntro, PreviewBanner, Section } from "./_shared";

const MOCK_THIS_SESSION = {
  inputTokens: 0,
  outputTokens: 0,
  estimatedCost: 0,
};

const MOCK_THIS_PERIOD = {
  totalTokens: 0,
  estimatedCost: 0,
  opusShare: 0,
  sonnetShare: 0,
};

export function UsageBillingPanel() {
  return (
    <>
      <PanelIntro description="Track how much you're using Seneca and what it's costing you." />

      <PreviewBanner>
        Per-turn token telemetry isn't wired up yet. Once each Anthropic
        response includes its{" "}
        <code className="rounded bg-card px-1 py-0.5 text-xs">usage</code> block
        on the wire, the values below will start ticking.
      </PreviewBanner>

      <Section label="Current session">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Input tokens"  value={MOCK_THIS_SESSION.inputTokens.toLocaleString()} />
          <Stat label="Output tokens" value={MOCK_THIS_SESSION.outputTokens.toLocaleString()} />
          <Stat
            label="Estimated cost"
            value={`$${MOCK_THIS_SESSION.estimatedCost.toFixed(2)}`}
          />
        </div>
      </Section>

      <Section label="This month">
        <div className="grid grid-cols-2 gap-3">
          <Stat
            label="Total tokens"
            value={MOCK_THIS_PERIOD.totalTokens.toLocaleString()}
          />
          <Stat
            label="Estimated cost"
            value={`$${MOCK_THIS_PERIOD.estimatedCost.toFixed(2)}`}
          />
        </div>
        <div className="mt-3 rounded-lg border border-border bg-surface-sunk/40 p-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-fg-subtle">
            Model split
          </p>
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <span>Opus (vision): {MOCK_THIS_PERIOD.opusShare}%</span>
            <span>•</span>
            <span>Sonnet (text): {MOCK_THIS_PERIOD.sonnetShare}%</span>
          </div>
        </div>
      </Section>

      <Section label="Plan">
        <div className="rounded-lg border border-border bg-card/60 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-fg">Free</p>
              <p className="mt-0.5 text-xs text-fg-subtle">
                Bring-your-own Anthropic API key. No platform billing today.
              </p>
            </div>
            <button type="button" disabled className="btn-soft cursor-not-allowed opacity-60">
              Manage plan
            </button>
          </div>
        </div>
      </Section>
    </>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
        {props.label}
      </p>
      <p className="mt-1 font-serif text-2xl text-fg">{props.value}</p>
    </div>
  );
}
