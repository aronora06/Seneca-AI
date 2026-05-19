/**
 * Opt-in TTS timeline logging for debugging voice sequencing.
 *
 * Enable in the browser console:
 *   localStorage.setItem('seneca:ttsDebug', '1')
 * then reload. Filter DevTools console by `[seneca:tts]`.
 */

/** Monotonic baseline — do not use `performance.timeOrigin` (wrong clock). */
const T0 =
  typeof performance !== "undefined" ? performance.now() : Date.now();

function enabled(): boolean {
  if (import.meta.env.VITE_TTS_DEBUG === "true") return true;
  try {
    return localStorage.getItem("seneca:ttsDebug") === "1";
  } catch {
    return false;
  }
}

/** Call from the console to turn logging on without rebuilding. */
export function enableTtsDebugLogging(): void {
  localStorage.setItem("seneca:ttsDebug", "1");
  console.info(
    "[seneca:tts] Debug logging enabled — reload, then filter console by `[seneca:tts]`.",
  );
}

let seq = 0;
/** Safety valve — prevents DevTools crashes if something logs in a tight loop. */
const LOG_CAP = 500;
let logCapWarned = false;

export function ttsLog(
  event: string,
  data?: Record<string, unknown>,
): void {
  if (!enabled()) return;
  if (seq >= LOG_CAP) {
    if (!logCapWarned) {
      logCapWarned = true;
      console.warn(
        `[seneca:tts] Log cap (${LOG_CAP}) reached — further events suppressed. Reload to reset.`,
      );
    }
    return;
  }
  const row = {
    seq: ++seq,
    ms: Math.round(performance.now() - T0),
    ...data,
  };
  console.debug(`[seneca:tts] ${event}`, row);
}

export function ttsLogReset(): void {
  seq = 0;
  logCapWarned = false;
}

/** Elapsed ms since module load (for tests). */
export function ttsLogElapsedMs(): number {
  return Math.round(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - T0,
  );
}

/** Console helper: log current TTS debug flag (does not inspect the hook). */
export function logTtsDebugHelp(): void {
  console.info(
    `[seneca:tts] Debug ${enabled() ? "ON" : "OFF"}. Run senecaEnableTtsDebug() then reload. Filter console by [seneca:tts].`,
  );
}
