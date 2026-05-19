/**
 * Frequency analyser for TTS playback (ElevenLabs <audio> element).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { getPlaybackAudio } from "../lib/playbackAudioRegistry";

export interface PlaybackAnalyserHook {
  ready: boolean;
  getFrequencyBins: (
    target?: Uint8Array<ArrayBuffer>,
  ) => Uint8Array<ArrayBuffer>;
  binCount: number;
}

interface Options {
  active: boolean;
}

export function usePlaybackAnalyser(opts: Options): PlaybackAnalyserHook {
  const { active } = opts;
  const [ready, setReady] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!active) {
      setReady(false);
      return;
    }

    const audio = getPlaybackAudio();
    if (!audio) {
      setReady(false);
      return;
    }

    if (audioRef.current === audio && analyserRef.current) {
      setReady(true);
      return;
    }

    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) {
      setReady(false);
      return;
    }

    try {
      if (!ctxRef.current || ctxRef.current.state === "closed") {
        ctxRef.current = new Ctor();
      }
      const ctx = ctxRef.current;
      if (!sourceRef.current || audioRef.current !== audio) {
        sourceRef.current = ctx.createMediaElementSource(audio);
        audioRef.current = audio;
      }
      if (!analyserRef.current) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;
        analyserRef.current = analyser;
        sourceRef.current.connect(analyser);
        analyser.connect(ctx.destination);
      }
      if (ctx.state === "suspended") {
        void ctx.resume();
      }
      setReady(true);
    } catch {
      setReady(false);
    }

    return () => {
      setReady(false);
    };
  }, [active]);

  useEffect(() => {
    return () => {
      try {
        sourceRef.current?.disconnect();
        analyserRef.current?.disconnect();
      } catch {
        // ignore
      }
      sourceRef.current = null;
      analyserRef.current = null;
      audioRef.current = null;
      if (ctxRef.current && ctxRef.current.state !== "closed") {
        void ctxRef.current.close();
      }
      ctxRef.current = null;
    };
  }, []);

  const getFrequencyBins = useCallback(
    (target?: Uint8Array<ArrayBuffer>) => {
      const analyser = analyserRef.current;
      const size = analyser?.frequencyBinCount ?? 128;
      const out =
        target && target.length >= size
          ? target
          : new Uint8Array(new ArrayBuffer(size));
      if (!analyser || !ready) {
        out.fill(0);
        return out;
      }
      analyser.getByteFrequencyData(out);
      return out;
    },
    [ready],
  );

  return {
    ready,
    getFrequencyBins,
    binCount: analyserRef.current?.frequencyBinCount ?? 128,
  };
}
