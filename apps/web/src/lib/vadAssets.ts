/**
 * VAD asset path resolver.
 *
 * @ricky0123/vad-web loads three kinds of files at runtime:
 *
 *   1. The AudioWorklet bundle (`vad.worklet.bundle.min.js`).
 *   2. The Silero ONNX model file (`silero_vad_legacy.onnx` or
 *      `silero_vad_v5.onnx`).
 *   3. The ONNX runtime WebAssembly binaries (from `onnxruntime-web`).
 *
 * By default the package fetches these from jsDelivr, which means:
 *
 *   - Zero configuration on first run; works the moment you toggle
 *     Conversation Mode on.
 *   - First-load network roundtrip (~5 MB cached after that).
 *   - Doesn't work behind a CSP that blocks jsdelivr, or in fully
 *     offline / air-gapped environments.
 *
 * For deployments that need to self-host (CSP-heavy, on-prem, offline),
 * set `VITE_VAD_BASE_PATH` and `VITE_VAD_ONNX_WASM_PATH` in your env
 * and copy the dist files into your `public/` directory. See
 * `docs/setup.md` for the exact recipe.
 *
 * Versions are pinned to the installed package versions in package.json
 * so we never drift between the runtime API and the asset format.
 */

const VAD_PKG_VERSION = "0.0.30";
const ONNX_PKG_VERSION = "1.26.0";

const DEFAULT_VAD_BASE = `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_PKG_VERSION}/dist/`;
const DEFAULT_ONNX_WASM_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_PKG_VERSION}/dist/`;

export interface VadAssetPaths {
  baseAssetPath: string;
  onnxWASMBasePath: string;
}

/**
 * Returns the asset paths MicVAD should use.
 *
 * Order of resolution:
 *   1. Build-time env overrides (`VITE_VAD_BASE_PATH` /
 *      `VITE_VAD_ONNX_WASM_PATH`) — strings must end with `/`.
 *   2. The pinned jsDelivr CDN defaults.
 */
export function getVadAssetPaths(): VadAssetPaths {
  const env = (import.meta as { env?: Record<string, string | undefined> })
    .env ?? {};
  const baseOverride = env.VITE_VAD_BASE_PATH;
  const wasmOverride = env.VITE_VAD_ONNX_WASM_PATH;

  return {
    baseAssetPath: ensureTrailingSlash(baseOverride) ?? DEFAULT_VAD_BASE,
    onnxWASMBasePath:
      ensureTrailingSlash(wasmOverride) ?? DEFAULT_ONNX_WASM_BASE,
  };
}

function ensureTrailingSlash(p: string | undefined): string | undefined {
  if (!p) return undefined;
  return p.endsWith("/") ? p : `${p}/`;
}
