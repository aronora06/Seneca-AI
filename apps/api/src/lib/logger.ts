/**
 * Phase F — thin structured-logging shim.
 *
 * We deliberately don't pull in `pino` as a hard dependency to keep
 * the boot story small (only ANTHROPIC_API_KEY required). Instead
 * this module exposes a `LoggerLike` interface backed by a stdlib
 * JSON-line writer: it's enough for Railway / Fly's structured-log
 * pipelines to pick up. When the time comes to add full pino
 * (sinks, log levels per environment, redaction policies) it'll be
 * a one-file swap because every call site already goes through
 * this interface.
 *
 * Levels honour `LOG_LEVEL` (debug | info | warn | error, default
 * info). PII-shaped fields (`email`, `jwt`, anything containing the
 * word `token` / `password`) are redacted before the JSON serialise
 * so a copy-paste of a log line never leaks credentials.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACT_KEYS = /^(?:email|jwt|password|.*token.*|.*secret.*|authorization)$/i;

const envLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const minLevel: Level =
  envLevel === "debug" || envLevel === "warn" || envLevel === "error"
    ? (envLevel as Level)
    : "info";

interface LogMeta {
  [key: string]: unknown;
}

export interface LoggerLike {
  debug(meta: LogMeta, msg?: string): void;
  info(meta: LogMeta, msg?: string): void;
  warn(meta: LogMeta, msg?: string): void;
  error(meta: LogMeta | Error, msg?: string): void;
  /** Returns a child logger with additional default fields. */
  child(meta: LogMeta): LoggerLike;
}

function shouldEmit(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limited]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (REDACT_KEYS.test(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

function emit(level: Level, baseMeta: LogMeta, meta: LogMeta, msg?: string) {
  if (!shouldEmit(level)) return;
  const line = {
    time: new Date().toISOString(),
    level,
    msg: msg ?? "",
    ...(redact(baseMeta) as LogMeta),
    ...(redact(meta) as LogMeta),
  };
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  try {
    stream.write(JSON.stringify(line) + "\n");
  } catch {
    // best-effort
  }
}

function buildLogger(baseMeta: LogMeta = {}): LoggerLike {
  return {
    debug(meta, msg) {
      emit("debug", baseMeta, meta, msg);
    },
    info(meta, msg) {
      emit("info", baseMeta, meta, msg);
    },
    warn(meta, msg) {
      emit("warn", baseMeta, meta, msg);
    },
    error(metaOrError, msg) {
      if (metaOrError instanceof Error) {
        emit(
          "error",
          baseMeta,
          {
            err: {
              name: metaOrError.name,
              message: metaOrError.message,
              stack: metaOrError.stack,
            },
          },
          msg ?? metaOrError.message,
        );
        return;
      }
      emit("error", baseMeta, metaOrError, msg);
    },
    child(meta) {
      return buildLogger({ ...baseMeta, ...meta });
    },
  };
}

export const logger: LoggerLike = buildLogger();

/** Test helper — surface the redact function so the unit tests can pin it. */
export const _internals = {
  redact: (value: unknown) => redact(value),
};
