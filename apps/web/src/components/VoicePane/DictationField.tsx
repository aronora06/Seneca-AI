/**
 * Phase B — textarea + live interim overlay.
 *
 * Renders a controlled `<textarea>` and, when interim STT text is
 * available, paints it as ghost / italic text positioned immediately
 * after the committed text. The overlay is a sibling absolute-
 * positioned div with identical font / padding / wrap rules so the
 * ghost text aligns with the cursor.
 *
 * Layout trick: the overlay renders the committed text inside an
 * `invisible` span (preserving layout) followed by the interim text
 * inside a visible italic / muted span. Because both layers share the
 * same wrapping rules, the interim suffix appears exactly where the
 * cursor would be.
 *
 * Notes:
 *   - The textarea remains the source of truth for what the user will
 *     send. The overlay is purely visual; it never participates in
 *     selection, focus, or input.
 *   - `aria-hidden` on the overlay keeps screen readers from
 *     duplicating the interim text (the live-region status pill in the
 *     pane carries that information instead).
 */
import clsx from "clsx";
import type { ChangeEvent, KeyboardEvent, RefObject } from "react";

interface Props {
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (next: string) => void;
  interim: string;
  disabled: boolean;
  placeholderActive: string;
  placeholderIdle: string;
  onEnter: () => void;
}

export function DictationField(props: Props) {
  const {
    textareaRef,
    value,
    onChange,
    interim,
    disabled,
    placeholderActive,
    placeholderIdle,
    onEnter,
  } = props;

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onEnter();
    }
  };

  const placeholder = disabled ? placeholderActive : placeholderIdle;
  const showInterim = !disabled && interim.length > 0;

  // The shared className keeps the textarea and the overlay in pixel-
  // perfect lockstep so the ghost text lands where the cursor sits.
  const sharedShape =
    "block w-full resize-none whitespace-pre-wrap break-words px-3 py-2 text-sm leading-5";

  return (
    <div className="relative flex-1">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={2}
        disabled={disabled}
        spellCheck
        className={clsx(sharedShape, "input relative z-[1] bg-transparent")}
      />
      {showInterim && (
        <div
          aria-hidden
          data-testid="dictation-interim"
          className={clsx(
            sharedShape,
            "pointer-events-none absolute inset-0 z-0 select-none rounded-md border border-transparent",
            "text-fg",
          )}
        >
          <span className="invisible">{visibleJoiner(value)}</span>
          <span className="italic text-fg-muted/80">{interim}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Mirror the committed text plus a trailing space separator so the
 * visible interim suffix lands one whitespace away from the last
 * committed character. If the committed text already ends in
 * whitespace (or the field is empty), we don't add a separator.
 */
function visibleJoiner(value: string): string {
  if (value.length === 0) return "";
  if (/\s$/.test(value)) return value;
  return `${value} `;
}
