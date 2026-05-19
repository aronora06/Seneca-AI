import { Link } from "react-router-dom";

import { devBypassAuth } from "../../../lib/devBypass";
import { HERO } from "../marketingCopy";
import { CanvasMock } from "./CanvasMock";
import { Reveal } from "./Reveal";

export function Hero() {
  const showDevWorkspace = import.meta.env.DEV && devBypassAuth;
  const ctaTo = showDevWorkspace ? "/app" : "/login";
  const ctaLabel = showDevWorkspace
    ? HERO.primaryCtaBypass
    : HERO.primaryCta;

  return (
    <section
      className="relative overflow-hidden"
      aria-labelledby="hero-heading"
    >
      <div className="marketing-hero-wash" aria-hidden />

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-12 sm:px-8 md:pb-24 md:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div className="max-w-xl">
          <Reveal>
            <span className="marketing-rule">{HERO.eyebrow}</span>
          </Reveal>

          <Reveal delay={60}>
            <h1
              id="hero-heading"
              className="mt-6 font-serif text-4xl leading-[1.05] text-fg sm:text-5xl md:text-[3.5rem] lg:text-[3.75rem]"
            >
              {HERO.headline}
            </h1>
          </Reveal>

          <Reveal delay={120}>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-fg-muted">
              {HERO.subhead}
            </p>
          </Reveal>

          <Reveal delay={180}>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to={ctaTo}
                className="btn-primary px-6 py-3 text-base shadow-soft dark:shadow-soft-dark"
              >
                {ctaLabel}
                <span aria-hidden className="ml-1">
                  →
                </span>
              </Link>
              <Link
                to="/about"
                className="btn-soft px-6 py-3 text-base"
              >
                {HERO.secondaryCta}
              </Link>
            </div>
          </Reveal>

          <Reveal delay={240}>
            <p className="mt-8 flex items-center gap-3 text-sm text-fg-subtle">
              <span
                aria-hidden
                className="inline-block h-px w-8 bg-fg-subtle/60"
              />
              {HERO.proof}
            </p>
          </Reveal>
        </div>

        <Reveal delay={140} className="relative">
          <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[1.5rem] bg-gradient-to-tr from-accent/10 via-transparent to-accent-soft/10 blur-2xl" />
          <CanvasMock />
        </Reveal>
      </div>
    </section>
  );
}
