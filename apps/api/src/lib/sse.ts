import type { Response } from "express";
import type { ChatStreamEvent } from "@seneca/shared";

/**
 * Tiny helper that prepares an Express response for Server-Sent Events
 * and gives us a `send` function that takes our strongly typed events.
 */
export function openSseStream(res: Response): {
  send: (event: ChatStreamEvent) => void;
  close: () => void;
} {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: ChatStreamEvent): void => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const close = (): void => {
    try {
      res.end();
    } catch {
      // already closed
    }
  };

  return { send, close };
}
