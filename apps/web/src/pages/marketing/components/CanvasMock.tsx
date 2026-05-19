/**
 * Stylised mock of the Seneca workspace shown in the hero. Pure CSS + SVG
 * so it stays crisp at every density and follows the active theme tokens.
 *
 * Important: this is decorative — every interactive-looking element has
 * `aria-hidden`. Real workspace UI lives at /app.
 */
export function CanvasMock() {
  return (
    <div
      role="img"
      aria-label="Illustration of the Seneca workspace: a voice pane on the left and a shared canvas on the right with a tab bar."
      className="canvas-mock relative aspect-[5/4] w-full overflow-hidden"
    >
      <div
        aria-hidden
        className="absolute inset-0 grid grid-cols-[140px_1fr] gap-px bg-border/60 sm:grid-cols-[170px_1fr]"
      >
        {/* ── Voice pane ────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 bg-card/95 p-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
              Listening
            </span>
          </div>

          {/* Waveform */}
          <div className="flex h-10 items-end gap-[3px]">
            {[28, 56, 38, 72, 50, 90, 64, 44, 70, 36, 58, 82, 48].map(
              (h, i) => (
                <span
                  key={i}
                  className="canvas-mock-wave block w-[3px] rounded-full bg-accent/80"
                  style={{
                    height: `${h}%`,
                    animationDelay: `${i * 0.08}s`,
                  }}
                />
              ),
            )}
          </div>

          {/* Transcript bubbles */}
          <div className="space-y-2 pt-1">
            <div className="space-y-1">
              <span className="block h-1.5 w-10 rounded-full bg-fg-subtle/40" />
              <span className="block h-1.5 w-24 rounded-full bg-fg-subtle/40" />
              <span className="block h-1.5 w-16 rounded-full bg-fg-subtle/40" />
            </div>
            <div className="ml-auto w-[80%] space-y-1">
              <span className="block h-1.5 w-full rounded-full bg-fg/60" />
              <span className="block h-1.5 w-3/4 rounded-full bg-fg/60" />
            </div>
            <div className="space-y-1">
              <span className="block h-1.5 w-20 rounded-full bg-fg-subtle/40" />
              <span className="block h-1.5 w-12 rounded-full bg-fg-subtle/40" />
            </div>
          </div>

          <div className="mt-auto flex items-center justify-between">
            <span className="canvas-mock-pulse inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-[10px] text-accent">
              ●
            </span>
            <span className="text-[10px] text-fg-subtle">Vision · off</span>
          </div>
        </div>

        {/* ── Canvas pane ───────────────────────────────────────────── */}
        <div className="flex flex-col bg-surface/95">
          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-border/60 px-3 py-2">
            {["Whiteboard", "Diagram", "Map", "Docs", "Web"].map((label, i) => (
              <span
                key={label}
                className={[
                  "rounded-md px-2 py-1 text-[10px]",
                  i === 0
                    ? "bg-card text-fg shadow-[inset_0_-2px_0_rgb(var(--c-accent))]"
                    : "text-fg-subtle",
                ].join(" ")}
              >
                {label}
              </span>
            ))}
            <span className="ml-auto text-[10px] text-fg-subtle">●●●</span>
          </div>

          {/* Whiteboard scene */}
          <div className="relative flex-1">
            <svg
              viewBox="0 0 400 300"
              className="absolute inset-0 h-full w-full"
              preserveAspectRatio="xMidYMid meet"
              aria-hidden
            >
              {/* Subtle grid */}
              <defs>
                <pattern
                  id="grid"
                  width="20"
                  height="20"
                  patternUnits="userSpaceOnUse"
                >
                  <circle
                    cx="1"
                    cy="1"
                    r="1"
                    fill="rgb(var(--c-fg-subtle) / 0.18)"
                  />
                </pattern>
                <linearGradient
                  id="ember-stroke"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop
                    offset="0%"
                    stopColor="rgb(var(--c-accent))"
                    stopOpacity="0.95"
                  />
                  <stop
                    offset="100%"
                    stopColor="rgb(var(--c-accent-soft))"
                    stopOpacity="0.85"
                  />
                </linearGradient>
              </defs>
              <rect width="400" height="300" fill="url(#grid)" />

              {/* Three connected nodes — a diagram of an argument */}
              <g
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                className="text-fg-muted"
              >
                <path
                  d="M120 90 C 165 70, 215 75, 250 110"
                  strokeLinecap="round"
                />
                <path
                  d="M250 130 C 230 175, 195 200, 150 215"
                  strokeLinecap="round"
                />
                <path
                  d="M118 200 C 90 170, 90 130, 110 105"
                  strokeLinecap="round"
                />
                <path
                  d="M268 122 L 282 116 L 278 130 Z"
                  fill="currentColor"
                  stroke="none"
                  opacity="0.7"
                />
              </g>

              {/* Three nodes */}
              <g className="text-fg">
                <rect
                  x="60"
                  y="70"
                  width="120"
                  height="44"
                  rx="6"
                  fill="rgb(var(--c-card))"
                  stroke="rgb(var(--c-border))"
                  strokeWidth="1"
                />
                <rect
                  x="240"
                  y="100"
                  width="118"
                  height="44"
                  rx="6"
                  fill="rgb(var(--c-card))"
                  stroke="rgb(var(--c-border))"
                  strokeWidth="1"
                />
                <rect
                  x="80"
                  y="200"
                  width="140"
                  height="44"
                  rx="6"
                  fill="rgb(var(--c-card))"
                  stroke="url(#ember-stroke)"
                  strokeWidth="1.5"
                />

                {/* Node text bars */}
                <rect x="74" y="84" width="60" height="4" rx="2" fill="rgb(var(--c-fg) / 0.55)" />
                <rect x="74" y="94" width="38" height="3" rx="1.5" fill="rgb(var(--c-fg-subtle) / 0.7)" />

                <rect x="254" y="114" width="58" height="4" rx="2" fill="rgb(var(--c-fg) / 0.55)" />
                <rect x="254" y="124" width="34" height="3" rx="1.5" fill="rgb(var(--c-fg-subtle) / 0.7)" />

                <rect x="94" y="214" width="80" height="4" rx="2" fill="rgb(var(--c-fg) / 0.55)" />
                <rect x="94" y="224" width="50" height="3" rx="1.5" fill="rgb(var(--c-fg-subtle) / 0.7)" />
              </g>

              {/* Hand-drawn ember underline (Seneca's stroke) */}
              <path
                d="M80 268 q 30 -8 60 0 t 60 0 t 60 -3 t 60 4"
                fill="none"
                stroke="rgb(var(--c-accent))"
                strokeWidth="1.6"
                strokeLinecap="round"
                opacity="0.85"
              />
            </svg>

            {/* Floating cursor blip — Seneca pointing */}
            <span
              aria-hidden
              className="canvas-mock-pulse absolute right-[18%] top-[36%] inline-flex h-3 w-3 items-center justify-center rounded-full bg-accent shadow-[0_0_0_4px_rgb(var(--c-accent)/0.2)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
