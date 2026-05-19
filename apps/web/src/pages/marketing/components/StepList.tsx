import { Reveal } from "./Reveal";

export interface StepItem {
  step: string;
  title: string;
  body: string;
}

interface StepListProps {
  steps: ReadonlyArray<StepItem>;
  ariaLabel?: string;
}

export function StepList({ steps, ariaLabel }: StepListProps) {
  return (
    <ol
      className="relative space-y-10 border-l border-border/70 pl-8 sm:pl-10"
      aria-label={ariaLabel}
    >
      {steps.map((s, index) => (
        <Reveal
          key={s.step}
          delay={index * 60}
          as="li"
          className="relative"
        >
          <span
            aria-hidden
            className="absolute -left-[2.55rem] top-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card font-serif text-sm font-medium text-accent shadow-soft dark:shadow-soft-dark sm:-left-[2.95rem] sm:h-10 sm:w-10"
          >
            {s.step}
          </span>
          <h3 className="font-serif text-xl text-fg">{s.title}</h3>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-fg-muted">
            {s.body}
          </p>
        </Reveal>
      ))}
    </ol>
  );
}
