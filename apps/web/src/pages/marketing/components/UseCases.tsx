import { USE_CASES } from "../marketingCopy";
import { Reveal } from "./Reveal";

export function UseCases() {
  return (
    <section
      className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28"
      aria-labelledby="use-cases-heading"
    >
      <div className="grid gap-12 md:grid-cols-[0.85fr_1.15fr] md:gap-16">
        <Reveal>
          <span className="marketing-rule">In practice</span>
          <h2
            id="use-cases-heading"
            className="mt-5 font-serif text-3xl leading-tight text-fg sm:text-4xl"
          >
            Open-ended sessions, fully shared.
          </h2>
          <p className="mt-4 text-lg text-fg-muted">
            Three flavours of conversation Seneca was built to hold. Bring
            your own.
          </p>
        </Reveal>

        <ol className="space-y-px overflow-hidden rounded-2xl border border-border bg-border/80">
          {USE_CASES.map((uc, index) => (
            <Reveal
              key={uc.id}
              delay={index * 70}
              as="li"
              className="bg-card/85 p-6 transition-colors hover:bg-card md:p-7"
            >
              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
                {uc.kicker}
              </span>
              <h3 className="mt-2 font-serif text-2xl text-fg">{uc.title}</h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-fg-muted">
                {uc.body}
              </p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
