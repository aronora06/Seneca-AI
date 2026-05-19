import { Link } from "react-router-dom";

import { devBypassAuth } from "../../lib/devBypass";
import { CtaBand } from "./components/CtaBand";
import { Reveal } from "./components/Reveal";
import { StepList } from "./components/StepList";
import { ABOUT, HERO, STEPS } from "./marketingCopy";
import { useDocumentTitle } from "./useDocumentTitle";

export function AboutPage() {
  useDocumentTitle("About — Seneca");

  const showDevWorkspace = import.meta.env.DEV && devBypassAuth;
  const ctaTo = showDevWorkspace ? "/app" : "/login";
  const ctaLabel = showDevWorkspace
    ? HERO.primaryCtaBypass
    : "Sign in to start";

  return (
    <>
      <section
        className="relative overflow-hidden"
        aria-labelledby="about-heading"
      >
        <div className="marketing-hero-wash" aria-hidden />
        <div className="mx-auto max-w-3xl px-5 pb-12 pt-12 sm:px-8 md:pb-16 md:pt-20">
          <Reveal>
            <span className="marketing-rule">{ABOUT.eyebrow}</span>
          </Reveal>
          <Reveal delay={60}>
            <h1
              id="about-heading"
              className="mt-6 font-serif text-4xl leading-tight text-fg sm:text-5xl"
            >
              {ABOUT.headline}
            </h1>
          </Reveal>
          <Reveal delay={120}>
            <p className="mt-6 text-lg leading-relaxed text-fg-muted">
              {ABOUT.subhead}
            </p>
          </Reveal>
        </div>
      </section>

      <section
        className="mx-auto max-w-3xl px-5 pb-16 sm:px-8 md:pb-24"
        aria-labelledby="how-it-works-heading"
      >
        <Reveal>
          <h2
            id="how-it-works-heading"
            className="font-serif text-2xl text-fg sm:text-3xl"
          >
            How a session unfolds
          </h2>
          <p className="mt-3 max-w-xl text-base text-fg-muted">
            Four moves, the same room.
          </p>
        </Reveal>

        <div className="mt-10">
          <StepList steps={STEPS} ariaLabel="How a Seneca session unfolds" />
        </div>
      </section>

      <section
        className="mx-auto max-w-3xl px-5 pb-20 sm:px-8 md:pb-28"
        aria-labelledby="self-directed-heading"
      >
        <Reveal>
          <div className="card relative overflow-hidden p-8 md:p-10">
            <span
              aria-hidden
              className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-accent/10 blur-2xl"
            />
            <h2
              id="self-directed-heading"
              className="font-serif text-2xl text-fg"
            >
              {ABOUT.closingTitle}
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-fg-muted">
              {ABOUT.closingBody}
            </p>
            <Link
              to={ctaTo}
              className="btn-primary mt-7 inline-flex px-5 py-2.5"
            >
              {ctaLabel}
              <span aria-hidden className="ml-1">
                →
              </span>
            </Link>
          </div>
        </Reveal>
      </section>

      <CtaBand />
    </>
  );
}
