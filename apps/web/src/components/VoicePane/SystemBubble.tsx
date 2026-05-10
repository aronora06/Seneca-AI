import { useState } from "react";
import clsx from "clsx";
import type { TranscriptMessage } from "@seneca/shared";

interface Props {
  message: TranscriptMessage;
  onRetry?: () => void;
  retryLabel?: string;
}

export function SystemBubble({ message, onRetry, retryLabel }: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const notice = message.notice;
  if (!notice) return null;

  const isError = notice.kind === "error";

  return (
    <div className="my-1 flex justify-center">
      <div
        role={isError ? "alert" : "status"}
        className={clsx(
          "max-w-[92%] rounded-lg border px-3 py-2 text-xs",
          isError
            ? "border-danger/40 bg-danger-soft/70 text-danger-fg"
            : "border-border bg-surface-sunk text-fg-muted",
        )}
      >
        <div className="flex items-start gap-2">
          <span aria-hidden className="mt-0.5">
            {isError ? "✕" : "•"}
          </span>
          <div className="flex-1">
            <div className="font-medium">{notice.message}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] opacity-80">
              {typeof notice.status === "number" && notice.status > 0 && (
                <span className="font-mono">HTTP {notice.status}</span>
              )}
              {notice.attempts && notice.attempts > 1 && (
                <span>retried {notice.attempts}×</span>
              )}
              {notice.technical && (
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => setShowDetail((v) => !v)}
                >
                  {showDetail ? "Hide details" : "Show details"}
                </button>
              )}
              {notice.canRetry && onRetry && (
                <button
                  type="button"
                  className={clsx(
                    "ml-auto rounded-md border px-2 py-0.5 text-[11px] font-medium",
                    isError
                      ? "border-danger/40 bg-card text-fg hover:bg-surface"
                      : "border-border bg-card text-fg hover:bg-surface",
                  )}
                  onClick={onRetry}
                >
                  {retryLabel ?? "Retry"}
                </button>
              )}
            </div>
            {showDetail && notice.technical && (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-card p-2 font-mono text-[10px] text-fg">
                {notice.technical}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
