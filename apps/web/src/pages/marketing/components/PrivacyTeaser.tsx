import { Link } from "react-router-dom";

import { Reveal } from "./Reveal";

export function PrivacyTeaser() {
  return (
    <section
      className="border-t border-border/60 bg-surface-sunk/50"
      aria-labelledby="privacy-teaser-heading"
    >
      <Reveal className="mx-auto max-w-5xl px-5 py-16 sm:px-8 md:py-20">
        <div className="grid gap-8 md:grid-cols-[1fr_1.4fr] md:items-start md:gap-12">
          <div>
            <span className="marketing-rule">Your stack</span>
            <h2
              id="privacy-teaser-heading"
              className="mt-5 font-serif text-2xl text-fg sm:text-3xl"
            >
              Conversations stay on infrastructure you control.
            </h2>
          </div>
          <div className="text-base leading-relaxed text-fg-muted">
            <p>
              Sessions live in your Supabase project. Conversation turns are
              sent to Anthropic for inference; ElevenLabs, Voyage, and Tavily
              are optional and only touched when you configure them.
            </p>
            <p className="mt-4">
              <Link
                to="/privacy"
                className="font-medium text-accent underline-offset-4 hover:underline focus:outline-none focus-visible:underline"
              >
                Read the privacy notice
                <span aria-hidden className="ml-1">
                  →
                </span>
              </Link>
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
