import { Link } from "react-router-dom";

import { SITE } from "../marketingCopy";
import { Wordmark } from "./Wordmark";

interface FooterLink {
  label: string;
  to?: string;
  href?: string;
}

interface FooterColumn {
  heading: string;
  links: ReadonlyArray<FooterLink>;
}

const COLUMNS: ReadonlyArray<FooterColumn> = [
  {
    heading: "Product",
    links: [
      { label: "Features", to: "/#features" },
      { label: "How it works", to: "/about" },
      { label: "Pricing", to: "/pricing" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Privacy", to: "/privacy" },
      { label: "Terms", to: "/terms" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "GitHub", href: "https://github.com" },
      { label: "MIT licence", href: "https://opensource.org/licenses/MIT" },
    ],
  },
];

function FooterLinkItem({ link }: { link: FooterLink }) {
  const className =
    "rounded-sm text-fg-muted transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
  if (link.to) {
    return (
      <Link to={link.to} className={className}>
        {link.label}
      </Link>
    );
  }
  if (link.href) {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer noopener"
        className={`inline-flex items-center gap-1 ${className}`}
      >
        {link.label}
        <span aria-hidden className="text-fg-subtle">
          ↗
        </span>
      </a>
    );
  }
  return null;
}

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer
      className="border-t border-border/60 bg-surface-sunk/60 backdrop-blur"
      aria-labelledby="site-footer-heading"
    >
      <h2 id="site-footer-heading" className="sr-only">
        Site footer
      </h2>
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 md:py-16">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:gap-12">
          <div className="max-w-sm">
            <Wordmark className="text-fg" />
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">
              {SITE.footer}
            </p>
            <p className="mt-3 text-xs text-fg-subtle">
              Open source · MIT licensed · self-host or run locally
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav
              key={column.heading}
              aria-label={column.heading}
              className="text-sm"
            >
              <p className="font-medium uppercase tracking-[0.16em] text-[11px] text-fg-subtle">
                {column.heading}
              </p>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <FooterLinkItem link={link} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-border/60 pt-6 text-xs text-fg-subtle md:flex-row md:items-center md:justify-between">
          <p>
            © {year} {SITE.name}. The software is free; pay your providers
            for the inference.
          </p>
          <p className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-ok" />
            <span>Built with Anthropic Claude, Supabase, and care.</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
