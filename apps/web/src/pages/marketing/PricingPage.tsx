import { Link } from "react-router-dom";

import { devBypassAuth } from "../../lib/devBypass";
import { CtaBand } from "./components/CtaBand";
import { Reveal } from "./components/Reveal";
import { HERO, PRICING, PRICING_COSTS, PRICING_FAQ, PRICING_PLANS } from "./marketingCopy";
import { useDocumentTitle } from "./useDocumentTitle";

export function PricingPage() {
  useDocumentTitle("Pricing — Seneca");

  const showDevWorkspace = import.meta.env.DEV && devBypassAuth;
  const ctaTo = showDevWorkspace ? "/app" : "/login";
  const ctaLabel = showDevWorkspace
    ? HERO.primaryCtaBypass
    : HERO.primaryCta;

  return (
    <>
      <section
        className="relative overflow-hidden"
        aria-labelledby="pricing-heading"
      >
        <div className="marketing-hero-wash" aria-hidden />
        <div className="mx-auto max-w-3xl px-5 pb-12 pt-12 text-center sm:px-8 md:pb-16 md:pt-20">
          <Reveal>
            <span className="marketing-rule">{PRICING.eyebrow}</span>
          </Reveal>
          <Reveal delay={60}>
            <h1
              id="pricing-heading"
              className="mt-6 font-serif text-4xl leading-tight text-fg sm:text-5xl md:text-[3.5rem]"
            >
              {PRICING.headline}
            </h1>
          </Reveal>
          <Reveal delay={120}>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-fg-muted">
              {PRICING.subhead}
            </p>
          </Reveal>
        </div>
      </section>

      <section
        className="mx-auto max-w-6xl px-5 pb-16 sm:px-8 md:pb-24"
        aria-labelledby="pricing-plans-heading"
      >
        <h2 id="pricing-plans-heading" className="sr-only">
          Plans
        </h2>
        <div className="grid gap-5 md:grid-cols-3">
          {PRICING_PLANS.map((plan, index) => (
            <Reveal
              key={plan.id}
              delay={index * 70}
              as="article"
              className={[
                "relative flex h-full flex-col rounded-2xl border bg-card/85 p-7 shadow-soft backdrop-blur dark:shadow-soft-dark md:p-8",
                plan.featured
                  ? "border-accent/60 ring-1 ring-accent/40"
                  : "border-border",
              ].join(" ")}
            >
              {plan.featured && (
                <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center rounded-full border border-accent/40 bg-accent/15 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
                  Recommended
                </span>
              )}

              <header>
                <p className="font-serif text-2xl text-fg">{plan.name}</p>
                <p className="mt-3 flex items-baseline gap-2">
                  <span className="font-serif text-4xl text-fg">
                    {plan.price}
                  </span>
                  <span className="text-sm text-fg-subtle">
                    {plan.priceNote}
                  </span>
                </p>
                <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                  {plan.summary}
                </p>
              </header>

              <ul className="mt-6 space-y-2.5 text-sm">
                {plan.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden
                      className="mt-0.5 shrink-0 text-accent"
                    >
                      <path
                        d="M3 8.5l3 3 7-7"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="text-fg-muted">{b}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-7 pt-7">
                {plan.ctaExternal ? (
                  <a
                    href={plan.ctaHref}
                    target={
                      plan.ctaHref.startsWith("http") ? "_blank" : undefined
                    }
                    rel={
                      plan.ctaHref.startsWith("http")
                        ? "noreferrer noopener"
                        : undefined
                    }
                    className={
                      plan.featured
                        ? "btn-primary w-full px-5 py-2.5"
                        : "btn-soft w-full px-5 py-2.5"
                    }
                  >
                    {plan.ctaLabel}
                    <span aria-hidden className="ml-1">
                      →
                    </span>
                  </a>
                ) : (
                  <Link
                    to={plan.ctaHref}
                    className={
                      plan.featured
                        ? "btn-primary w-full px-5 py-2.5"
                        : "btn-soft w-full px-5 py-2.5"
                    }
                  >
                    {plan.ctaLabel}
                    <span aria-hidden className="ml-1">
                      →
                    </span>
                  </Link>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section
        className="border-y border-border/60 bg-surface-sunk/50"
        aria-labelledby="pricing-costs-heading"
      >
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 md:py-20">
          <Reveal className="max-w-2xl">
            <span className="marketing-rule">Where the money goes</span>
            <h2
              id="pricing-costs-heading"
              className="mt-5 font-serif text-3xl text-fg sm:text-4xl"
            >
              The actual line items.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-fg-muted">
              Two services are required, three are optional. Every cost is
              billed by the provider directly to your account — Seneca itself
              never charges you.
            </p>
          </Reveal>

          <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-card/85">
            <ul className="divide-y divide-border/80">
              {PRICING_COSTS.map((cost) => (
                <li
                  key={cost.id}
                  className="grid items-start gap-3 px-5 py-5 sm:grid-cols-[8rem_1fr_auto] sm:items-center sm:gap-6 sm:px-7"
                >
                  <div>
                    <span
                      className={[
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em]",
                        cost.role === "Required"
                          ? "bg-accent/15 text-accent"
                          : "bg-surface-sunk text-fg-subtle",
                      ].join(" ")}
                    >
                      {cost.role}
                    </span>
                  </div>
                  <div>
                    <p className="font-serif text-lg text-fg">
                      <a
                        href={cost.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline-offset-4 hover:underline focus:outline-none focus-visible:underline"
                      >
                        {cost.name}
                      </a>
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-fg-muted">
                      {cost.summary}
                    </p>
                  </div>
                  <p className="font-serif text-base text-fg sm:text-right">
                    {cost.estimate}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section
        className="mx-auto max-w-3xl px-5 py-20 sm:px-8 md:py-28"
        aria-labelledby="pricing-faq-heading"
      >
        <Reveal>
          <span className="marketing-rule">Common questions</span>
          <h2
            id="pricing-faq-heading"
            className="mt-5 font-serif text-3xl text-fg sm:text-4xl"
          >
            Three things people ask.
          </h2>
        </Reveal>

        <dl className="mt-10 space-y-px overflow-hidden rounded-2xl border border-border bg-border/80">
          {PRICING_FAQ.map((item, index) => (
            <Reveal
              key={item.q}
              delay={index * 70}
              className="bg-card/85 p-6 md:p-7"
            >
              <dt className="font-serif text-lg text-fg">{item.q}</dt>
              <dd className="mt-2 text-base leading-relaxed text-fg-muted">
                {item.a}
              </dd>
            </Reveal>
          ))}
        </dl>

        <Reveal className="mt-10 text-center">
          <p className="text-sm text-fg-subtle">
            Want the full setup guide?{" "}
            <Link
              to="/about"
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              See how Seneca works
            </Link>{" "}
            or{" "}
            <Link
              to={ctaTo}
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              {ctaLabel.toLowerCase()}
            </Link>
            .
          </p>
        </Reveal>
      </section>

      <CtaBand />
    </>
  );
}
