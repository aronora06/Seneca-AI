/**
 * Server-side rasterisation of a single PDF page to a PNG buffer.
 *
 * Used as a fallback inside `document_read_page` when text extraction
 * comes up empty (scanned PDFs, image-only government forms, etc.).
 * Instead of asking the user to enable vision capture, the agent loop
 * quietly rasterises the requested page on the server and feeds it back
 * to Seneca as a multimodal `tool_result` image. He reads it visually
 * in the same iteration without the user ever flipping a switch.
 *
 * Implementation notes:
 *   - We use `@napi-rs/canvas` because it ships precompiled binaries
 *     for every platform we deploy on (macOS dev, Linux on Railway,
 *     Vercel functions if we ever move there) — no Cairo headers needed
 *     unlike traditional node-canvas.
 *   - pdfjs-dist v5 expects a small canvas factory at parse time. We
 *     provide one backed by `@napi-rs/canvas`'s `createCanvas`.
 *   - We also polyfill `DOMMatrix`, `ImageData`, `Path2D`, and `Image`
 *     on globalThis once — pdfjs uses these unprefixed and would
 *     otherwise throw `ReferenceError` deep inside its render path.
 *   - We cap the render scale so a 200-page PDF with letter-size pages
 *     can't blow up to a 6k × 8k canvas. 2.0 scale at 612×792 yields a
 *     1224×1584 PNG which is plenty for vision while staying inexpensive.
 */

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import {
  createCanvas,
  DOMMatrix,
  Image,
  ImageData,
  Path2D,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";

const requireFromHere = createRequire(import.meta.url);

// ── one-time globalThis shims ──────────────────────────────────────────────
//
// pdfjs-dist references these as bare identifiers. Setting them on
// globalThis exactly once at module load is the simplest reliable
// pattern; the legacy build picks them up via `globalThis.DOMMatrix`,
// `globalThis.Path2D`, etc.

declare global {
  // We're augmenting globalThis at runtime; the type assertions below let
  // TypeScript accept the assignments without us re-typing the whole
  // canvas surface.
  // eslint-disable-next-line no-var
  var DOMMatrix: typeof import("@napi-rs/canvas").DOMMatrix;
}

const g = globalThis as unknown as Record<string, unknown>;
if (!g.DOMMatrix) g.DOMMatrix = DOMMatrix;
if (!g.Path2D) g.Path2D = Path2D;
if (!g.ImageData) g.ImageData = ImageData;
if (!g.Image) g.Image = Image;

// ── pdfjs-dist lazy loader ─────────────────────────────────────────────────

interface PdfJsLib {
  getDocument(params: PdfGetDocumentParams): { promise: Promise<PdfDocument> };
  VerbosityLevel: { ERRORS: number; WARNINGS: number; INFOS: number };
}

interface PdfGetDocumentParams {
  data: Uint8Array;
  verbosity?: number;
  isEvalSupported?: boolean;
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
  canvasFactory?: NodeCanvasFactory;
}

interface PdfDocument {
  numPages: number;
  canvasFactory: NodeCanvasFactory;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfPage {
  getViewport(opts: { scale: number }): PdfViewport;
  render(opts: {
    canvasContext: SKRSContext2D;
    viewport: PdfViewport;
    canvasFactory?: NodeCanvasFactory;
  }): { promise: Promise<void> };
  cleanup(): void;
}

interface PdfViewport {
  width: number;
  height: number;
}

let cachedLib: PdfJsLib | null = null;
async function getPdfJs(): Promise<PdfJsLib> {
  if (cachedLib) return cachedLib;
  cachedLib = requireFromHere(
    "pdfjs-dist/legacy/build/pdf.mjs",
  ) as PdfJsLib;
  return cachedLib;
}

/** Paths to pdfjs's bundled font + cmap assets so non-Latin and embedded PDFs render correctly. */
function pdfjsAssetPaths(): { cMapUrl: string; standardFontDataUrl: string } {
  // Resolve via the actual pdfjs-dist package root so the paths work
  // both in dev (running .ts via tsx) and in the compiled dist/ build.
  const pkgRoot = dirname(
    requireFromHere.resolve("pdfjs-dist/package.json"),
  );
  return {
    // The trailing slash matters — pdfjs joins the URL with a filename.
    cMapUrl: resolve(pkgRoot, "cmaps") + "/",
    standardFontDataUrl: resolve(pkgRoot, "standard_fonts") + "/",
  };
}

// ── canvas factory ─────────────────────────────────────────────────────────

interface CanvasAndContext {
  canvas: Canvas | null;
  context: SKRSContext2D | null;
}

/**
 * pdfjs hands this to its renderer at `getDocument` time. The renderer
 * calls `create` to mint a canvas, `reset` when reusing one, and
 * `destroy` to release the backing store.
 */
class NodeCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid canvas size ${width}×${height}.`);
    }
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    const context = canvas.getContext("2d");
    return { canvas, context };
  }
  reset(cac: CanvasAndContext, width: number, height: number): void {
    if (!cac.canvas) throw new Error("Canvas was already destroyed.");
    cac.canvas.width = Math.ceil(width);
    cac.canvas.height = Math.ceil(height);
  }
  destroy(cac: CanvasAndContext): void {
    if (cac.canvas) {
      // Zeroing dimensions frees the backing pixel buffer.
      cac.canvas.width = 0;
      cac.canvas.height = 0;
    }
    cac.canvas = null;
    cac.context = null;
  }
}

// ── public API ─────────────────────────────────────────────────────────────

export interface RenderedPage {
  png: Buffer;
  width: number;
  height: number;
}

/** Cap on the longest edge of the rasterised page to keep PNG size sensible. */
const MAX_LONG_EDGE_PX = 2400;
/** Lower bound so a postage-stamp page is still readable. */
const MIN_LONG_EDGE_PX = 1200;

/**
 * Render a single PDF page to a PNG buffer. `pageNumber` is 1-indexed.
 * Throws if pdfjs can't open the document or the page index is out of
 * range; the caller surfaces the error in the tool_result so Seneca can
 * apologise rather than the whole turn 500ing.
 */
export async function renderPdfPageToPng(
  bytes: Buffer,
  pageNumber: number,
): Promise<RenderedPage> {
  const pdfjs = await getPdfJs();
  const factory = new NodeCanvasFactory();
  const assets = pdfjsAssetPaths();

  const loadingTask = pdfjs.getDocument({
    // Independent copy — pdfjs detaches the data ArrayBuffer it gets,
    // and the caller (or its in-memory documentStore) is holding the
    // original Buffer by reference. See the same note in
    // pdfTextExtractor.ts for the war story.
    data: new Uint8Array(bytes),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    isEvalSupported: false,
    cMapUrl: assets.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: assets.standardFontDataUrl,
    canvasFactory: factory,
  });

  const pdf = await loadingTask.promise;

  try {
    if (pageNumber < 1 || pageNumber > pdf.numPages) {
      throw new Error(
        `Page ${pageNumber} is out of range (1..${pdf.numPages}).`,
      );
    }
    const page = await pdf.getPage(pageNumber);
    try {
      // Probe the natural size, pick a scale that lands inside our
      // [MIN, MAX]_LONG_EDGE_PX band. Typical letter-size at scale 1
      // is 612×792; at scale 2 we get 1224×1584 which is comfy.
      const natural = page.getViewport({ scale: 1 });
      const naturalLong = Math.max(natural.width, natural.height);
      let scale = 2;
      if (naturalLong * scale > MAX_LONG_EDGE_PX) {
        scale = MAX_LONG_EDGE_PX / naturalLong;
      } else if (naturalLong * scale < MIN_LONG_EDGE_PX) {
        scale = Math.min(4, MIN_LONG_EDGE_PX / naturalLong);
      }
      const viewport = page.getViewport({ scale });

      const cac = factory.create(viewport.width, viewport.height);
      if (!cac.canvas || !cac.context) {
        throw new Error("Failed to create canvas for PDF render.");
      }
      try {
        // Fill white so transparent PDFs don't render as black-on-black
        // when viewed in dark mode. Some PDFs assume a white paper.
        cac.context.fillStyle = "#ffffff";
        cac.context.fillRect(0, 0, viewport.width, viewport.height);

        await page.render({
          canvasContext: cac.context,
          viewport,
          canvasFactory: factory,
        }).promise;

        const png = cac.canvas.toBuffer("image/png");
        return {
          png,
          width: cac.canvas.width,
          height: cac.canvas.height,
        };
      } finally {
        factory.destroy(cac);
      }
    } finally {
      page.cleanup();
    }
  } finally {
    await pdf.destroy().catch(() => undefined);
  }
}
