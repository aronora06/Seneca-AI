/**
 * Themed markdown viewer used by the DocumentTab for non-PDF formats
 * (`.md`, `.txt`, `.docx`-converted, `.pptx`-extracted, `.html`).
 *
 * Renders the active page's text through `marked`, sanitises with
 * DOMPurify (so an inline `<script>` from a stray .html upload can't run
 * in our origin), and styles with Tailwind descendant selectors so we
 * don't need the `@tailwindcss/typography` plugin.
 */

import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import clsx from "clsx";

interface Props {
  text: string;
  className?: string;
}

export function MarkdownViewer({ text, className }: Props) {
  const html = useMemo(() => {
    const raw = marked.parse(text ?? "", { async: false }) as string;
    return DOMPurify.sanitize(raw, {
      FORBID_TAGS: ["script", "iframe", "object", "embed", "style", "form"],
      FORBID_ATTR: ["onerror", "onclick", "onload", "style"],
    });
  }, [text]);

  return (
    <article
      className={clsx(
        // Base body text
        "max-w-none break-words font-serif text-[15px] leading-relaxed text-fg",
        // Headings
        "[&_h1]:mb-4 [&_h1]:mt-6 [&_h1]:font-serif [&_h1]:text-2xl [&_h1]:font-semibold",
        "[&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-semibold",
        "[&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-serif [&_h3]:text-lg [&_h3]:font-semibold",
        "[&_h4]:mb-2 [&_h4]:mt-4 [&_h4]:font-serif [&_h4]:text-base [&_h4]:font-semibold",
        // Paragraphs
        "[&_p]:my-3",
        // Lists
        "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6",
        "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6",
        "[&_li]:my-1",
        // Inline formatting
        "[&_strong]:font-semibold",
        "[&_em]:italic",
        "[&_a]:text-accent [&_a]:underline-offset-2 hover:[&_a]:underline",
        // Code
        "[&_code]:rounded [&_code]:bg-surface-sunk [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
        "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-surface-sunk [&_pre]:p-3 [&_pre]:text-[0.85em]",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        // Quotes / rules / tables
        "[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-accent/40 [&_blockquote]:pl-4 [&_blockquote]:text-fg-muted",
        "[&_hr]:my-6 [&_hr]:border-border",
        "[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse",
        "[&_th]:border [&_th]:border-border [&_th]:bg-surface-sunk [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
