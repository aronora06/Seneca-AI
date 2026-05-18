/**
 * Sanitised HTML fetch proxy for the web tab.
 *
 * Design constraints (vision §8.6, §11.3):
 *   - Allow http(s) only.
 *   - Refuse private / loopback / link-local hosts (SSRF guard).
 *   - Cap body size and request time so a slow / huge upstream can't
 *     wedge the API.
 *   - Strip every script and event handler before returning to the
 *     client. Keep inline styles for visual fidelity.
 *   - Rewrite relative URLs to absolute and force every <a> to open
 *     in a new browser tab (no in-iframe navigation).
 *
 * Returns a typed `WebProxyError` on failure so the route can map it
 * to a clean HTTP status code.
 */

import { Buffer } from "node:buffer";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";

import sanitizeHtml from "sanitize-html";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const USER_AGENT = "Seneca/0.1 (+https://github.com/seneca-app)";

export interface FetchedPage {
  html: string;
  /** Final URL after redirects. */
  finalUrl: string;
  /** Page <title>, if we could find one. */
  title: string | null;
  /** HTTP status code from upstream. */
  status: number;
}

export type WebProxyErrorCode =
  | "invalid_url"
  | "blocked_scheme"
  | "blocked_host"
  | "dns_failed"
  | "upstream_failed"
  | "non_html"
  | "too_large"
  | "timeout";

export class WebProxyError extends Error {
  readonly code: WebProxyErrorCode;
  readonly httpStatus: number;
  constructor(code: WebProxyErrorCode, message: string, httpStatus: number) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.name = "WebProxyError";
  }
}

/**
 * Phase E — exported so the headless renderer can reuse the same
 * SSRF + scheme guard before opening a page in Chromium. Kept
 * separate from `fetchAndSanitise` so callers that aren't doing a
 * fetch (and so can't use the proxy's response shape) can still
 * trust the URL is safe to follow.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  const parsed = parseUrl(rawUrl);
  await assertHostIsPublic(parsed.hostname);
  return parsed;
}

export async function fetchAndSanitise(rawUrl: string): Promise<FetchedPage> {
  const parsed = parseUrl(rawUrl);
  await assertHostIsPublic(parsed.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "en;q=0.9",
      },
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new WebProxyError("timeout", "Upstream took too long.", 504);
    }
    throw new WebProxyError(
      "upstream_failed",
      err instanceof Error ? err.message : String(err),
      502,
    );
  } finally {
    clearTimeout(timer);
  }

  const finalUrl = response.url || parsed.toString();
  const contentType = response.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new WebProxyError(
      "non_html",
      `Upstream returned ${contentType || "no content-type"}.`,
      415,
    );
  }

  // Reject up front if the server tells us the body is too large.
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength && declaredLength > MAX_BYTES) {
    throw new WebProxyError(
      "too_large",
      `Page is ${Math.round(declaredLength / 1024)} KB; cap is ${MAX_BYTES / 1024} KB.`,
      413,
    );
  }

  const rawHtml = await readBodyCapped(response, MAX_BYTES);

  // Re-check the host of the FINAL URL — a redirect could land us on a
  // private IP after the initial resolve looked OK.
  const finalParsed = parseUrl(finalUrl);
  if (finalParsed.hostname !== parsed.hostname) {
    await assertHostIsPublic(finalParsed.hostname);
  }

  const sanitised = sanitiseHtml(rawHtml, finalUrl);
  const title = extractTitle(rawHtml);

  return {
    html: sanitised,
    finalUrl,
    title,
    status: response.status,
  };
}

// ── url parsing ────────────────────────────────────────────────────────────

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebProxyError("invalid_url", `Could not parse URL: ${raw}`, 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebProxyError(
      "blocked_scheme",
      `Only http(s) is allowed; got ${url.protocol}`,
      400,
    );
  }
  return url;
}

// ── ssrf guard ─────────────────────────────────────────────────────────────

/**
 * Resolve the hostname and refuse to fetch if any resolved address is
 * private, loopback, or link-local. There is a small TOCTOU window (the
 * IP could change between this lookup and the real fetch); for MVP that
 * is acceptable. A complete fix would use a custom http agent that
 * validates each socket as it connects.
 */
async function assertHostIsPublic(hostname: string): Promise<void> {
  if (!hostname) {
    throw new WebProxyError("blocked_host", "Empty host.", 400);
  }

  // If hostname is a literal IP, use it directly.
  const ipKind = isIP(hostname);
  const candidates: Array<{ address: string; family: number }> =
    ipKind === 0 ? [] : [{ address: hostname, family: ipKind }];

  if (ipKind === 0) {
    try {
      const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
      candidates.push(...resolved);
    } catch {
      throw new WebProxyError(
        "dns_failed",
        `Could not resolve host: ${hostname}`,
        502,
      );
    }
  }

  for (const c of candidates) {
    if (isPrivateAddress(c.address)) {
      throw new WebProxyError(
        "blocked_host",
        `Refusing to fetch a private / loopback address (${c.address}).`,
        400,
      );
    }
  }
}

/** True if the address is a private, loopback, link-local, or unspecified IP. */
function isPrivateAddress(addr: string): boolean {
  const kind = isIP(addr);
  if (kind === 4) return isPrivateIPv4(addr);
  if (kind === 6) return isPrivateIPv6(addr);
  return false;
}

function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 (this network)
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  // fc00::/7 covers fc00:..fdff:..
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1 — strip the prefix and re-check.
  const mapped = lower.match(/^::ffff:([\d.]+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  return false;
}

// ── body reader ────────────────────────────────────────────────────────────

async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new WebProxyError(
        "too_large",
        `Page exceeded ${maxBytes / 1024} KB.`,
        413,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ── sanitisation ───────────────────────────────────────────────────────────

const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

function sanitiseHtml(html: string, baseUrl: string): string {
  const cleaned = sanitizeHtml(html, {
    // Strip <html>, <head>, <body>, leaving inner content (sanitize-html's
    // default). We re-wrap below so srcdoc gets a complete document.
    allowedTags: [
      "a",
      "abbr",
      "address",
      "article",
      "aside",
      "b",
      "blockquote",
      "br",
      "caption",
      "cite",
      "code",
      "col",
      "colgroup",
      "dd",
      "details",
      "div",
      "dl",
      "dt",
      "em",
      "figcaption",
      "figure",
      "footer",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "header",
      "hr",
      "i",
      "img",
      "kbd",
      "li",
      "main",
      "mark",
      "nav",
      "ol",
      "p",
      "pre",
      "q",
      "s",
      "section",
      "small",
      "span",
      "strong",
      "sub",
      "summary",
      "sup",
      "table",
      "tbody",
      "td",
      "tfoot",
      "th",
      "thead",
      "time",
      "tr",
      "u",
      "ul",
      "wbr",
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "rel", "title"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      "*": ["id", "class", "style"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
      table: ["summary"],
      ol: ["start", "type"],
      ul: ["type"],
      time: ["datetime"],
    },
    // Inline style is allowed for visual fidelity. Sanitize-html runs the
    // values through its own URL/CSS sanitizer.
    allowedStyles: {
      "*": {
        color: [/^.*$/],
        "background-color": [/^.*$/],
        "text-align": [/^left$|^right$|^center$|^justify$/],
        "font-weight": [/^.*$/],
        "font-style": [/^.*$/],
        "font-size": [/^.*$/],
        "text-decoration": [/^.*$/],
        margin: [/^.*$/],
        padding: [/^.*$/],
        border: [/^.*$/],
        width: [/^.*$/],
        "max-width": [/^.*$/],
      },
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    transformTags: {
      a: (tagName, attribs) => {
        const href = absoluteUrl(attribs.href, baseUrl);
        const safe = href ? isSafeLinkScheme(href) : false;
        const next: Record<string, string> = {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        };
        if (safe && href) next.href = href;
        else delete next.href;
        return { tagName, attribs: next };
      },
      img: (tagName, attribs) => {
        const src = absoluteUrl(attribs.src, baseUrl);
        return {
          tagName,
          attribs: {
            ...attribs,
            src: src ?? "",
            loading: "lazy",
            // crossorigin lets the canvas snapshot pull bytes when the
            // host serves a permissive ACAO header.
            crossorigin: "anonymous",
          },
        };
      },
    },
  });

  // Wrap in a complete document so the iframe's srcdoc renders properly.
  // The <base> here resolves any leftover relative URLs and makes any
  // anchor-sans-target inherit `_blank` (defence in depth).
  return [
    "<!doctype html>",
    "<html><head>",
    `<meta charset="utf-8">`,
    `<base href="${escapeAttr(baseUrl)}" target="_blank">`,
    `<style>html,body{margin:0;padding:1rem;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.45;color:#1a1714;background:#ffffff;}img,video{max-width:100%;height:auto;}a{color:#7a4f17;}</style>`,
    "</head><body>",
    cleaned,
    "</body></html>",
  ].join("");
}

function absoluteUrl(raw: string | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

function isSafeLinkScheme(href: string): boolean {
  try {
    const u = new URL(href);
    return SAFE_LINK_SCHEMES.has(u.protocol);
  } catch {
    return false;
  }
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Pure helpers exposed for unit tests. The SSRF guard is security-critical;
 * exporting the predicates lets us assert behaviour on every entry of the
 * IPv4/IPv6 blocklist without spinning up a fake DNS server.
 */
export const _internals = {
  isPrivateAddress,
  isPrivateIPv4,
  isPrivateIPv6,
  parseUrl,
};

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const text = m[1]!.replace(/\s+/g, " ").trim();
  return text || null;
}

/**
 * Strip every tag and decode the common HTML entities to get a flat text
 * representation suitable for feeding to a language model.
 *
 * The input is expected to be the *sanitised* HTML produced by
 * `sanitiseHtml` above (so scripts / styles / event handlers are already
 * gone). For arbitrary upstream HTML this would need to be more careful,
 * but the only caller is the agent-loop's web_read_page resolver, which
 * always passes through the proxy first.
 */
export function extractTextFromHtml(
  html: string,
  maxChars = 12_000,
): { text: string; truncated: boolean } {
  const stripped = html
    // Drop anything inside <style> / <script> / <noscript> just in case.
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    // Convert breaks and block-level closes to spaces so words don't fuse.
    .replace(/<\s*\/?(br|p|div|li|tr|h[1-6]|section|article|header|footer|nav|aside)[^>]*>/gi, " ")
    // Strip every remaining tag.
    .replace(/<[^>]+>/g, "")
    // Decode the entities sanitize-html may have left behind.
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => {
      const code = Number(d);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    // Collapse all whitespace runs to a single space.
    .replace(/\s+/g, " ")
    .trim();

  if (stripped.length <= maxChars) {
    return { text: stripped, truncated: false };
  }
  return { text: stripped.slice(0, maxChars), truncated: true };
}
