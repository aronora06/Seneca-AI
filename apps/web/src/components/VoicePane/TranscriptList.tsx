import { useEffect, useRef } from "react";
import clsx from "clsx";

import { useSenecaStore } from "../../store/seneca";
import { retryLastTurn } from "../../lib/runTurn";
import { useSpeechSynthesis } from "../../hooks/useSpeechSynthesis";
import { ResumeBanner } from "./ResumeBanner";
import { ToolChips } from "./ToolChips";
import { SystemBubble } from "./SystemBubble";

export function TranscriptList() {
  const transcript = useSenecaStore((s) => s.transcript);
  const partial = useSenecaStore((s) => s.streaming.partialText);
  const partialActions = useSenecaStore((s) => s.streaming.pendingActionLog);
  const interim = useSenecaStore((s) => s.voice.interimSpeech);
  const containerRef = useRef<HTMLDivElement>(null);

  // We use the synth hook here only to expose it to the partial bubble's
  // onSpoken callback during retry; the actual speak call lives in VoicePane.
  const tts = useSpeechSynthesis();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript.length, partial, partialActions.length, interim]);

  return (
    <div
      ref={containerRef}
      className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
      aria-live="polite"
    >
      <ResumeBanner />
      {transcript.length === 0 && !partial && !interim && (
        <p className="mt-8 text-center font-serif text-base italic text-fg-subtle">
          Speak, or type below. Seneca is here.
        </p>
      )}
      {transcript.map((m) => {
        if (m.role === "system") {
          return (
            <SystemBubble
              key={m.id}
              message={m}
              onRetry={() =>
                void retryLastTurn({
                  onSpoken: (text) => tts.speak(text),
                })
              }
            />
          );
        }
        return <Bubble key={m.id} message={m} />;
      })}
      {(partial || partialActions.length > 0) && (
        <PartialBubble text={partial} tools={partialActions} />
      )}
      {interim && <InterimBubble text={interim} />}
    </div>
  );
}

function Bubble({ message }: { message: import("@seneca/shared").TranscriptMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={clsx(
          "max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm",
          isUser
            ? "bg-fg text-fg-on"
            : "bg-card text-fg ring-1 ring-border",
        )}
      >
        {!isUser && (
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-fg-subtle">
            <span>Seneca</span>
            {message.hadVision && <span title="Seneca saw the canvas">· 👁</span>}
          </div>
        )}
        <div className={isUser ? "font-sans" : "font-serif text-[15px]"}>
          {message.text}
        </div>
        {!isUser && message.tools && message.tools.length > 0 && (
          <ToolChips tools={message.tools} />
        )}
      </div>
    </div>
  );
}

function PartialBubble({
  text,
  tools,
}: {
  text: string;
  tools: import("@seneca/shared").ToolCallRecord[];
}) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-2xl bg-card px-3.5 py-2 text-sm leading-relaxed text-fg shadow-sm ring-1 ring-border">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-fg-subtle">
          <span>Seneca</span>
          <span className="ml-1 inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        </div>
        {text && (
          <div className="font-serif text-[15px]">
            {text}
            <span className="ml-1 inline-block animate-pulse">▍</span>
          </div>
        )}
        {tools.length > 0 && <ToolChips tools={tools} pending />}
      </div>
    </div>
  );
}

function InterimBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-2xl bg-fg/70 px-3.5 py-2 text-sm leading-relaxed text-fg-on opacity-60 shadow-sm">
        {text}
      </div>
    </div>
  );
}
