import { Link } from "react-router-dom";

import { devBypassAuth } from "../../../lib/devBypass";
import { CTA_BAND, HERO } from "../marketingCopy";
import { Reveal } from "./Reveal";

export function CtaBand() {
  const showDevWorkspace = import.meta.env.DEV && devBypassAuth;
  const ctaTo = showDevWorkspace ? "/app" : "/login";
  const ctaLabel = showDevWorkspace
    ? HERO.primaryCtaBypass
    : HERO.primaryCta;

  return (
    <section
      className="px-5 pb-20 sm:px-8 md:pb-28"
      aria-labelledby="cta-heading"
    >
      <Reveal className="mx-auto max-w-5xl">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card/85 px-6 py-12 text-center shadow-soft backdrop-blur dark:shadow-soft-dark sm:px-12 md:py-16">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_50%_0%,rgb(var(--c-accent)/0.16),transparent_70%)]"
          />
          <span className="marketing-rule">{CTA_BAND.eyebrow}</span>
          <h2
            id="cta-heading"
            className="mx-auto mt-5 max-w-2xl font-serif text-3xl leading-tight text-fg sm:text-4xl md:text-[2.75rem]"
          >
            {CTA_BAND.headline}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-fg-muted">
            {CTA_BAND.body}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to={ctaTo}
              className="btn-primary px-6 py-3 text-base shadow-soft dark:shadow-soft-dark"
            >
              {ctaLabel}
              <span aria-hidden className="ml-1">
                →
              </span>
            </Link>
            <Link to="/about" className="btn-soft px-6 py-3 text-base">
              {HERO.secondaryCta}
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
