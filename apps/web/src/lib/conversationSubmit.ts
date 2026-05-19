/**
 * Conversation Mode — deferred submit after VAD onSpeechEnd.
 *
 * Waits for a short tail (recognizer finals) then polls until STT interim
 * is empty so we don't submit before the textarea has the full utterance.
 */

export const VAD_SUBMIT_TAIL_MS = 280;
export const STT_INTERIM_POLL_MS = 50;
export const STT_INTERIM_MAX_WAIT_MS = 800;

export interface ConversationSubmitTimer {
  current: number | null;
}

export function cancelConversationModeSubmit(
  timer: ConversationSubmitTimer,
): void {
  if (timer.current !== null) {
    window.clearTimeout(timer.current);
    timer.current = null;
  }
}

export function scheduleConversationModeSubmit(opts: {
  getPendingText: () => string;
  getSttInterim: () => string;
  submit: (text: string) => void;
  timer: ConversationSubmitTimer;
}): void {
  cancelConversationModeSubmit(opts.timer);

  const startedAt = Date.now();

  const attempt = () => {
    const interim = opts.getSttInterim().trim();
    if (
      interim.length > 0 &&
      Date.now() - startedAt < STT_INTERIM_MAX_WAIT_MS
    ) {
      opts.timer.current = window.setTimeout(
        attempt,
        STT_INTERIM_POLL_MS,
      );
      return;
    }
    opts.timer.current = null;
    const pending = opts.getPendingText().trim();
    if (!pending) return;
    opts.submit(pending);
  };

  opts.timer.current = window.setTimeout(attempt, VAD_SUBMIT_TAIL_MS);
}
