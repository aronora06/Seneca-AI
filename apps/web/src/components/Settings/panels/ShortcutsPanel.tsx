import { PanelIntro } from "./_shared";

const SHORTCUTS: Array<{ keys: string; desc: string }> = [
  { keys: "Enter",            desc: "Send message" },
  { keys: "Shift + Enter",    desc: "New line in message" },
  { keys: "Click eye icon",   desc: "Toggle vision (single shot)" },
  { keys: "Shift + click eye", desc: "Pin vision on" },
  { keys: "Escape",           desc: "Close settings / menus" },
];

export function ShortcutsPanel() {
  return (
    <>
      <PanelIntro description="Keyboard shortcuts available throughout Seneca." />

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-sunk/50">
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">
                Shortcut
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  <kbd className="rounded border border-border bg-surface-sunk px-1.5 py-0.5 font-mono text-xs text-fg-muted">
                    {s.keys}
                  </kbd>
                </td>
                <td className="px-4 py-2 text-fg-muted">{s.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
