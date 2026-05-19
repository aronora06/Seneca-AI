import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { SiteFooter } from "./components/SiteFooter";
import { SiteHeader } from "./components/SiteHeader";

import "./marketing.css";

/** Match `STICKY_HEADER_OFFSET` in SiteHeader so anchor jumps don't hide
 * targets behind the sticky header. */
const STICKY_HEADER_OFFSET = 72;

/**
 * Scrolls to `#anchor` whenever the location's hash changes (e.g.
 * navigating to `/#features` from another page) and to the top of the
 * page when the path changes without a hash. Uses window.scrollTo +
 * a header offset so anchors land just below the sticky header.
 * Honours prefers-reduced-motion.
 */
function ScrollManager() {
  const location = useLocation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = reduced ? "auto" : "smooth";

    if (location.hash) {
      const id = location.hash.replace(/^#/, "");
      const raf = requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (!el) return;
        const top =
          el.getBoundingClientRect().top +
          window.scrollY -
          STICKY_HEADER_OFFSET;
        window.scrollTo({ top: Math.max(top, 0), behavior });
      });
      return () => cancelAnimationFrame(raf);
    }

    window.scrollTo({ top: 0, behavior });
  }, [location.pathname, location.hash]);

  return null;
}

export function MarketingLayout() {
  return (
    <div className="marketing flex min-h-full flex-col">
      <ScrollManager />
      <SiteHeader />
      <main id="main" className="marketing-backdrop flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
