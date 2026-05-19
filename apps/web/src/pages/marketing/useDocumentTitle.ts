import { useEffect } from "react";

/**
 * Set document.title for the duration of a component's lifetime and
 * restore the previous title on unmount. Used by marketing pages so each
 * route has a meaningful tab title without shipping a router-meta library.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
