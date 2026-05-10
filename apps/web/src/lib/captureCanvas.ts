/**
 * Snapshot pipeline: turn the active canvas tab into a base64 PNG, ≤1568×1568
 * per Anthropic's vision sweet spot (vision.md §8.3).
 *
 * Each tab registers a `Capturer` here so future tabs (map/doc/web) can plug
 * in without changing call sites.
 */

export interface CapturedImage {
  base64: string;
  width: number;
  height: number;
  mimeType: "image/png";
}

export type Capturer = () => Promise<Blob | null>;

const MAX_DIM = 1568;

const capturers = new Map<string, Capturer>();

export function registerCapturer(tabId: string, fn: Capturer): () => void {
  capturers.set(tabId, fn);
  return () => {
    if (capturers.get(tabId) === fn) capturers.delete(tabId);
  };
}

export async function captureActiveTab(
  tabId: string,
): Promise<CapturedImage | null> {
  const fn = capturers.get(tabId);
  if (!fn) return null;
  const blob = await fn();
  if (!blob) return null;
  return downscaleToPng(blob);
}

async function downscaleToPng(blob: Blob): Promise<CapturedImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_DIM);
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });

    const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext(
      "2d",
    );
    if (!ctx) throw new Error("Could not acquire 2D context");
    (ctx as CanvasRenderingContext2D).drawImage(bitmap, 0, 0, width, height);

    let outBlob: Blob;
    if (canvas instanceof OffscreenCanvas) {
      outBlob = await canvas.convertToBlob({ type: "image/png" });
    } else {
      outBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("toBlob returned null")),
          "image/png",
        ),
      );
    }
    const base64 = await blobToBase64(outBlob);
    return { base64, width, height, mimeType: "image/png" };
  } finally {
    bitmap.close?.();
  }
}

function fitWithin(
  w: number,
  h: number,
  max: number,
): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const r = w >= h ? max / w : max / h;
  return { width: Math.round(w * r), height: Math.round(h * r) };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // chunked to avoid argument-count limits on very large buffers
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}
