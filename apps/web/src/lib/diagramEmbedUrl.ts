/** Base URL for draw.io embed (override via VITE_DRAWIO_EMBED_URL). */
export function getDrawIoEmbedBaseUrl(): string {
  const raw = import.meta.env.VITE_DRAWIO_EMBED_URL as string | undefined;
  const base = raw?.trim() || "https://embed.diagrams.net";
  return base.replace(/\/$/, "");
}

export function getDrawIoEmbedOrigin(): string {
  try {
    return new URL(getDrawIoEmbedBaseUrl()).origin;
  } catch {
    return "https://embed.diagrams.net";
  }
}
