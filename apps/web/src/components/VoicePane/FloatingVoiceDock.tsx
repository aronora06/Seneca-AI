import { useRef } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

import { useDraggablePosition, WORKSPACE_STAGE_ID } from "../../hooks/useDraggablePosition";
import type { VoiceActivityPhase } from "../../hooks/useVoiceActivity";
import { BarSpectrumCanvas } from "./BarSpectrumCanvas";
import { FloatingVisionButton } from "./FloatingVisionButton";
import { SenecaSpeechIndicator } from "./SenecaSpeechIndicator";

function DockIconButton(props: {
  label: string;
  title: string;
  onClick?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerLeave?: (e: React.PointerEvent) => void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      onPointerDown={props.onPointerDown}
      onPointerUp={props.onPointerUp}
      onPointerLeave={props.onPointerLeave}
      disabled={props.disabled}
      title={props.title}
      aria-label={props.label}
      aria-pressed={props.active}
      className={clsx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        props.danger && !props.disabled
          ? "bg-danger text-fg-on hover:opacity-90"
          : props.active
            ? "bg-accent/20 text-accent ring-1 ring-accent/40"
            : "text-fg-muted hover:bg-surface-sunk hover:text-fg",
      )}
    >
      {props.children}
    </button>
  );
}

export interface FloatingVoiceDockProps {
  dockSide: "left" | "right";
  sttSupported: boolean;
  isListening: boolean;
  phase: VoiceActivityPhase;
  showFancy: boolean;
  playbackReactive: boolean;
  userActive: boolean;
  senecaSpeaking: boolean;
  senecaWorking: boolean;
  continuous: boolean;
  handsFree: boolean;
  muted: boolean;
  /**
   * Phase G — Conversation Mode (Silero VAD owns turn boundaries +
   * barge-in). When on, the legacy continuous / hands-free / PTT
   * controls in this dock are disabled because the VAD already
   * owns the recognizer.
   */
  conversationMode: boolean;
  conversationVadReady: boolean;
  conversationVadSpeaking: boolean;
  onExpand: () => void;
  onPttDown: () => void;
  onPttUp: () => void;
  onToggleContinuous: (v: boolean) => void;
  onToggleHandsFree: (v: boolean) => void;
  onToggleMute: () => void;
  onToggleConversation: (v: boolean) => void;
}

export function FloatingVoiceDock(props: FloatingVoiceDockProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { position, isDragging, dragHandleProps } = useDraggablePosition({
    enabled: true,
    dockSide: props.dockSide,
    panelRef,
  });

  const stage =
    typeof document !== "undefined"
      ? document.getElementById(WORKSPACE_STAGE_ID)
      : null;
  if (!stage) return null;

  const pttDisabled =
    !props.sttSupported || props.continuous || props.conversationMode;
  const legacyDisabled = props.conversationMode;

  return createPortal(
    <div
      ref={panelRef}
      className={clsx(
        "pointer-events-auto absolute z-50",
        isDragging && "cursor-grabbing",
      )}
      style={{ left: position.x, top: position.y }}
      role="toolbar"
      aria-label="Floating voice controls"
    >
      <div
        className={clsx(
          "flex items-center gap-0.5 rounded-full border border-border bg-card/95 p-1 shadow-soft backdrop-blur-md dark:shadow-soft-dark",
          isDragging && "ring-2 ring-accent/30",
        )}
      >
        <button
          type="button"
          className="flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded-full text-fg-subtle hover:bg-surface-sunk hover:text-fg active:cursor-grabbing"
          aria-label="Drag voice controls"
          title="Drag to move"
          {...dragHandleProps}
        >
          <span aria-hidden className="flex flex-col gap-0.5">
            <span className="block h-0.5 w-3 rounded-full bg-current opacity-60" />
            <span className="block h-0.5 w-3 rounded-full bg-current opacity-60" />
          </span>
        </button>

        <div className="mx-0.5 h-5 w-px bg-border" aria-hidden />


        {(props.senecaSpeaking || props.senecaWorking) && (
          <DockSenecaActivity
            speaking={props.senecaSpeaking}
            working={props.senecaWorking}
            fancy={props.showFancy}
            playbackReactive={props.playbackReactive}
          />
        )}

        <DockIconButton
          label="Expand chat pane"
          title="Expand chat pane"
          onClick={props.onExpand}
        >
          <span aria-hidden className="text-base leading-none">
            ›
          </span>
        </DockIconButton>

        {props.sttSupported && (
          <DockIconButton
            label="Conversation Mode"
            title={
              props.conversationMode
                ? "Conversation Mode — speak freely; Seneca yields when you start"
                : "Hands-free conversation with Seneca (Silero VAD)"
            }
            active={props.conversationMode}
            onClick={() => props.onToggleConversation(!props.conversationMode)}
          >
            <ConvoIcon
              active={props.conversationMode}
              speaking={props.conversationVadSpeaking}
              ready={props.conversationVadReady}
            />
          </DockIconButton>
        )}

        {props.sttSupported && (
          <DockIconButton
            label={
              props.isListening ? "Release to stop listening" : "Hold to talk"
            }
            title={
              props.conversationMode
                ? "Disabled while Conversation Mode is on"
                : props.continuous
                  ? "Continuous mode — push-to-talk disabled"
                  : props.isListening
                    ? "Release to stop"
                    : "Hold to talk"
            }
            disabled={pttDisabled}
            danger={props.isListening}
            onPointerDown={(e) => {
              if (pttDisabled) return;
              e.preventDefault();
              props.onPttDown();
            }}
            onPointerUp={(e) => {
              e.preventDefault();
              props.onPttUp();
            }}
            onPointerLeave={() => props.onPttUp()}
          >
            <DockMicContent
              listening={props.isListening}
              userActive={props.userActive}
              fancy={props.showFancy}
            />
          </DockIconButton>
        )}

        {props.sttSupported && (
          <DockIconButton
            label="Continuous listening"
            title={
              legacyDisabled
                ? "Disabled while Conversation Mode is on"
                : "Continuous listening"
            }
            active={props.continuous}
            disabled={legacyDisabled}
            onClick={() => props.onToggleContinuous(!props.continuous)}
          >
            <span aria-hidden className="text-[10px] font-bold tracking-tighter">
              CONT
            </span>
          </DockIconButton>
        )}

        {props.sttSupported && (
          <DockIconButton
            label="Hands-free auto-send"
            title={
              legacyDisabled
                ? "Disabled while Conversation Mode is on"
                : "Hands-free — auto-send after you stop talking"
            }
            active={props.handsFree}
            disabled={legacyDisabled}
            onClick={() => props.onToggleHandsFree(!props.handsFree)}
          >
            <span aria-hidden className="text-sm">
              ✋
            </span>
          </DockIconButton>
        )}

        <FloatingVisionButton />

        <DockIconButton
          label={props.muted ? "Unmute Seneca" : "Mute Seneca"}
          title={props.muted ? "Unmute" : "Mute"}
          active={props.muted}
          onClick={props.onToggleMute}
        >
          <span aria-hidden className="text-sm">
            {props.muted ? "🔇" : "🔊"}
          </span>
        </DockIconButton>

        {!props.showFancy &&
          (props.userActive || props.senecaSpeaking || props.senecaWorking) && (
            <span
              className={clsx(
                "mr-1 h-2 w-2 shrink-0 rounded-full",
                props.userActive
                  ? "animate-pulse bg-danger"
                  : props.senecaSpeaking
                    ? "animate-pulse bg-accent"
                    : "animate-pulse bg-fg-subtle/60",
              )}
              title={
                props.userActive
                  ? "Listening"
                  : props.senecaSpeaking
                    ? "Speaking"
                    : "Thinking"
              }
              aria-hidden
            />
          )}
      </div>
    </div>,
    stage,
  );
}

function ConvoIcon({
  active,
  speaking,
  ready,
}: {
  active: boolean;
  speaking: boolean;
  ready: boolean;
}) {
  // Two stylised speech bubbles to read as "conversation". When the
  // VAD says the user is currently talking, the trailing bubble
  // animates a quick pulse so the user gets visual confirmation that
  // their voice was registered. When active but not yet ready
  // (model is still downloading on first run), we render a smaller
  // dot to convey "warming up."
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h11a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H8l-3 3v-3H4a1 1 0 0 1-1-1V6Z" />
      {active && (
        <circle
          cx="19"
          cy="18"
          r={speaking ? 2.5 : ready ? 2 : 1.5}
          fill="currentColor"
          stroke="none"
          opacity={speaking ? 0.95 : ready ? 0.75 : 0.45}
          className={speaking ? "animate-pulse" : undefined}
        />
      )}
    </svg>
  );
}

function MicIcon({ listening }: { listening: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
      {listening && (
        <circle cx="12" cy="12" r="10" strokeWidth="1" opacity="0.35" />
      )}
    </svg>
  );
}

function DockSenecaActivity(props: {
  speaking: boolean;
  working: boolean;
  fancy: boolean;
  playbackReactive: boolean;
}) {
  if (props.speaking) {
    return (
      <SenecaSpeechIndicator
        active
        fancy={props.fancy}
        playbackReactive={props.playbackReactive}
        className="px-0.5"
      />
    );
  }
  if (!props.working) return null;
  if (props.fancy) {
    return (
      <span
        className="flex h-8 w-2 flex-col items-center justify-center gap-0.5 px-0.5"
        title="Seneca is working"
        aria-hidden
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-1 animate-pulse rounded-full bg-fg-subtle/70"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      className="mr-0.5 h-2 w-2 animate-pulse rounded-full bg-fg-subtle/60"
      title="Thinking"
      aria-hidden
    />
  );
}

function DockMicContent(props: {
  listening: boolean;
  userActive: boolean;
  fancy: boolean;
}) {
  if (props.fancy && props.userActive) {
    return (
      <span className="relative flex h-8 w-8 items-center justify-center">
        <BarSpectrumCanvas
          active
          source="mic"
          width={22}
          height={14}
          bars={4}
          colorVar="--c-danger"
          colorFallback="220 38 38"
          anchor="bottom"
        />
      </span>
    );
  }
  return <MicIcon listening={props.listening} />;
}
