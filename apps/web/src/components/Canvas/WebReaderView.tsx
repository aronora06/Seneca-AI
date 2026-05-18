/**
 * Phase E — text-only "Reader" view for the Web tab.
 *
 * Renders the reader-extract that the headless engine returns
 * (densest text block of the live page) as a comfortable reading
 * surface. Falls back to the sanitised static HTML's text content
 * when only the static engine ran — same `extractTextFromHtml`
 * heuristic the server's `web_read_page` resolver uses.
 *
 * Keeps everything in normal flow so the user can scroll naturally
 * and copy text out. No iframe — no scripts can run here.
 */

interface Props {
  text: string;
  title: string | null;
  url: string | null;
}

export function WebReaderView({ text, title, url }: Props) {
  const cleanText = text.trim();
  return (
    <div className="absolute inset-0 overflow-y-auto bg-card">
      <article className="mx-auto max-w-prose px-6 py-8 font-serif text-fg">
        {title && (
          <h1 className="mb-1 font-serif text-2xl text-fg">{title}</h1>
        )}
        {url && (
          <p className="mb-6 text-[12px] text-fg-subtle">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-fg-subtle/40 hover:text-fg"
            >
              {url}
            </a>
          </p>
        )}
        {cleanText.length === 0 ? (
          <p className="italic text-fg-subtle">
            No reader-mode text could be extracted from this page.
          </p>
        ) : (
          cleanText
            .split(/\n{2,}/)
            .filter((p) => p.trim().length > 0)
            .map((paragraph, i) => (
              <p
                key={i}
                className="mb-4 text-[15px] leading-relaxed text-fg"
              >
                {paragraph.trim()}
              </p>
            ))
        )}
      </article>
    </div>
  );
}
