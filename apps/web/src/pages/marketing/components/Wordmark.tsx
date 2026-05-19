interface WordmarkProps {
  className?: string;
}

/**
 * Seneca wordmark — a small ember dot beside the serif name. Themeable
 * via currentColor so it inherits header text color.
 */
export function Wordmark({ className }: WordmarkProps) {
  return (
    <span
      className={["inline-flex items-baseline gap-2", className]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 translate-y-[-2px] rounded-full bg-accent shadow-[0_0_0_2px_rgb(var(--c-accent)/0.18)]"
      />
      <span className="font-serif text-[1.55rem] leading-none tracking-tight">
        Seneca
      </span>
    </span>
  );
}
