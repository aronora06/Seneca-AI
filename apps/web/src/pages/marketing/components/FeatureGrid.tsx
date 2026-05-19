import { FEATURES } from "../marketingCopy";
import { Reveal } from "./Reveal";

type FeatureId = (typeof FEATURES)[number]["id"];

interface FeatureIconProps {
  id: FeatureId;
}

function FeatureIcon({ id }: FeatureIconProps) {
  const stroke = "currentColor";
  const common = {
    width: 28,
    height: 28,
    viewBox: "0 0 28 28",
    fill: "none" as const,
    stroke,
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (id) {
    case "voice":
      return (
        <svg {...common}>
          <rect x="11" y="3.5" width="6" height="13" rx="3" />
          <path d="M6.5 13.5a7.5 7.5 0 0 0 15 0" />
          <path d="M14 21v3.5" />
          <path d="M10.5 24.5h7" />
        </svg>
      );
    case "canvas":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="21" height="17" rx="2.5" />
          <path d="M3.5 10h21" />
          <circle cx="6.5" cy="7.5" r="0.6" fill={stroke} />
          <circle cx="9" cy="7.5" r="0.6" fill={stroke} />
          <path d="M8 15.5c2 -2 4.5 -2 6.5 0s4.5 2 6.5 0" />
        </svg>
      );
    case "documents":
      return (
        <svg {...common}>
          <path d="M7 3.5h9l5 5v15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-19a1 1 0 0 1 1-1z" />
          <path d="M16 3.5v5h5" />
          <path d="M10 14h8" />
          <path d="M10 17.5h8" />
          <path d="M10 21h5" />
        </svg>
      );
    case "vision":
      return (
        <svg {...common}>
          <path d="M2.5 14s4-7 11.5-7 11.5 7 11.5 7-4 7-11.5 7S2.5 14 2.5 14z" />
          <circle cx="14" cy="14" r="3.25" />
        </svg>
      );
    default:
      return null;
  }
}

export function FeatureGrid() {
  return (
    <section
      id="features"
      className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28"
      aria-labelledby="features-heading"
    >
      <Reveal className="max-w-2xl">
        <span className="marketing-rule">What you get</span>
        <h2
          id="features-heading"
          className="mt-5 font-serif text-3xl leading-tight text-fg sm:text-4xl md:text-5xl"
        >
          One workspace, one conversation.
        </h2>
        <p className="mt-4 text-lg text-fg-muted">
          Not a chat sidebar that watches a separate window. Voice and the
          canvas live in the same room — yours and Seneca's.
        </p>
      </Reveal>

      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border/80 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((feature, index) => (
          <Reveal
            key={feature.id}
            delay={index * 60}
            as="article"
            className="group relative flex h-full flex-col bg-card/85 p-6 transition-colors hover:bg-card"
          >
            <span
              aria-hidden
              className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-accent/0 via-accent/40 to-accent/0 opacity-0 transition-opacity group-hover:opacity-100"
            />
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-accent/10 text-accent">
              <FeatureIcon id={feature.id} />
            </span>
            <h3 className="mt-5 font-serif text-xl text-fg">
              {feature.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              {feature.body}
            </p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
