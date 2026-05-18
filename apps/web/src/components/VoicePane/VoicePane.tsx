import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import clsx from "clsx";

import { ELEVENLABS_USD_PER_CHAR } from "@seneca/shared";

import { useSenecaStore } from "../../store/seneca";
import { useSpeechRecognition } from "../../hooks/useSpeechRecognition";
import { useSpeech } from "../../hooks/useSpeech";
import { runTurn } from "../../lib/runTurn";
import { usePrefs, writePrefs } from "../../lib/userPreferences";

import { TranscriptList } from "./TranscriptList";
import { VisionToggle } from "./VisionToggle";
import { DictationField } from "./DictationField";
import { Waveform } from "./Waveform";

/**
 * Voice pane — Phase B dictation surface.
 *
 * Default behaviour is "edit-before-send": STT final results stream
 * into the textarea and the user reviews / edits before Enter or the
 * Send button submits. Toggling "Hands-free" off the persisted default
 * restores the legacy auto-submit path, with voice activity detection
 * (~1.5s of silence after speech) submitting automatically so the user
 * never has to take their hands off the work in front of them.
 *
 * Spacebar push-to-talk: when no editable input is focused, holding
 * the configured PTT key starts STT; releasing stops it. Repeat events
 * are skipped so a long hold doesn't cycle start/stop.
 */
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

  const prefs = usePrefs();
  const editBeforeSend = prefs.editBeforeSend;
  const vadEnabled = prefs.vadEnabled;
  const pttKey = prefs.pttKey || " ";
  const bumpTtsUsage = useSenecaStore((s) => s.bumpTtsUsage);

  const tts = useSpeech({
    onUsage: (chars) => {
      bumpTtsUsage(chars, chars * ELEVENLABS_USD_PER_CHAR);
    },
  });
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  // Keep the latest text in a ref so the silence-callback can read it
  // without re-binding the recognizer on every keystroke.
  const textRef = useRef(text);
  textRef.current = text;

  const submitText = useCallback(
    async (raw: string) => {
      if (submittingRef.current) return;
      const trimmed = raw.trim();
      if (!trimmed || !sessionId) return;
      submittingRef.current = true;
      setText("");
      setInterim("");
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
    },
    [sessionId, tts],
  );

  const appendDictation = useCallback((final: string) => {
    setText((prev) => {
      const left = prev;
      const right = final;
      if (!left) return right;
      const needsSpace = !/\s$/.test(left) && !/^\s/.test(right);
      return needsSpace ? `${left} ${right}` : `${left}${right}`;
    });
  }, []);

  // Three input behaviours:
  //   - Edit-before-send (default): finals stream into the textarea
  //     and the user reviews / sends manually.
  //   - Hands-free + VAD: finals accumulate in the textarea and the
  //     silence callback fires the submit once the user stops talking.
  //   - Hands-free without VAD: legacy auto-submit on every final.
  const handsFreeWithVad = !editBeforeSend && vadEnabled;

  const stt = useSpeechRecognition({
    onFinal: (final) => {
      if (editBeforeSend || handsFreeWithVad) {
        appendDictation(final);
        return;
      }
      // Hands-free without VAD — submit whatever Seneca heard plus
      // anything the user had already typed so a stray keystroke
      // doesn't get lost when STT fires.
      const carry = textRef.current.trim();
      const submitMe = carry ? `${carry} ${final}` : final;
      void submitText(submitMe);
    },
    onInterim: (chunk) => {
      setInterim(chunk);
    },
    onSilence: () => {
      if (!handsFreeWithVad) return;
      const pending = textRef.current.trim();
      if (!pending) return;
      void submitText(pending);
    },
    // Disable the silence callback unless we're in the hands-free + VAD
    // path so a quiet pause during edit-before-send dictation never
    // auto-submits a half-written thought.
    silenceMs: handsFreeWithVad ? 1500 : 0,
  });

  // Mirror interim into the shared store so the rest of the UI (e.g.
  // a future status bar) can read it without subscribing to this hook.
  useEffect(() => {
    setInterimSpeech(stt.interim);
  }, [stt.interim, setInterimSpeech]);

  // Mirror voice mode for the AppShell-level status pill.
  useEffect(() => {
    if (stt.isListening) setVoiceMode("listening");
    else if (tts.speaking) setVoiceMode("speaking");
    else setVoiceMode("idle");
  }, [stt.isListening, tts.speaking, setVoiceMode]);

  // Speech interruption — when the user starts talking while Seneca is
  // mid-sentence, pause TTS so the back-and-forth feels natural. We
  // resume on stt.stop unless the user actually submitted (in which
  // case clear() will run as part of submitText). The pause is light:
  // we only resume if no further user-input action has cleared the
  // queue.
  const wasPausedForListeningRef = useRef(false);
  useEffect(() => {
    if (stt.isListening && tts.speaking && !tts.paused) {
      tts.pause();
      wasPausedForListeningRef.current = true;
    } else if (!stt.isListening && wasPausedForListeningRef.current) {
      wasPausedForListeningRef.current = false;
      if (tts.paused) tts.resume();
    }
  }, [stt.isListening, tts]);

  useEffect(() => {
    if (!stt.supported) return;
    stt.setContinuous(continuousListening);
  }, [continuousListening, stt]);

  // Phase B — global push-to-talk key. Hold the configured key (default
  // spacebar) to start listening when no editable input is focused;
  // release to stop. Skips key repeats so a long hold doesn't cycle.
  const pttActiveRef = useRef(false);
  useEffect(() => {
    if (!stt.supported) return;
    if (continuousListening) return; // continuous owns the recognizer

    const matchesPtt = (e: KeyboardEvent): boolean => {
      // Match by `key` (Space, "a", "Enter", etc). Case-insensitive for
      // alpha keys.
      const want = pttKey;
      if (want.length === 1 && /[a-z]/i.test(want)) {
        return e.key.toLowerCase() === want.toLowerCase();
      }
      return e.key === want;
    };

    const handleDown = (e: KeyboardEvent) => {
      if (!matchesPtt(e)) return;
      if (e.repeat) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      if (pttActiveRef.current) return;
      pttActiveRef.current = true;
      stt.start();
    };

    const handleUp = (e: KeyboardEvent) => {
      if (!matchesPtt(e)) return;
      if (!pttActiveRef.current) return;
      e.preventDefault();
      pttActiveRef.current = false;
      stt.stop();
    };

    const handleBlur = () => {
      if (!pttActiveRef.current) return;
      pttActiveRef.current = false;
      stt.stop();
    };

    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [stt, pttKey, continuousListening]);

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

  const setEditBeforeSend = (next: boolean) => {
    writePrefs({ editBeforeSend: next });
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
              <Waveform
                active={stt.isListening}
                className="inline-flex items-center"
              />
              <ContinuousToggle
                supported={stt.supported}
                continuous={continuousListening}
                onChange={setContinuousListening}
              />
              <HandsFreeToggle
                supported={stt.supported}
                handsFree={!editBeforeSend}
                onChange={(next) => setEditBeforeSend(!next)}
              />
              <div className="flex-1" />
              <VisionToggle />
            </div>

            <SpeechControls
              speaking={tts.speaking}
              paused={tts.paused}
              muted={tts.muted}
              engine={tts.engine}
              setMuted={tts.setMuted}
              pause={tts.pause}
              resume={tts.resume}
              skip={tts.skip}
              pttKey={pttKey}
              showShortcutHint={stt.supported && !continuousListening}
            />

            <form
              onSubmit={onFormSubmit}
              className="flex items-end gap-2 pt-1"
            >
              <DictationField
                textareaRef={textareaRef}
                value={text}
                onChange={setText}
                interim={stt.isListening && editBeforeSend ? interim : ""}
                disabled={!!activeTurnId}
                placeholderActive="Seneca is thinking…"
                placeholderIdle={
                  stt.supported
                    ? "Type or hold the mic to dictate — Enter sends"
                    : "Type a message — Enter sends, Shift+Enter for newline"
                }
                onEnter={() => void submitText(text)}
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
    <label
      className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-muted"
      title="Keep the microphone on between utterances"
    >
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

function HandsFreeToggle(props: {
  supported: boolean;
  handsFree: boolean;
  onChange: (v: boolean) => void;
}) {
  if (!props.supported) return null;
  return (
    <label
      className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-muted"
      title="When on, finished sentences auto-submit after a short silence instead of streaming into the input box."
    >
      <input
        type="checkbox"
        checked={props.handsFree}
        onChange={(e) => props.onChange(e.target.checked)}
        className="h-3 w-3 rounded border-border text-accent focus:ring-accent"
      />
      Hands-free
    </label>
  );
}

function SpeechControls(props: {
  speaking: boolean;
  paused: boolean;
  muted: boolean;
  engine: "elevenlabs" | "browser";
  setMuted: (m: boolean) => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  pttKey: string;
  showShortcutHint: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-fg-muted">
      <button
        type="button"
        className="btn-ghost h-7 px-2"
        onClick={() => props.setMuted(!props.muted)}
        title={
          props.muted
            ? "Unmute Seneca's voice"
            : props.engine === "elevenlabs"
              ? "Mute Seneca's voice (ElevenLabs premium)"
              : "Mute Seneca's voice (browser TTS)"
        }
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
      {props.engine === "elevenlabs" && (
        <span
          className="rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent"
          title="Premium TTS via ElevenLabs"
        >
          Premium
        </span>
      )}
      {props.showShortcutHint && (
        <span className="ml-auto truncate text-[10px] text-fg-subtle">
          Hold {prettyKey(props.pttKey)} to talk
        </span>
      )}
    </div>
  );
}

function prettyKey(k: string): string {
  if (k === " ") return "Space";
  if (k.length === 1) return k.toUpperCase();
  return k;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}
