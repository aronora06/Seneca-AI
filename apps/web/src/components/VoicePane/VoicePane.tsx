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
import { useConversationVad } from "../../hooks/useConversationVad";
import { abortActiveTurn, runTurn } from "../../lib/runTurn";
import { ttsLog, ttsLogReset } from "../../lib/ttsTimeline";
import {
  cancelConversationModeSubmit,
  scheduleConversationModeSubmit,
} from "../../lib/conversationSubmit";
import { usePrefs, writePrefs } from "../../lib/userPreferences";
import { toast } from "../Toast/toastStore";

import {
  useVoiceActivityFromStore,
  type VoiceActivityPhase,
} from "../../hooks/useVoiceActivity";
import { TranscriptList } from "./TranscriptList";
import { VisionToggle } from "./VisionToggle";
import { DictationField } from "./DictationField";
import { ConversationHint } from "./ConversationHint";
import { FloatingVoiceDock } from "./FloatingVoiceDock";
import { SenecaActivityBeacon } from "./SenecaActivityBeacon";
import { SenecaSpeechIndicator } from "./SenecaSpeechIndicator";
import { UserSpeechIndicator } from "./UserSpeechIndicator";
import { CollapsedActivityIndicators } from "./CollapsedActivityIndicators";

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
  const setVoiceActivity = useSenecaStore((s) => s.setVoiceActivity);
  const activeTurnId = useSenecaStore((s) => s.streaming.activeTurnId);
  const sessionId = useSenecaStore((s) => s.session.id);

  const prefs = usePrefs();
  const editBeforeSend = prefs.editBeforeSend;
  const vadEnabled = prefs.vadEnabled;
  const pttKey = prefs.pttKey || " ";
  const conversationMode = prefs.conversationMode;
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
  const interimRef = useRef(interim);
  interimRef.current = interim;

  const submitText = useCallback(
    async (raw: string) => {
      if (submittingRef.current) return;
      const trimmed = raw.trim();
      if (!trimmed || !sessionId) return;
      submittingRef.current = true;
      setText("");
      setInterim("");
      // Drop any in-flight audio from a prior turn — otherwise sentences
      // queue behind a slow pump and play long after the user moved on.
      tts.clear();
      ttsLogReset();
      ttsLog("user.submit", { chars: trimmed.length, preview: trimmed.slice(0, 72) });
      try {
        await runTurn({
          userText: trimmed,
          onSpoken: (chunk) => {
            ttsLog("runTurn.onSpoken", {
              chars: chunk.length,
              preview: chunk.slice(0, 72),
              activeTurnId: useSenecaStore.getState().streaming.activeTurnId,
            });
            tts.speak(chunk);
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

  // Four input behaviours:
  //   - Conversation Mode (Phase G, when prefs.conversationMode is on):
  //     a real Silero VAD owns turn boundaries. The recognizer's finals
  //     stream into the textarea for visual feedback; the VAD's
  //     `onSpeechEnd` callback fires the submit a moment later. The
  //     recognizer's own silence-based callback is suppressed (we'd
  //     just be racing the VAD).
  //   - Edit-before-send (default): finals stream into the textarea
  //     and the user reviews / sends manually.
  //   - Hands-free + recognizer-VAD: finals accumulate in the textarea
  //     and the recognizer's silence callback fires the submit once
  //     the user stops talking.
  //   - Hands-free without VAD: legacy auto-submit on every final.
  const handsFreeWithVad = !conversationMode && !editBeforeSend && vadEnabled;
  // In Conversation Mode the recognizer also accumulates finals into
  // the textarea — the user wants to *see* what was heard while they
  // were talking — but submission is owned by the VAD, not by the
  // recognizer's silence timer.
  const accumulateFinals = conversationMode || editBeforeSend || handsFreeWithVad;

  const stt = useSpeechRecognition({
    onFinal: (final) => {
      if (accumulateFinals) {
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
    // Disable the recognizer's silence callback unless we're in the
    // *recognizer-VAD* path so a quiet pause never auto-submits a
    // half-written thought. Conversation Mode uses its own Silero VAD
    // for the same job, much more accurately.
    silenceMs: handsFreeWithVad ? 1500 : 0,
  });

  // Mirror interim into the shared store so the rest of the UI (e.g.
  // a future status bar) can read it without subscribing to this hook.
  useEffect(() => {
    setInterimSpeech(stt.interim);
  }, [stt.interim, setInterimSpeech]);

  // Conversation Mode (Phase G) — Silero VAD owns barge-in and
  // turn-end detection. The VAD lives next to the recognizer; the
  // recognizer still does transcription but no longer decides when
  // the user is talking. See `useConversationVad.ts` for the
  // rationale on why we need a real VAD instead of the recognizer's
  // interim-text heuristic.
  const ttsRef = useRef(tts);
  ttsRef.current = tts;
  const submitTextRef = useRef(submitText);
  submitTextRef.current = submitText;
  const activeTurnIdRef = useRef(activeTurnId);
  activeTurnIdRef.current = activeTurnId;
  const conversationModeRef = useRef(conversationMode);
  conversationModeRef.current = conversationMode;
  const vadSubmitTimerRef = useRef<number | null>(null);
  const vadBargeInAtRef = useRef(0);

  /** Silero VAD for barge-in when legacy continuous + hands-free (STT is off during TTS). */
  const legacyBargeInVad =
    continuousListening && vadEnabled && !conversationMode;

  const vad = useConversationVad({
    onSpeechStart: () => {
      // The user just started talking. If TTS is mid-utterance or a
      // turn is streaming, treat it as barge-in: clear audio, abort
      // the LLM stream. Otherwise this is just the start of a normal
      // turn — nothing to interrupt.
      const t = ttsRef.current;
      if (t.audioActive || t.speaking || activeTurnIdRef.current) {
        const now = performance.now();
        if (now - vadBargeInAtRef.current < 800) return;
        vadBargeInAtRef.current = now;
        ttsLog("bargeIn.vad", {
          conversationMode: conversationModeRef.current,
        });
        t.clear();
        abortActiveTurn("user_barge_in");
      }
      cancelConversationModeSubmit(vadSubmitTimerRef);
    },
    onSpeechEnd: () => {
      if (!conversationModeRef.current) return;
      scheduleConversationModeSubmit({
        getPendingText: () => textRef.current,
        getSttInterim: () => interimRef.current,
        submit: (pending) => void submitTextRef.current(pending),
        timer: vadSubmitTimerRef,
      });
    },
    onVadMisfire: () => {
      cancelConversationModeSubmit(vadSubmitTimerRef);
    },
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    minSpeechFrames: 3,
  });

  // Mirror voice mode for workspace context / status affordances.
  useEffect(() => {
    const userListening =
      stt.isListening || (conversationMode && vad.isSpeaking);
    if (userListening) setVoiceMode("listening");
    else if (tts.audioActive) setVoiceMode("speaking");
    else if (activeTurnId) setVoiceMode("thinking");
    else setVoiceMode("idle");
  }, [
    stt.isListening,
    conversationMode,
    vad.isSpeaking,
    tts.audioActive,
    activeTurnId,
    setVoiceMode,
  ]);

  // Conversation Mode lifecycle — full VAD (barge-in + auto-submit).
  useEffect(() => {
    if (!conversationMode) {
      cancelConversationModeSubmit(vadSubmitTimerRef);
      return;
    }
    let cancelled = false;
    void vad.start().then((res) => {
      if (cancelled || res.ok) return;
      writePrefs({ conversationMode: false });
      toast.error({
        title: "Could not start Conversation Mode",
        description:
          res.error.length > 200 ? res.error.slice(0, 200) + "…" : res.error,
      });
    });
    return () => {
      cancelled = true;
      if (!legacyBargeInVad) vad.stop();
    };
  }, [conversationMode, legacyBargeInVad, vad]);

  // Legacy continuous + hands-free: keep Silero VAD running for barge-in
  // while STT is muted during TTS playback.
  useEffect(() => {
    if (!legacyBargeInVad) {
      if (!conversationMode) vad.stop();
      return;
    }
    let cancelled = false;
    void vad.start().then((res) => {
      if (cancelled || res.ok) return;
      console.warn("[seneca] VAD barge-in failed to start", res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [legacyBargeInVad, conversationMode, vad]);

  // While TTS is playing, raise the VAD's positive threshold so faint
  // TTS leakage through the laptop speakers doesn't trip a false
  // barge-in. Loud, deliberate user speech still triggers. When TTS
  // stops, drop the threshold back to the sensitive default so
  // normal-volume speech is detected promptly.
  useEffect(() => {
    if (!vad.isReady) return;
    if (!conversationMode && !legacyBargeInVad) return;
    vad.setActivationThreshold(tts.audioActive ? 0.72 : 0.5);
  }, [conversationMode, legacyBargeInVad, vad, tts.audioActive]);

  // Legacy interim barge-in — fallback when Silero VAD is unavailable.
  //
  // Production-grade voice agents (OpenAI Realtime, ElevenLabs
  // Conversational AI, Pi) all implement the same four-step
  // barge-in contract:
  //
  //   1. Detect the user is actually talking (not just "mic on").
  //   2. Stop TTS playback immediately (clear, not pause).
  //   3. Abort any in-flight LLM stream — don't keep paying for
  //      tokens the user will never hear.
  //   4. The interrupted message stays in the transcript with an
  //      `interrupted: true` flag so the next turn's context
  //      tells the model it was cut short.
  const userIsSpeaking = stt.isListening && stt.interim.trim().length > 0;
  const bargeInDebounceRef = useRef<number | null>(null);
  const bargeFiredRef = useRef(false);
  useEffect(() => {
    if (conversationMode) return;
    if (vadEnabled && vad.isReady) return;
    if (!userIsSpeaking) {
      if (bargeInDebounceRef.current !== null) {
        window.clearTimeout(bargeInDebounceRef.current);
        bargeInDebounceRef.current = null;
      }
      bargeFiredRef.current = false;
      return;
    }

    // Only interrupt when Seneca is actually playing audio. Using
    // `activeTurnId` alone caused false barge-ins during the gap between
    // TTS sentences (or during tool waits) when STT picked up breath/noise
    // — that cleared the queue and aborted the stream while text kept going.
    if (!tts.audioActive && !tts.speaking) return;
    const interimLen = stt.interim.trim().length;
    if (interimLen < 10) return;
    if (bargeFiredRef.current) return;
    if (bargeInDebounceRef.current !== null) return;

    bargeInDebounceRef.current = window.setTimeout(() => {
      bargeInDebounceRef.current = null;
      bargeFiredRef.current = true;
      ttsLog("bargeIn.legacy", { interimLen });
      tts.clear();
      abortActiveTurn("user_barge_in");
    }, 400);

    return () => {
      if (bargeInDebounceRef.current !== null) {
        window.clearTimeout(bargeInDebounceRef.current);
        bargeInDebounceRef.current = null;
      }
    };
  }, [conversationMode, vadEnabled, vad.isReady, userIsSpeaking, tts, activeTurnId]);

  // Continuous-listening gate.
  //
  // Two signals must BOTH be true for the recognizer to be running:
  //
  //   1. The user has opted into a hands-free mode (Conversation
  //      Mode or the legacy continuous toggle).
  //   2. Seneca is NOT currently speaking.
  //
  // Condition (2) is the echo-cancellation workaround. Chrome's Web
  // Speech Recognition runs on its own audio pipeline; we can't
  // attach an AEC layer to it. Without AEC the mic picks up
  // Seneca's voice through the laptop speakers and the recognizer
  // transcribes it as "user input" — which then triggers a
  // phantom barge-in (we used to literally interrupt Seneca with
  // his own words). Every consumer voice agent solves this the
  // same way: don't listen while you're talking. The user can
  // still interrupt by pressing the push-to-talk key or clicking
  // the mic button; both call `stt.start()` directly and bypass
  // this gate. In Conversation Mode the Silero VAD owns barge-in
  // separately, so we don't need to keep the recognizer running
  // through TTS playback.
  useEffect(() => {
    if (!stt.supported) return;
    const wantsListening = conversationMode || continuousListening;
    const shouldListen = wantsListening && !tts.audioActive;
    stt.setContinuous(shouldListen);
  }, [conversationMode, continuousListening, tts.audioActive, stt]);

  // Phase B — global push-to-talk key. Hold the configured key (default
  // spacebar) to start listening when no editable input is focused;
  // release to stop. Skips key repeats so a long hold doesn't cycle.
  // Disabled in Conversation Mode and in legacy continuous mode —
  // both already own the recognizer.
  const pttActiveRef = useRef(false);
  useEffect(() => {
    if (!stt.supported) return;
    if (conversationMode) return;
    if (continuousListening) return;

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
  }, [stt, pttKey, continuousListening, conversationMode]);

  const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submitText(text);
  };

  const pttDown = () => {
    if (!stt.supported || continuousListening || conversationMode) return;
    stt.start();
  };
  const pttUp = () => {
    if (!stt.supported || continuousListening || conversationMode) return;
    stt.stop();
  };

  const setEditBeforeSend = (next: boolean) => {
    writePrefs({ editBeforeSend: next });
  };

  const paneSide = dockSide === "left" ? "border-r" : "border-l";

  const activity = useVoiceActivityFromStore({
    sttListening: stt.isListening,
    sttInterim: interim,
    vadSpeaking: conversationMode && vad.isSpeaking,
    ttsSpeaking: tts.audioActive,
  });
  const playbackReactive = tts.engine === "elevenlabs";

  useEffect(() => {
    setVoiceActivity(activity.phase, activity.label);
  }, [activity.phase, activity.label, setVoiceActivity]);

  return (
    <aside
      className={clsx(
        "relative z-10 flex h-full flex-col border-border bg-card/35 backdrop-blur-md",
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
        <>
          <CollapsedStrip
            dockSide={dockSide}
            phase={activity.phase}
            fancy={activity.showFancy}
            playbackReactive={playbackReactive}
          />
          <FloatingVoiceDock
            dockSide={dockSide}
            sttSupported={stt.supported}
            isListening={
              stt.isListening || (conversationMode && vad.isSpeaking)
            }
            phase={activity.phase}
            showFancy={activity.showFancy}
            playbackReactive={playbackReactive}
            userActive={activity.userActive}
            senecaSpeaking={activity.senecaSpeaking}
            senecaWorking={activity.senecaWorking}
            continuous={continuousListening}
            handsFree={!editBeforeSend}
            muted={tts.muted}
            conversationMode={conversationMode}
            conversationVadReady={vad.isReady}
            conversationVadSpeaking={vad.isSpeaking}
            onExpand={toggleCollapsed}
            onPttDown={pttDown}
            onPttUp={pttUp}
            onToggleContinuous={setContinuousListening}
            onToggleHandsFree={(next) => setEditBeforeSend(!next)}
            onToggleMute={() => tts.setMuted(!tts.muted)}
            onToggleConversation={(next) =>
              writePrefs({
                conversationMode: next,
                conversationModeHintDismissed: true,
              })
            }
          />
          <ConversationHint dockSide={dockSide} visible={true} />
        </>
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

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activity.label && (
              <p className="sr-only" aria-live="polite">
                {activity.label}
              </p>
            )}
            <SenecaActivityBeacon
              phase={activity.phase}
              fancy={activity.showFancy}
              label={activity.senecaWorking ? activity.label : null}
            />
            {activity.senecaSpeaking && (
              <div className="flex shrink-0 px-4 pt-2">
                <SenecaSpeechIndicator
                  active
                  fancy={activity.showFancy}
                  playbackReactive={playbackReactive}
                />
              </div>
            )}
            <TranscriptList />
          </div>

          <div className="space-y-2 border-t border-border px-3 py-3">
            <div className="flex items-center gap-2">
              <PushToTalkButton
                supported={stt.supported}
                listening={stt.isListening}
                continuous={continuousListening}
                onDown={pttDown}
                onUp={pttUp}
              />
              <div className="flex flex-col gap-0.5">
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
              </div>
              <UserSpeechIndicator
                active={activity.userActive}
                fancy={activity.showFancy}
                className="shrink-0"
              />
              <div className="flex-1" />
              <VisionToggle />
            </div>

            <SpeechControls
              speaking={tts.speaking || tts.audioActive}
              paused={tts.paused}
              muted={tts.muted}
              engine={tts.engine}
              setMuted={tts.setMuted}
              pause={tts.pause}
              resume={tts.resume}
              skip={() => {
                tts.skip();
                if (useSenecaStore.getState().streaming.activeTurnId) {
                  abortActiveTurn("user_skip");
                }
              }}
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
                disabled={false}
                placeholderActive="Seneca is thinking… type to interrupt"
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
                disabled={!text.trim() || !sessionId}
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
  dockSide: "left" | "right";
  phase: VoiceActivityPhase;
  fancy: boolean;
  playbackReactive: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center text-xs text-fg-subtle">
      <div className="py-3 font-serif text-base text-fg-muted">S</div>
      <CollapsedActivityIndicators
        phase={props.phase}
        fancy={props.fancy}
        dockSide={props.dockSide}
        playbackReactive={props.playbackReactive}
      />
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
