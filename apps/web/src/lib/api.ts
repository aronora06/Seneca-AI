/**
 * Frontend API client. Handles:
 *   - attaching the Supabase JWT (or dev-bypass token) to outgoing requests
 *   - JSON requests (GET / PUT / POST)
 *   - SSE streaming POSTs for /api/chat and /api/vision
 *
 * Browsers can't send a JSON body with `new EventSource()`, so we use
 * `fetch` + the ReadableStream reader for SSE on POSTs.
 */

import type { ChatRequest, ChatStreamEvent } from "@seneca/shared";
import { supabase } from "./supabase";
import { devBearer, devBypassAuth } from "./devBypass";

const BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:8787";

async function getToken(): Promise<string> {
  if (devBypassAuth) return devBearer;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

/**
 * Structured API error. Lets callers decide whether to auto-retry and
 * lets the system error bubble surface the status to the user.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /**
   * True for status codes that are usually transient: 0 (network), 408,
   * 425, 429, and 5xx.
   */
  get transient(): boolean {
    return isTransientStatus(this.status);
  }
}

export function isTransientStatus(status: number): boolean {
  if (status === 0) return true;
  if (status === 408 || status === 425 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

interface JsonOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Optional AbortSignal so callers can cancel an in-flight request. */
  signal?: AbortSignal;
}

export async function apiJson<T>(
  path: string,
  { method = "GET", body, signal }: JsonOptions = {},
): Promise<T> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    throw new ApiError(
      err instanceof Error ? err.message : "Network error",
      0,
    );
  }
  if (!res.ok) {
    const message = await safeMessage(res);
    throw new ApiError(`${res.status} ${message}`, res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface BinaryUploadOptions {
  method?: "POST" | "PUT";
  /** Content-Type to send. Defaults to application/octet-stream. */
  contentType?: string;
  /** Optional headers (X-File-Name, etc.). Authorization is added for you. */
  headers?: Record<string, string>;
  /** When the response is JSON, set this so the helper parses it for you. */
  parseJson?: boolean;
  signal?: AbortSignal;
}

/**
 * Send a raw byte body (Uint8Array / Blob / ArrayBuffer / Buffer-like) and
 * optionally parse a JSON response. Used for the PDF upload route, which
 * is `application/pdf` rather than `application/json`.
 */
export async function apiUploadBytes<T>(
  path: string,
  body: BodyInit,
  options: BinaryUploadOptions = {},
): Promise<T> {
  const {
    method = "POST",
    contentType = "application/octet-stream",
    headers = {},
    parseJson = true,
    signal,
  } = options;
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
        ...headers,
      },
      body,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    throw new ApiError(
      err instanceof Error ? err.message : "Network error",
      0,
    );
  }
  if (!res.ok) {
    const message = await safeMessage(res);
    throw new ApiError(`${res.status} ${message}`, res.status, message);
  }
  if (res.status === 204) return undefined as T;
  if (!parseJson) return undefined as T;
  return (await res.json()) as T;
}

/** GET binary bytes (e.g. a PDF file) and return them as a Uint8Array. */
export async function apiFetchBytes(
  path: string,
  options: { signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      signal: options.signal,
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    throw new ApiError(
      err instanceof Error ? err.message : "Network error",
      0,
    );
  }
  if (!res.ok) {
    const message = await safeMessage(res);
    throw new ApiError(`${res.status} ${message}`, res.status, message);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function safeMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string; message?: string };
    return j.error ?? j.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export interface StreamHandlers {
  onEvent: (e: ChatStreamEvent) => void;
  onError: (err: Error) => void;
  signal?: AbortSignal;
}

/**
 * Open an SSE POST stream against /api/chat or /api/vision and dispatch
 * typed events to the caller. Resolves when the stream closes cleanly,
 * rejects on transport error.
 */
export async function apiStream(
  path: "/api/chat" | "/api/vision",
  body: ChatRequest,
  handlers: StreamHandlers,
): Promise<void> {
  const token = await getToken();

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      signal: handlers.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? err.message : "Network error",
      0,
    );
  }

  if (!res.ok || !res.body) {
    const message = await safeMessage(res);
    throw new ApiError(`${res.status} ${message}`, res.status, message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (handlers.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        if (handlers.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        const chunk = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const event = parseSseChunk(chunk);
        if (event) handlers.onEvent(event);
      }
    }
  } catch (err) {
    handlers.onError(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}

function parseSseChunk(chunk: string): ChatStreamEvent | null {
  let dataLine: string | null = null;
  for (const line of chunk.split("\n")) {
    if (line.startsWith("data: ")) {
      dataLine = line.slice("data: ".length);
    }
  }
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine) as ChatStreamEvent;
  } catch (err) {
    console.warn("[seneca] dropped malformed SSE chunk", err, dataLine);
    return null;
  }
}
