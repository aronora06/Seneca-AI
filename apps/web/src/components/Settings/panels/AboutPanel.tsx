import { PanelIntro, Section } from "./_shared";

const VERSION = "0.1.0";

const LINKS: Array<{ label: string; href: string }> = [
  { label: "Project vision",       href: "https://github.com" },
  { label: "Documentation",        href: "https://github.com" },
  { label: "Report a bug",         href: "https://github.com" },
  { label: "Request a feature",    href: "https://github.com" },
];

export function AboutPanel() {
  return (
    <>
      <PanelIntro description="A little about Seneca and where to go for help." />

      <div className="mb-5 rounded-lg border border-border bg-card/60 p-5">
        <p className="font-serif text-2xl text-fg">Seneca</p>
        <p className="mt-1 text-sm text-fg-muted">
          A voice-driven AI interlocutor with a shared interactive canvas.
        </p>
        <p className="mt-3 text-xs text-fg-subtle">
          Version {VERSION} • Built with React, Tailwind, and Anthropic Claude
        </p>
      </div>

      <Section label="The character of Seneca">
        <p className="text-sm text-fg-muted">
          Seneca takes inspiration from Lucius Annaeus Seneca the Younger —
          Roman Stoic, patient correspondent, philosophical mentor. Warm,
          rigorous, comfortable with hard questions. He thinks alongside you
          rather than performing expertise at you.
        </p>
      </Section>

      <Section label="Resources">
        <ul className="space-y-1.5">
          {LINKS.map((link) => (
            <li key={link.label}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent underline-offset-2 hover:underline"
              >
                {link.label}
                <span aria-hidden className="ml-1 text-fg-subtle">→</span>
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section label="Status">
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <span className="h-2 w-2 rounded-full bg-ok" />
          <span>Status indicator lives in the header — green dot means the API is reachable.</span>
        </div>
      </Section>
    </>
  );
}
