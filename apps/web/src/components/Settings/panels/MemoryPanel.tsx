import { useState } from "react";

import { PanelIntro, PreviewBanner, Section } from "./_shared";

/**
 * Mock data shaped exactly like the eventual real schema, so swapping
 * to a backed-by-API implementation is a one-file change.
 */
interface MemoryItem {
  id: string;
  category: "preference" | "fact" | "context" | "history";
  text: string;
  createdAt: string;
}

const MOCK_MEMORIES: MemoryItem[] = [
  {
    id: "m1",
    category: "preference",
    text: "Prefers Socratic questioning over direct answers.",
    createdAt: "2 days ago",
  },
  {
    id: "m2",
    category: "context",
    text: "Currently reading Marcus Aurelius's Meditations.",
    createdAt: "5 days ago",
  },
  {
    id: "m3",
    category: "fact",
    text: "Background in software engineering; comfortable with code examples.",
    createdAt: "1 week ago",
  },
  {
    id: "m4",
    category: "preference",
    text: "Prefers concise responses without bullet lists unless asked.",
    createdAt: "1 week ago",
  },
];

const CATEGORY_LABELS: Record<MemoryItem["category"], string> = {
  preference: "Preference",
  fact:       "Fact",
  context:    "Context",
  history:    "History",
};

export function MemoryPanel() {
  const [paused, setPaused] = useState(false);
  const [memories, setMemories] = useState<MemoryItem[]>(MOCK_MEMORIES);

  const removeMemory = (id: string) => {
    setMemories((prev) => prev.filter((m) => m.id !== id));
  };

  const clearAll = () => {
    if (confirm("Clear all memories? This cannot be undone.")) {
      setMemories([]);
    }
  };

  return (
    <>
      <PanelIntro description="Things Seneca has noticed about you across conversations. He uses them to be more helpful." />

      <PreviewBanner>
        Seneca's memory system isn't connected to the backend yet. The list
        below is illustrative — once the <code className="rounded bg-card px-1 py-0.5 text-xs">save_memory</code>{" "}
        tool ships, real memories will appear here for you to review and edit.
      </PreviewBanner>

      <Section label="Memory collection">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={paused}
            onChange={(e) => setPaused(e.target.checked)}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          <span className="text-sm text-fg-muted">
            Pause memory — Seneca won't save anything new until you turn this off.
          </span>
        </label>
      </Section>

      <Section
        label="Saved memories"
        hint={`${memories.length} ${memories.length === 1 ? "memory" : "memories"} saved.`}
      >
        {memories.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface-sunk/40 px-4 py-8 text-center text-sm text-fg-subtle">
            No memories yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {memories.map((m) => (
              <li
                key={m.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-card/50 px-3 py-2.5"
              >
                <div className="flex-1">
                  <p className="text-sm text-fg">{m.text}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-fg-subtle">
                    <span className="rounded-full border border-border px-1.5 py-0.5">
                      {CATEGORY_LABELS[m.category]}
                    </span>
                    <span>{m.createdAt}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeMemory(m.id)}
                  className="text-fg-subtle transition-colors hover:text-danger"
                  aria-label={`Forget memory: ${m.text}`}
                  title="Forget this memory"
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {memories.length > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="btn-soft text-danger"
        >
          Clear all memories
        </button>
      )}
    </>
  );
}
