import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { devBypassAuth } from "../../../lib/devBypass";
import { ThemeToggle } from "../../../theme/ThemeToggle";
import { Wordmark } from "./Wordmark";

interface NavItem {
  label: string;
  to: string;
  /** Match exactly (use for hash-anchor links that share path with home). */
  exact?: boolean;
  /** Optional in-page anchor id; lets the header smooth-scroll on click. */
  anchor?: string;
}

const NAV_LINKS: ReadonlyArray<NavItem> = [
  { label: "Features", to: "/#features", anchor: "features" },
  { label: "Pricing", to: "/pricing" },
  { label: "About", to: "/about" },
];

/** Approximate sticky header height — kept in sync with `marketing-header`. */
const STICKY_HEADER_OFFSET = 72;

/**
 * Smooth-scroll the document to a given element id, respecting
 * prefers-reduced-motion. Uses window.scrollTo (instead of
 * scrollIntoView) so the sticky header doesn't cover the target.
 * Returns true if the element was found.
 */
function scrollToAnchor(anchorId: string): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return false;
  }
  const el = document.getElementById(anchorId);
  if (!el) return false;
  const reduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const top =
    el.getBoundingClientRect().top + window.scrollY - STICKY_HEADER_OFFSET;
  window.scrollTo({
    top: Math.max(top, 0),
    behavior: reduced ? "auto" : "smooth",
  });
  return true;
}

export function SiteHeader() {
  const showDevWorkspace = import.meta.env.DEV && devBypassAuth;
  const ctaTo = showDevWorkspace ? "/app" : "/login";
  const ctaLabel = showDevWorkspace ? "Open workspace" : "Sign in";

  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = (): void => {
      setScrolled(window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  // Close mobile menu when the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.hash]);

  /**
   * Click handler for in-page anchors. If we're already on the home page,
   * just scroll. Otherwise let react-router navigate; MarketingLayout's
   * scroll-on-hash effect will pick it up after render.
   */
  const handleAnchorClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    item: NavItem,
  ): void => {
    if (!item.anchor) return;
    if (location.pathname === "/") {
      e.preventDefault();
      if (scrollToAnchor(item.anchor)) {
        navigate(`/#${item.anchor}`, { replace: false });
      }
    }
  };

  const isActive = (item: NavItem): boolean => {
    if (item.anchor) return location.hash === `#${item.anchor}`;
    return location.pathname === item.to;
  };

  return (
    <header className="marketing-header" data-scrolled={scrolled}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link
          to="/"
          aria-label="Seneca — home"
          className="group inline-flex items-center gap-2.5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <Wordmark className="h-7 w-auto text-fg transition-opacity group-hover:opacity-80" />
        </Link>

        <nav
          className="hidden items-center gap-7 text-sm md:flex"
          aria-label="Site"
        >
          {NAV_LINKS.map((link) => {
            const active = isActive(link);
            const className = [
              "relative text-fg-muted transition-colors hover:text-fg focus:outline-none focus-visible:text-fg",
              "after:absolute after:left-0 after:right-0 after:-bottom-1 after:h-px after:bg-accent after:opacity-0 after:transition-opacity",
              active ? "text-fg after:opacity-70" : "",
            ].join(" ");

            if (link.anchor) {
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={(e) => handleAnchorClick(e, link)}
                  className={className}
                >
                  {link.label}
                </Link>
              );
            }

            return (
              <NavLink
                key={link.to}
                to={link.to}
                end
                className={({ isActive: rrActive }) =>
                  [
                    "relative text-fg-muted transition-colors hover:text-fg focus:outline-none focus-visible:text-fg",
                    "after:absolute after:left-0 after:right-0 after:-bottom-1 after:h-px after:bg-accent after:opacity-0 after:transition-opacity",
                    rrActive ? "text-fg after:opacity-70" : "",
                  ].join(" ")
                }
              >
                {link.label}
              </NavLink>
            );
          })}

          <span aria-hidden className="h-5 w-px bg-border" />

          <Link
            to={ctaTo}
            className="btn-primary px-4 py-2 text-sm shadow-soft dark:shadow-soft-dark"
          >
            {ctaLabel}
          </Link>
          <ThemeToggle />
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="marketing-mobile-nav"
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card/70 text-fg-muted transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <span className="sr-only">
              {mobileOpen ? "Close menu" : "Open menu"}
            </span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              aria-hidden
              focusable="false"
            >
              {mobileOpen ? (
                <path
                  d="M4 4l10 10M14 4L4 14"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              ) : (
                <>
                  <path d="M2.5 5h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M2.5 9h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M2.5 13h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div
          id="marketing-mobile-nav"
          className="marketing-mobile-nav md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <Link
              to="/"
              onClick={() => setMobileOpen(false)}
              aria-label="Seneca — home"
            >
              <Wordmark className="h-7 w-auto text-fg" />
            </Link>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card/70 text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
                <path
                  d="M4 4l10 10M14 4L4 14"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <nav
            aria-label="Site"
            className="flex flex-1 flex-col gap-1 px-5 py-6"
          >
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={(e) => {
                  if (link.anchor && location.pathname === "/") {
                    e.preventDefault();
                    setMobileOpen(false);
                    requestAnimationFrame(() => {
                      scrollToAnchor(link.anchor!);
                      navigate(`/#${link.anchor!}`, { replace: false });
                    });
                    return;
                  }
                  setMobileOpen(false);
                }}
                className="rounded-md px-3 py-3 font-serif text-2xl text-fg transition-colors hover:bg-surface-sunk"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-6 flex flex-col gap-3">
              <Link
                to={ctaTo}
                onClick={() => setMobileOpen(false)}
                className="btn-primary px-5 py-3 text-base"
              >
                {ctaLabel}
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
