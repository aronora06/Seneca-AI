import { useEffect, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { useSenecaStore } from "../store/seneca";
import { apiJson } from "../lib/api";
import type { SessionRecord } from "@seneca/shared";
import { VoicePane } from "./VoicePane/VoicePane";
import { CanvasContainer } from "./Canvas/CanvasContainer";
import { ThemeToggle } from "../theme/ThemeToggle";

export function AppShell() {
  const { user, signOut, bypass } = useAuth();
  const setSession = useSenecaStore((s) => s.setSession);
  const setTranscript = useSenecaStore((s) => s.setTranscript);
  const setWhiteboard = useSenecaStore((s) => s.setWhiteboard);
  const dockSide = useSenecaStore((s) => s.voice.dockSide);

  const [bootError, setBootError] = useState<string | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const row = await apiJson<SessionRecord>("/api/sessions/current");
        if (cancelled) return;
        setSession(row.id, row.name);
        setTranscript(row.transcript ?? []);
        if (row.whiteboard && Object.keys(row.whiteboard).length > 0) {
          setWhiteboard(row.whiteboard);
        } else {
          setWhiteboard({ elements: [] });
        }
      } catch (err) {
        if (cancelled) return;
        setBootError(
          err instanceof Error
            ? err.message
            : "Failed to load your session. Check the API is running.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, setSession, setTranscript, setWhiteboard]);

  // API health ping for the header status dot.
  useEffect(() => {
    let cancelled = false;
    const base =
      import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
      "http://localhost:8787";
    void fetch(`${base}/api/health`)
      .then((r) => r.ok)
      .then((ok) => {
        if (!cancelled) setApiOk(ok);
      })
      .catch(() => {
        if (!cancelled) setApiOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card/70 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="font-serif text-xl tracking-wide text-fg">
            Seneca
          </span>
          <ApiStatus apiOk={apiOk} />
          {bypass && (
            <span
              className="rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent"
              title="Authentication is bypassed for local dev (VITE_DEV_BYPASS_AUTH=true)"
            >
              Dev mode
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-fg-muted">
          <ThemeToggle />
          <span>{user?.email}</span>
          {!bypass && (
            <button
              type="button"
              onClick={() => {
                void signOut();
              }}
              className="btn-ghost h-7 px-2"
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      {bootError && (
        <div className="border-b border-danger/30 bg-danger-soft px-4 py-2 text-xs text-danger-fg">
          {bootError}
        </div>
      )}

      <div
        className={`flex h-full min-h-0 flex-1 ${
          dockSide === "right" ? "flex-row-reverse" : "flex-row"
        }`}
      >
        <VoicePane />
        <CanvasContainer />
      </div>
    </div>
  );
}

function ApiStatus({ apiOk }: { apiOk: boolean | null }) {
  const colour =
    apiOk === null ? "bg-fg-subtle/60" : apiOk ? "bg-ok" : "bg-danger";
  const label =
    apiOk === null
      ? "Checking API…"
      : apiOk
        ? "API connected"
        : "API unreachable";
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-fg-subtle"
      title={label}
    >
      <span className={`h-2 w-2 rounded-full ${colour}`} />
      {label}
    </span>
  );
}
