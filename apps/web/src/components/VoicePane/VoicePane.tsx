import { useEffect, useRef, useState, type FormEvent } from "react";
import clsx from "clsx";

import { useSenecaStore } from "../../store/seneca";
import { useSpeechRecognition } from "../../hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "../../hooks/useSpeechSynthesis";
import { runTurn } from "../../lib/runTurn";

import { TranscriptList } from "./TranscriptList";
import { VisionToggle } from "./VisionToggle";

export function VoicePane() {
  const dockSide = useSenecaStore((s) => s.voice.dockSide);
  const collapsed = useSenecaStore((s) => s.voice.collapsed);
  const continuousListening = useSenecaStore((s) => s.voice.continuousListening);
  const setDockSide = useSenecaStore((s) => s.setDockSide);
  const toggleCollapsed = useSenecaStore((s) => s.toggleCollapsed);
  const setContinuousListening = useSenecaStore(
    (s) => s.setContinuousListening,
  );
  const setInterimSpeech = useSenecaStore((s) => s.setInterimSpeech);
  const setVoiceMode = useSenecaStore((s) => s.setVoiceMode);
  const activeTurnId = useSenecaStore((s) => s.streaming.activeTurnId);
  const sessionId = useSenecaStore((s) => s.session.id);

  const tts = useSpeechSynthesis();
  const [text, setText] = useState("");
  const submittingRef = useRef(false);

  const stt = useSpeechRecognition({
    onFinal: (final) => {
      void submitText(final);
    },
  });

  useEffect(() => {
    setInterimSpeech(stt.interim);
  }, [stt.interim, setInterimSpeech]);

  useEffect(() => {
    if (stt.isListening) setVoiceMode("listening");
    else if (tts.speaking) setVoiceMode("speaking");
    else setVoiceMode("idle");
  }, [stt.isListening, tts.speaking, setVoiceMode]);

  useEffect(() => {
    if (!stt.supported) return;
    stt.setContinuous(continuousListening);
  }, [continuousListening, stt]);

  const submitText = async (raw: string) => {
    if (submittingRef.current) return;
    const trimmed = raw.trim();
    if (!trimmed || !sessionId) return;
    submittingRef.current = true;
    setText("");
    try {
      await runTurn({
        userText: trimmed,
        onSpoken: (full) => {
          tts.speak(full);
        },
      });
    } finally {
      submittingRef.current = false;
    }
  };

  const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submitText(text);
  };

  const pttDown = () => {
    if (!stt.supported || continuousListening) return;
    stt.start();
  };
  const pttUp = () => {
    if (!stt.supported || continuousListening) return;
    stt.stop();
  };

  const paneSide = dockSide === "left" ? "border-r" : "border-l";

  return (
    <aside
      className={clsx(
        "flex h-full flex-col border-border bg-card/60 backdrop-blur",
        paneSide,
        collapsed ? "w-14" : "w-[380px]",
        "shrink-0 transition-[width] duration-200",
      )}
    >
      <PaneHeader
        collapsed={collapsed}
        toggleCollapsed={toggleCollapsed}
        dockSide={dockSide}
        setDockSide={setDockSide}
      />

      {collapsed ? (
        <CollapsedStrip
          isListening={stt.isListening}
          isSpeaking={tts.speaking}
          turnActive={!!activeTurnId}
        />
      ) : (
        <>
          {!stt.supported && (
            <div className="mx-3 mt-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-fg-muted">
              Voice input isn't available in this browser. Use Chrome, Edge, or
              Safari for speech — or just type below.
            </div>
          )}
          {stt.error && (
            <div className="mx-3 mt-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger-fg">
              {stt.error}
            </div>
          )}

          <TranscriptList />

          <div className="space-y-2 border-t border-border px-3 py-3">
            <div className="flex items-center gap-2">
              <PushToTalkButton
                supported={stt.supported}
                listening={stt.isListening}
                continuous={continuousListening}
                onDown={pttDown}
                onUp={pttUp}
              />
              <ContinuousToggle
                supported={stt.supported}
                continuous={continuousListening}
                onChange={setContinuousListening}
              />
              <div className="flex-1" />
              <VisionToggle />
            </div>

            <SpeechControls
              speaking={tts.speaking}
              paused={tts.paused}
              muted={tts.muted}
              setMuted={tts.setMuted}
              pause={tts.pause}
              resume={tts.resume}
              skip={tts.skip}
            />

            <form
              onSubmit={onFormSubmit}
              className="flex items-end gap-2 pt-1"
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submitText(text);
                  }
                }}
                placeholder={
                  activeTurnId
                    ? "Seneca is thinking…"
                    : "Type a message — Enter sends, Shift+Enter for newline"
                }
                rows={2}
                disabled={!!activeTurnId}
                className="input resize-none"
              />
              <button
                type="submit"
                className="btn-primary h-10"
                disabled={!text.trim() || !!activeTurnId || !sessionId}
              >
                Send
              </button>
            </form>
          </div>
        </>
      )}
    </aside>
  );
}

function PaneHeader(props: {
  collapsed: boolean;
  toggleCollapsed: () => void;
  dockSide: "left" | "right";
  setDockSide: (s: "left" | "right") => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2">
      <button
        type="button"
        onClick={props.toggleCollapsed}
        className="btn-ghost h-8 w-8 !p-0"
        title={props.collapsed ? "Expand voice pane" : "Collapse voice pane"}
        aria-label={props.collapsed ? "Expand voice pane" : "Collapse voice pane"}
      >
        {props.collapsed ? "›" : "‹"}
      </button>
      {!props.collapsed && (
        <span className="font-serif text-sm tracking-wide text-fg-muted">
          Seneca
        </span>
      )}
      {!props.collapsed && (
        <button
          type="button"
          className="btn-ghost h-8 w-8 !p-0 text-base"
          title={`Dock to ${props.dockSide === "left" ? "right" : "left"}`}
          aria-label={`Dock to ${props.dockSide === "left" ? "right" : "left"}`}
          onClick={() =>
            props.setDockSide(props.dockSide === "left" ? "right" : "left")
          }
        >
          ⇄
        </button>
      )}
    </div>
  );
}

function CollapsedStrip(props: {
  isListening: boolean;
  isSpeaking: boolean;
  turnActive: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-3 py-3 text-xs text-fg-subtle">
      <div className="font-serif text-base text-fg-muted">S</div>
      {props.isListening && (
        <span
          className="h-2 w-2 animate-pulse rounded-full bg-danger"
          title="Listening"
        />
      )}
      {props.isSpeaking && (
        <span
          className="h-2 w-2 animate-pulse rounded-full bg-accent"
          title="Speaking"
        />
      )}
      {props.turnActive && !props.isSpeaking && (
        <span
          className="h-2 w-2 animate-pulse rounded-full bg-fg-subtle/60"
          title="Thinking"
        />
      )}
    </div>
  );
}

function PushToTalkButton(props: {
  supported: boolean;
  listening: boolean;
  continuous: boolean;
  onDown: () => void;
  onUp: () => void;
}) {
  if (!props.supported || props.continuous) {
    return (
      <button
        type="button"
        disabled
        className="btn-ghost h-9"
        title={
          props.continuous
            ? "Continuous mode is on — push-to-talk disabled"
            : "Speech not supported"
        }
      >
        🎙
      </button>
    );
  }
  return (
    <button
      type="button"
      className={clsx(
        "btn h-9 select-none ring-1 ring-border",
        props.listening
          ? "bg-danger text-fg-on hover:opacity-90"
          : "bg-surface-sunk text-fg-muted hover:text-fg",
      )}
      onMouseDown={props.onDown}
      onMouseUp={props.onUp}
      onMouseLeave={props.onUp}
      onTouchStart={(e) => {
        e.preventDefault();
        props.onDown();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        props.onUp();
      }}
      title="Hold to talk"
    >
      {props.listening ? "● Listening" : "Hold to talk"}
    </button>
  );
}

function ContinuousToggle(props: {
  supported: boolean;
  continuous: boolean;
  onChange: (v: boolean) => void;
}) {
  if (!props.supported) return null;
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-muted">
      <input
        type="checkbox"
        checked={props.continuous}
        onChange={(e) => props.onChange(e.target.checked)}
        className="h-3 w-3 rounded border-border text-accent focus:ring-accent"
      />
      Continuous
    </label>
  );
}

function SpeechControls(props: {
  speaking: boolean;
  paused: boolean;
  muted: boolean;
  setMuted: (m: boolean) => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-fg-muted">
      <button
        type="button"
        className="btn-ghost h-7 px-2"
        onClick={() => props.setMuted(!props.muted)}
        title={props.muted ? "Unmute Seneca's voice" : "Mute Seneca's voice"}
      >
        {props.muted ? "🔇 Muted" : "🔊"}
      </button>
      <button
        type="button"
        className="btn-ghost h-7 px-2"
        disabled={!props.speaking}
        onClick={() => (props.paused ? props.resume() : props.pause())}
      >
        {props.paused ? "▶ Resume" : "⏸ Pause"}
      </button>
      <button
        type="button"
        className="btn-ghost h-7 px-2"
        disabled={!props.speaking}
        onClick={props.skip}
      >
        ⏭ Skip
      </button>
    </div>
  );
}
