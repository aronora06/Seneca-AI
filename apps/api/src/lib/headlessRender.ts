/**
 * Phase E — headless Chromium renderer for the Web tab.
 *
 * Wraps `playwright-core` so dynamic / SPA-heavy pages can be
 * rendered server-side and returned to the client as a screenshot
 * + a list of clickable link bboxes + an extracted reader-mode text
 * body. The sanitised static path in `webProxy.ts` stays the
 * preferred resolver for low-cost reads; this module only kicks in
 * when the SPA heuristic flags the static result as a JS shell.
 *
 * Design constraints (vision §11.3 + roadmap Phase E):
 *
 *   - **Optional dependency**. We `await import("playwright-core")`
 *     at first use. If the package is missing or the bundled
 *     Chromium can't launch, `isHeadlessAvailable()` returns false
 *     and the route falls back to the static path. The app still
 *     boots with only ANTHROPIC_API_KEY set.
 *   - **SSRF guard**. Reuses `assertSafeUrl` so we never open a
 *     private / loopback / link-local address.
 *   - **Bounded resources**. One shared browser instance,
 *     concurrency capped at 2 contexts (per-process semaphore), 8s
 *     networkidle timeout, hard kill on 30s. Pages are closed in a
 *     finally — even on throw — so a wedged tab can't accumulate.
 *   - **Stable shape**. Returns the same `HeadlessRenderResult`
 *     whether playwright is real or stubbed by the test harness.
 */

import { assertSafeUrl } from "./webProxy.js";

const NAVIGATION_TIMEOUT_MS = 8_000;
const HARD_KILL_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_CONTEXTS = 2;
const VIEWPORT = { width: 1280, height: 800 } as const;

/** One clickable link rendered on the screenshot overlay. */
export interface HeadlessLink {
  /** Absolute href, normalised against the rendered page's URL. */
  href: string;
  /** Trimmed inner text — used as the alt + the tooltip on hover. */
  text: string;
  /** Bounding box in viewport-pixel coordinates. */
  bbox: { x: number; y: number; width: number; height: number };
}

export interface HeadlessRenderResult {
  /** PNG bytes of the viewport, base64-encoded (no data: prefix). */
  screenshot: string;
  /** Final URL after redirects. */
  finalUrl: string;
  /** `<title>` if present, or `null`. */
  title: string | null;
  /** Clickable links (anchors with a resolved href + non-empty bbox). */
  links: HeadlessLink[];
  /** Plain-text reader extract (densest text block, up to ~12 KB). */
  readerText: string;
  /** Viewport size in CSS pixels — needed for the click overlay maths. */
  viewport: { width: number; height: number };
}

/** Reasons a headless render can fail in a way the route should map to HTTP. */
export type HeadlessErrorCode =
  | "unavailable"
  | "navigation_failed"
  | "navigation_timeout"
  | "blocked_host"
  | "blocked_scheme"
  | "rendering_failed";

export class HeadlessRenderError extends Error {
  readonly code: HeadlessErrorCode;
  readonly httpStatus: number;
  constructor(code: HeadlessErrorCode, message: string, httpStatus: number) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.name = "HeadlessRenderError";
  }
}

// ── lazy playwright loader ─────────────────────────────────────────────────

interface PlaywrightBrowser {
  close(): Promise<void>;
  newContext(opts: unknown): Promise<PlaywrightContext>;
  isConnected(): boolean;
}
interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}
interface PlaywrightPage {
  goto(
    url: string,
    opts: { waitUntil: string; timeout: number },
  ): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  screenshot(opts: { type: string; fullPage: boolean }): Promise<Buffer>;
  evaluate<T>(fn: string): Promise<T>;
  close(): Promise<void>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
}
interface PlaywrightModule {
  chromium: {
    launch(opts: { headless: boolean }): Promise<PlaywrightBrowser>;
  };
}

let cachedModule: PlaywrightModule | null = null;
let moduleLoadAttempted = false;
let cachedBrowser: PlaywrightBrowser | null = null;
let cachedAvailabilityProbe: Promise<boolean> | null = null;

async function loadPlaywright(): Promise<PlaywrightModule | null> {
  if (cachedModule) return cachedModule;
  if (moduleLoadAttempted) return null;
  moduleLoadAttempted = true;
  try {
    // Dynamic import via a variable specifier so TypeScript doesn't
    // demand the optional package be installed at typecheck time, and
    // the bundle / build never errors when the dep is absent.
    const specifier = "playwright-core";
    const mod = (await import(specifier)) as unknown as
      | PlaywrightModule
      | { default: PlaywrightModule };
    cachedModule =
      "chromium" in (mod as PlaywrightModule)
        ? (mod as PlaywrightModule)
        : (mod as { default: PlaywrightModule }).default;
    return cachedModule;
  } catch (err) {
    console.warn(
      "[seneca] playwright-core not installed; headless rendering disabled",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function getBrowser(): Promise<PlaywrightBrowser | null> {
  if (cachedBrowser && cachedBrowser.isConnected()) return cachedBrowser;
  cachedBrowser = null;
  const playwright = await loadPlaywright();
  if (!playwright) return null;
  try {
    cachedBrowser = await playwright.chromium.launch({ headless: true });
    return cachedBrowser;
  } catch (err) {
    console.warn(
      "[seneca] failed to launch headless chromium; headless rendering disabled",
      err instanceof Error ? err.message : err,
    );
    cachedBrowser = null;
    return null;
  }
}

/**
 * Cheap one-time probe so `/api/web/render/config` can tell the
 * client whether the live engine is even available. We cache the
 * answer until process restart — relaunching Chromium on every
 * call would defeat the purpose of the probe.
 */
export async function isHeadlessAvailable(): Promise<boolean> {
  if (cachedAvailabilityProbe) return cachedAvailabilityProbe;
  cachedAvailabilityProbe = (async () => {
    const browser = await getBrowser();
    return browser !== null;
  })();
  return cachedAvailabilityProbe;
}

/** For tests: drop the cached browser between cases. */
export function __resetHeadlessForTests(): void {
  cachedModule = null;
  moduleLoadAttempted = false;
  cachedBrowser = null;
  cachedAvailabilityProbe = null;
}

// ── concurrency gate ───────────────────────────────────────────────────────

let activeContexts = 0;
const waitQueue: Array<() => void> = [];

async function acquireSlot(): Promise<() => void> {
  if (activeContexts < MAX_CONCURRENT_CONTEXTS) {
    activeContexts++;
    return releaseSlot;
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      activeContexts++;
      resolve(releaseSlot);
    });
  });
}

function releaseSlot(): void {
  activeContexts = Math.max(0, activeContexts - 1);
  const next = waitQueue.shift();
  if (next) next();
}

// ── core render ────────────────────────────────────────────────────────────

export async function renderPage(rawUrl: string): Promise<HeadlessRenderResult> {
  const parsed = await assertSafeUrl(rawUrl);
  const browser = await getBrowser();
  if (!browser) {
    throw new HeadlessRenderError(
      "unavailable",
      "Headless rendering is not available on this server.",
      503,
    );
  }
  const release = await acquireSlot();
  let context: PlaywrightContext | null = null;
  let page: PlaywrightPage | null = null;

  // Hard kill timer — if anything wedges, force a teardown after 30s.
  const killTimer = setTimeout(() => {
    void closeQuietly(page, context);
  }, HARD_KILL_TIMEOUT_MS);

  try {
    context = await browser.newContext({
      viewport: { ...VIEWPORT },
      userAgent: "Seneca/0.1 (+https://github.com/seneca-app) headless",
    });
    page = await context.newPage();
    await page.setViewportSize({ ...VIEWPORT });

    try {
      await page.goto(parsed.toString(), {
        waitUntil: "networkidle",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Timeout/i.test(message)) {
        throw new HeadlessRenderError(
          "navigation_timeout",
          "Page took longer than 8s to settle.",
          504,
        );
      }
      throw new HeadlessRenderError(
        "navigation_failed",
        message,
        502,
      );
    }

    const title = (await page.title().catch(() => "")) || null;
    const finalUrl = page.url();

    const screenshot = await page.screenshot({
      type: "png",
      fullPage: false,
    });

    const extracted = await page.evaluate<{
      links: HeadlessLink[];
      readerText: string;
    }>(PAGE_EXTRACTION_SCRIPT);

    return {
      screenshot: screenshot.toString("base64"),
      finalUrl,
      title,
      links: extracted.links,
      readerText: extracted.readerText,
      viewport: { ...VIEWPORT },
    };
  } finally {
    clearTimeout(killTimer);
    await closeQuietly(page, context);
    release();
  }
}

async function closeQuietly(
  page: PlaywrightPage | null,
  context: PlaywrightContext | null,
): Promise<void> {
  try {
    if (page) await page.close();
  } catch {
    // best-effort
  }
  try {
    if (context) await context.close();
  } catch {
    // best-effort
  }
}

// ── browser-side extraction (runs inside Chromium) ─────────────────────────

/**
 * Playwright serialises this function and runs it inside the page,
 * which means `document` / `window` / DOM classes are present at
 * runtime but unknown to the Node-only typechecker. We provide the
 * function as a string so we don't have to leak the DOM lib into
 * the API project's `tsconfig.lib`.
 *
 * The shape it returns must match the explicit interface used in
 * `renderPage`'s `evaluate` call.
 */
const PAGE_EXTRACTION_SCRIPT = `() => {
  const anchorBboxes = [];
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  for (const a of anchors) {
    const href = a.href;
    if (!href) continue;
    const rect = a.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) continue;
    if (
      rect.right < 0 ||
      rect.bottom < 0 ||
      rect.left > window.innerWidth ||
      rect.top > window.innerHeight
    ) {
      continue;
    }
    const text = (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
    anchorBboxes.push({
      href,
      text,
      bbox: {
        x: Math.max(0, Math.round(rect.left)),
        y: Math.max(0, Math.round(rect.top)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    });
    if (anchorBboxes.length >= 200) break;
  }

  const candidates = [];
  const queue = Array.from((document.body && document.body.children) || []);
  let scanned = 0;
  while (queue.length > 0 && scanned < 1000) {
    const node = queue.shift();
    if (!node) continue;
    scanned++;
    if (
      node.tagName === 'SCRIPT' ||
      node.tagName === 'STYLE' ||
      node.tagName === 'NOSCRIPT'
    ) {
      continue;
    }
    const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text.length > 200) {
      const tagCount = node.querySelectorAll('*').length || 1;
      const linkCount = node.querySelectorAll('a').length;
      const score = text.length / tagCount - linkCount * 20;
      candidates.push({ node, score });
    }
    for (const child of node.children) queue.push(child);
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const readerText = best
    ? (best.node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 12000)
    : '';

  return { links: anchorBboxes, readerText };
}`;

// ── SPA heuristic ──────────────────────────────────────────────────────────

/**
 * Decide whether the sanitised static fetch produced a JS shell
 * that really needs the live engine. Three signals:
 *   - Very little visible text (<150 chars after stripping).
 *   - The original raw HTML had a lot of <script> tags.
 *   - Telltale framework hooks: __next, data-reactroot, ng-app,
 *     hydration markers, etc.
 *
 * Exported for the routes layer and the tests; pure function, no
 * side effects.
 */
export interface SpaHeuristicInput {
  /** Original (un-sanitised) HTML the upstream sent us. */
  rawHtml: string;
  /** Plain-text extract of the sanitised body. */
  visibleText: string;
}

export function looksLikeSpaShell(input: SpaHeuristicInput): boolean {
  const text = input.visibleText.replace(/\s+/g, " ").trim();
  if (text.length >= 800) return false;
  const raw = input.rawHtml.toLowerCase();
  const scriptCount = (raw.match(/<script\b/g) ?? []).length;
  if (text.length < 150 && scriptCount >= 3) return true;
  // Framework hooks: presence is a strong signal regardless of text length.
  if (
    /\bid=["']__next["']/.test(raw) ||
    /\bdata-reactroot\b/.test(raw) ||
    /\bdata-react-helmet\b/.test(raw) ||
    /\bng-app\b/.test(raw) ||
    /\bdata-server-rendered=["']true/.test(raw) ||
    /\bdata-hk\b/.test(raw)
  ) {
    if (text.length < 400) return true;
  }
  // High script-to-text ratio.
  if (text.length > 0 && scriptCount > 10 && scriptCount * 50 > text.length) {
    return true;
  }
  return false;
}
