import {
  useEffect,
  useRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";

import { useReducedMotion } from "../../../hooks/useReducedMotion";

interface RevealProps {
  as?: ElementType;
  delay?: number;
  className?: string;
  children: ReactNode;
}

/**
 * Wraps children in an element that fades + slides up the first time it
 * scrolls into view. Honours prefers-reduced-motion (skips the animation
 * entirely and shows content immediately) and tolerates SSR / no-IO
 * environments by falling back to "in" state.
 */
export function Reveal({
  as: Tag = "div",
  delay = 0,
  className,
  children,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduced) {
      node.dataset.reveal = "in";
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      node.dataset.reveal = "in";
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            node.dataset.reveal = "in";
            io.unobserve(node);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [reduced]);

  const style: CSSProperties | undefined = delay
    ? { transitionDelay: `${delay}ms` }
    : undefined;

  const Component = Tag as ElementType;
  return (
    <Component
      ref={ref}
      className={["marketing-reveal", className].filter(Boolean).join(" ")}
      style={style}
    >
      {children}
    </Component>
  );
}
