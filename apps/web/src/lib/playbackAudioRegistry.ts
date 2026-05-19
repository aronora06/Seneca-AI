/**
 * Lets playback analysers tap the ElevenLabs hidden <audio> element without
 * threading refs through useSpeech.
 */

let playbackAudio: HTMLAudioElement | null = null;

export function registerPlaybackAudio(el: HTMLAudioElement | null): void {
  playbackAudio = el;
}

export function getPlaybackAudio(): HTMLAudioElement | null {
  return playbackAudio;
}
