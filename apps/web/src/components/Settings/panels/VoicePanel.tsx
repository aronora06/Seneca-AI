import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";

import {
  readPrefs,
  writePrefs,
  type InputModeDefault,
} from "../../../lib/userPreferences";
import { PanelIntro, Section } from "./_shared";

const INPUT_MODE_OPTIONS: Array<{ value: InputModeDefault; label: string }> = [
  { value: "push-to-talk", label: "Push-to-talk" },
  { value: "continuous",   label: "Continuous" },
  { value: "text-only",    label: "Text only" },
];

const DICTATION_OPTIONS: Array<{
  value: "edit" | "hands-free";
  label: string;
  hint: string;
}> = [
  {
    value: "edit",
    label: "Edit before send",
    hint: "Dictated text streams into the input box so you can review or fix it.",
  },
  {
    value: "hands-free",
    label: "Hands-free",
    hint: "Dictated text auto-submits after a short silence (voice activity detection).",
  },
];

export function VoicePanel() {
  const [prefs, setPrefs] = useState(() => readPrefs());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const update = () => setVoices([...window.speechSynthesis.getVoices()]);
    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);

  const update = useCallback(
    (partial: Parameters<typeof writePrefs>[0]) => {
      setPrefs(writePrefs(partial));
    },
    [],
  );

  const previewVoice = useCallback(() => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(
      "Let us begin. What shall we think about today?",
    );
    if (prefs.ttsVoiceURI) {
      const match = voices.find((v) => v.voiceURI === prefs.ttsVoiceURI);
      if (match) utter.voice = match;
    }
    utter.rate = prefs.ttsRate;
    utter.pitch = prefs.ttsPitch;
    window.speechSynthesis.speak(utter);
  }, [prefs.ttsVoiceURI, prefs.ttsRate, prefs.ttsPitch, voices]);

  const groupedVoices = groupByLang(voices);

  return (
    <>
      <PanelIntro
        description="Pick how Seneca sounds and how you'd like to talk back."
        autoSaves
      />

      <Section label="Voice">
        <div className="flex gap-2">
          <select
            value={prefs.ttsVoiceURI ?? ""}
            onChange={(e) => update({ ttsVoiceURI: e.target.value || null })}
            className="input flex-1"
          >
            <option value="">Auto (best available)</option>
            {groupedVoices.map(([lang, vs]) => (
              <optgroup key={lang} label={lang}>
                {vs.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="button" onClick={previewVoice} className="btn-soft shrink-0">
            Preview
          </button>
        </div>
      </Section>

      <Section label={`Speed (${prefs.ttsRate.toFixed(1)}x)`}>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={prefs.ttsRate}
          onChange={(e) => update({ ttsRate: parseFloat(e.target.value) })}
          className="w-full accent-accent"
        />
        <div className="mt-1 flex justify-between text-[10px] text-fg-subtle">
          <span>0.5x</span><span>1.0x</span><span>2.0x</span>
        </div>
      </Section>

      <Section label={`Pitch (${prefs.ttsPitch.toFixed(1)})`}>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={prefs.ttsPitch}
          onChange={(e) => update({ ttsPitch: parseFloat(e.target.value) })}
          className="w-full accent-accent"
        />
        <div className="mt-1 flex justify-between text-[10px] text-fg-subtle">
          <span>Low</span><span>Normal</span><span>High</span>
        </div>
      </Section>

      <Section label="Auto-play responses">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={prefs.ttsAutoPlay}
            onChange={(e) => update({ ttsAutoPlay: e.target.checked })}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          <span className="text-sm text-fg-muted">
            Speak Seneca's responses aloud automatically
          </span>
        </label>
      </Section>

      <Section label="Default input mode">
        <div
          role="radiogroup"
          className="flex gap-1 rounded-lg border border-border bg-surface-sunk/50 p-1"
        >
          {INPUT_MODE_OPTIONS.map((opt) => {
            const active = prefs.inputModeDefault === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update({ inputModeDefault: opt.value })}
                className={clsx(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-card text-fg shadow-sm" : "text-fg-muted hover:text-fg",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        label="Dictation behaviour"
        hint="Pick how finished sentences land when you talk."
      >
        <div
          role="radiogroup"
          aria-label="Dictation behaviour"
          className="flex gap-1 rounded-lg border border-border bg-surface-sunk/50 p-1"
        >
          {DICTATION_OPTIONS.map((opt) => {
            const active =
              opt.value === "edit" ? prefs.editBeforeSend : !prefs.editBeforeSend;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                title={opt.hint}
                onClick={() =>
                  update({ editBeforeSend: opt.value === "edit" })
                }
                className={clsx(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-card text-fg shadow-sm" : "text-fg-muted hover:text-fg",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        label="Voice activity detection"
        hint="Ignored unless dictation is set to hands-free."
      >
        <label
          className={clsx(
            "flex cursor-pointer items-center gap-3",
            prefs.editBeforeSend && "opacity-60",
          )}
        >
          <input
            type="checkbox"
            checked={prefs.vadEnabled}
            disabled={prefs.editBeforeSend}
            onChange={(e) => update({ vadEnabled: e.target.checked })}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          <span className="text-sm text-fg-muted">
            Auto-submit ~1.5s after I stop talking
          </span>
        </label>
      </Section>

      <Section
        label="Push-to-talk key"
        hint="Hold this key anywhere in the app to start dictating. Ignored while you're typing in an input."
      >
        <PttKeyPicker
          value={prefs.pttKey}
          onChange={(next) => update({ pttKey: next })}
        />
      </Section>
    </>
  );
}

interface PttKeyPickerProps {
  value: string;
  onChange: (next: string) => void;
}

/**
 * A focusable button that captures the next key the user presses and
 * stores it as the push-to-talk shortcut. Avoids the rabbit hole of
 * exposing the full `KeyboardEvent.key` namespace in a select; the
 * "press to record" interaction is what every IDE / launcher does.
 */
function PttKeyPicker({ value, onChange }: PttKeyPickerProps) {
  const [recording, setRecording] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      // Modifier-only keys are never useful as a PTT key — wait for the
      // user to release them and press something else.
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onChange(e.key);
      setRecording(false);
      ref.current?.blur();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, onChange]);

  const label =
    value === " " ? "Space" : value.length === 1 ? value.toUpperCase() : value;

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => setRecording((r) => !r)}
      className={clsx(
        "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
        recording
          ? "border-accent bg-accent/10 text-accent"
          : "border-border bg-surface text-fg hover:bg-surface-sunk",
      )}
    >
      <span className="font-medium">{recording ? "Press a key…" : label}</span>
      {!recording && (
        <span className="text-[11px] text-fg-subtle">Click to change</span>
      )}
    </button>
  );
}

function groupByLang(
  voices: SpeechSynthesisVoice[],
): Array<[string, SpeechSynthesisVoice[]]> {
  const map = new Map<string, SpeechSynthesisVoice[]>();
  for (const v of voices) {
    const lang = v.lang.split("-")[0] ?? v.lang;
    const arr = map.get(lang) ?? [];
    arr.push(v);
    map.set(lang, arr);
  }
  return [...map.entries()].sort(([a], [b]) => {
    if (a === "en") return -1;
    if (b === "en") return 1;
    return a.localeCompare(b);
  });
}
