/**
 * Phase E — display surface for headless-rendered pages.
 *
 * Renders the server-supplied PNG screenshot with absolutely-
 * positioned, invisible buttons overlaid for each link's bbox.
 * Clicking a link button calls back into the WebTab's navigate
 * action so the back/forward stack stays consistent with the static
 * engine. We scale the bbox coordinates from the server-rendered
 * viewport to the actual display size so clicks land where the user
 * sees the link, regardless of window width.
 */

import { useEffect, useRef, useState } from "react";

import type { HeadlessLink } from "../../lib/webRender";

interface Props {
  screenshotBase64: string;
  links: HeadlessLink[];
  /** Server-side viewport the screenshot was rendered at. */
  viewport: { width: number; height: number };
  /** Called with the absolute href when the user clicks a link. */
  onLinkClick: (href: string) => void;
}

export function WebHeadlessView({
  screenshotBase64,
  links,
  viewport,
  onLinkClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const measure = () => {
      const img = imgRef.current;
      if (!img) return;
      // The screenshot is rendered with `max-width: 100%`, so the
      // actual display width is the natural width clamped by
      // the container. Pick whichever produces the right scale.
      const displayed = img.getBoundingClientRect().width;
      const natural = viewport.width;
      setScale(natural > 0 ? displayed / natural : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    const container = containerRef.current;
    if (container) ro.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [viewport.width]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-auto bg-white"
    >
      <div className="relative inline-block w-full">
        <img
          ref={imgRef}
          src={`data:image/png;base64,${screenshotBase64}`}
          alt="Live page screenshot"
          className="block w-full"
          draggable={false}
        />
        {links.map((link, i) => (
          <button
            type="button"
            key={`${link.href}-${i}`}
            onClick={() => onLinkClick(link.href)}
            title={`${link.text || link.href}`}
            aria-label={link.text ? `Open ${link.text}` : `Open ${link.href}`}
            className="absolute z-10 rounded-sm ring-0 ring-accent/0 transition-shadow hover:ring-2 hover:ring-accent/60 hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent"
            style={{
              left: `${link.bbox.x * scale}px`,
              top: `${link.bbox.y * scale}px`,
              width: `${link.bbox.width * scale}px`,
              height: `${link.bbox.height * scale}px`,
              background: "transparent",
              cursor: "pointer",
            }}
          />
        ))}
      </div>
    </div>
  );
}
