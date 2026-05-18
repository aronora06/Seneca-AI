import { useEffect, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { useSenecaStore } from "../store/seneca";
import { apiJson } from "../lib/api";
import {
  normalizeDocuments,
  normalizeMap,
  normalizeWeb,
} from "../lib/sessionNormalizers";
import type { SessionRecord, SessionUsage } from "@seneca/shared";
import { DEFAULT_SESSION_USAGE } from "@seneca/shared";
import { VoicePane } from "./VoicePane/VoicePane";
import { CanvasContainer } from "./Canvas/CanvasContainer";
import { CostPill } from "./CostPill";
import { ProfileMenu } from "./Settings/ProfileMenu";
import { SessionsModal } from "./Sessions/SessionsModal";

export function AppShell() {
  const { user, bypass } = useAuth();
  const sessionId = useSenecaStore((s) => s.session.id);
  const sessionName = useSenecaStore((s) => s.session.name);
  const setSession = useSenecaStore((s) => s.setSession);
  const setTranscript = useSenecaStore((s) => s.setTranscript);
  const setWhiteboard = useSenecaStore((s) => s.setWhiteboard);
  const setMap = useSenecaStore((s) => s.setMap);
  const setWeb = useSenecaStore((s) => s.setWeb);
  const setDocuments = useSenecaStore((s) => s.setDocuments);
  const setSessionUsage = useSenecaStore((s) => s.setSessionUsage);
  const dockSide = useSenecaStore((s) => s.voice.dockSide);

  const [bootError, setBootError] = useState<string | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);

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
        setMap(normalizeMap(row.map));
        setWeb(normalizeWeb(row.web));
        setDocuments(normalizeDocuments(row.documents));
        setSessionUsage(normalizeUsage(row.usage));
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
  }, [
    user,
    setSession,
    setTranscript,
    setWhiteboard,
    setMap,
    setWeb,
    setDocuments,
    setSessionUsage,
  ]);

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
      <header className="relative z-40 flex items-center justify-between border-b border-border bg-card/70 px-4 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
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
          <SessionSwitcher
            sessionName={sessionName}
            disabled={!sessionId}
            onClick={() => setSessionsOpen(true)}
          />
        </div>
        <div className="flex items-center gap-3">
          <CostPill />
          <ProfileMenu />
        </div>
      </header>

      {bootError && (
        <div className="border-b border-danger/30 bg-danger-soft px-4 py-2 text-xs text-danger-fg">
          {bootError}
        </div>
      )}

      <div
        className={`flex h-full min-h-0 flex-1 [isolation:isolate] ${
          dockSide === "right" ? "flex-row-reverse" : "flex-row"
        }`}
      >
        <VoicePane />
        {/*
         * Force a full remount of the canvas subtree on session switch.
         * CanvasContainer + each tab snapshot the initial store state
         * via useState seeders; without a fresh mount they'd keep the
         * old session's data. The key cleanly resets every internal
         * useState as well, so a switch is identical to a fresh boot.
         */}
        <CanvasContainer key={sessionId ?? "no-session"} />
      </div>

      <SessionsModal
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
      />
    </div>
  );
}

interface SessionSwitcherProps {
  sessionName: string;
  disabled: boolean;
  onClick: () => void;
}

function SessionSwitcher({
  sessionName,
  disabled,
  onClick,
}: SessionSwitcherProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Switch session"
      className="ml-2 flex max-w-[280px] items-center gap-1.5 truncate rounded-full border border-border bg-surface px-3 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-sunk hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span aria-hidden className="text-[10px]">
        ◆
      </span>
      <span className="truncate">{sessionName || "Session"}</span>
      <span aria-hidden className="text-[10px] text-fg-subtle">
        ▾
      </span>
    </button>
  );
}

function normalizeUsage(raw: unknown): SessionUsage {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SESSION_USAGE };
  const u = raw as Partial<SessionUsage>;
  return {
    inputTokens: numOr(u.inputTokens, 0),
    outputTokens: numOr(u.outputTokens, 0),
    cacheReadInputTokens: numOr(u.cacheReadInputTokens, 0),
    cacheCreationInputTokens: numOr(u.cacheCreationInputTokens, 0),
    inputCostUSD: numOr(u.inputCostUSD, 0),
    outputCostUSD: numOr(u.outputCostUSD, 0),
    updatedAt:
      typeof u.updatedAt === "string"
        ? u.updatedAt
        : DEFAULT_SESSION_USAGE.updatedAt,
  };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
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
