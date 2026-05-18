/**
 * Phase 4 header pill: live per-turn + per-session token / USD readout.
 *
 * Reads two slices of the store:
 *   - `lastTurnUsage` for the "1.2k in / 480 out · $0.04 turn" half
 *   - `sessionUsage` for the "· $0.61 session" half
 *
 * Hidden until the first usage event lands, so a brand-new session
 * doesn't show a dollar pill on a not-yet-spent dollar.
 */

import { useSenecaStore } from "../store/seneca";

export function CostPill() {
  const lastTurnUsage = useSenecaStore((s) => s.lastTurnUsage);
  const sessionUsage = useSenecaStore((s) => s.sessionUsage);

  // Don't render until something's been spent — avoids a stale "$0.00"
  // pill on a fresh boot.
  const ttsChars = sessionUsage.ttsCharacters ?? 0;
  const ttsCost = sessionUsage.ttsCostUSD ?? 0;
  const hasSpent =
    sessionUsage.inputCostUSD > 0 ||
    sessionUsage.outputCostUSD > 0 ||
    ttsCost > 0;
  if (!hasSpent && !lastTurnUsage) return null;

  const sessionTotal =
    sessionUsage.inputCostUSD + sessionUsage.outputCostUSD + ttsCost;

  const turnIn = lastTurnUsage?.inputTokens ?? 0;
  const turnOut = lastTurnUsage?.outputTokens ?? 0;
  const turnTotal =
    (lastTurnUsage?.inputCostUSD ?? 0) +
    (lastTurnUsage?.outputCostUSD ?? 0);

  const tooltip = [
    `Last turn: ${turnIn.toLocaleString()} in / ${turnOut.toLocaleString()} out`,
    `Last turn cost: ${formatUSD(turnTotal)}`,
    `Session model cost: ${formatUSD(
      sessionUsage.inputCostUSD + sessionUsage.outputCostUSD,
    )}`,
    ttsChars > 0
      ? `TTS: ${ttsChars.toLocaleString()} chars · ${formatUSD(ttsCost)} (ElevenLabs)`
      : null,
    `Session total: ${formatUSD(sessionTotal)}`,
    lastTurnUsage ? `Model: ${lastTurnUsage.model}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      title={tooltip}
      className="hidden items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 font-mono text-[10px] text-fg-muted sm:flex"
    >
      {lastTurnUsage && (
        <>
          <span>
            {formatTok(turnIn)} in / {formatTok(turnOut)} out
          </span>
          <span aria-hidden className="text-fg-subtle">
            ·
          </span>
          <span>{formatUSD(turnTotal)} turn</span>
          <span aria-hidden className="text-fg-subtle">
            ·
          </span>
        </>
      )}
      <span>{formatUSD(sessionTotal)} session</span>
    </span>
  );
}

function formatTok(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

function formatUSD(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString()}`;
}
