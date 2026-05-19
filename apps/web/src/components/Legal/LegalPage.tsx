/**
 * Privacy / Terms pages — reachable at /privacy and /terms.
 *
 * Layout/typography is owned here. The legal *substance* (third-party
 * processors, MIT reference, etc.) is intentionally preserved verbatim
 * from the previous version to avoid silent legal drift.
 */

import { useEffect } from "react";
import { Link } from "react-router-dom";

export type LegalKind = "privacy" | "terms";

export function LegalPage({ kind }: { kind: LegalKind }) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title =
      kind === "privacy" ? "Privacy — Seneca" : "Terms — Seneca";
    return () => {
      document.title = previous;
    };
  }, [kind]);

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-5 py-12 sm:px-8 md:py-16">
      <Link
        to="/"
        aria-label="Back to home"
        className="group mb-8 inline-flex w-fit items-center gap-2 rounded-md text-sm font-medium text-fg-muted transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <span
          aria-hidden
          className="inline-block transition-transform group-hover:-translate-x-0.5"
        >
          ←
        </span>
        Back to home
      </Link>

      <article className="card relative overflow-hidden p-8 md:p-12">
        <span
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-accent/10 blur-3xl"
        />
        <header className="mb-8 border-b border-border/70 pb-6">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            {kind === "privacy" ? "Privacy notice" : "Terms"}
          </p>
          <h1 className="mt-3 font-serif text-4xl leading-tight text-fg">
            {kind === "privacy" ? "Privacy" : "Terms of Service"}
          </h1>
        </header>

        <div className="prose prose-stone max-w-none text-fg [&_a]:text-accent [&_a]:underline-offset-4 hover:[&_a]:underline [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:text-fg [&_li]:text-fg-muted [&_p]:text-fg-muted [&_strong]:text-fg dark:prose-invert">
          {kind === "privacy" ? <PrivacyBody /> : <TermsBody />}
        </div>
      </article>
    </div>
  );
}

function PrivacyBody() {
  return (
    <>
      <p>
        Seneca is designed to keep your conversations on infrastructure you
        control. Specifically:
      </p>
      <ul className="mt-4 list-disc space-y-2 pl-5">
        <li>
          Your account and session data are stored in <strong>your</strong>{" "}
          Supabase project (or in the API's in-memory store when running in
          dev-bypass mode). The maintainers of Seneca never see them.
        </li>
        <li>
          Conversation turns are sent to{" "}
          <a
            href="https://www.anthropic.com/legal/privacy"
            target="_blank"
            rel="noreferrer noopener"
          >
            Anthropic
          </a>{" "}
          for inference. Anthropic's API does not train on traffic by default.
        </li>
        <li>
          When you opt into ElevenLabs voices, the text you ask Seneca to speak
          is sent to{" "}
          <a
            href="https://elevenlabs.io/privacy"
            target="_blank"
            rel="noreferrer noopener"
          >
            ElevenLabs
          </a>{" "}
          to synthesise audio. Disable the premium voice in Settings to keep
          all TTS in your browser.
        </li>
        <li>
          When you upload a document, the extracted text is sent to{" "}
          <a
            href="https://docs.voyageai.com/docs/privacy-policy"
            target="_blank"
            rel="noreferrer noopener"
          >
            Voyage AI
          </a>{" "}
          for embedding, but only if you've configured a Voyage key. Without
          one, document search runs as a substring scan locally.
        </li>
        <li>
          When you open a URL in the Web tab, the URL (not your conversation)
          is sent through your Seneca API, which fetches the page server-side.
          Tavily is only touched if you've configured a Tavily key and click
          "Search".
        </li>
        <li>
          Microphone audio is processed entirely in your browser via the Web
          Speech API. Seneca's servers never receive raw audio.
        </li>
      </ul>
      <p className="mt-6">
        This is a personal-use project; you are the operator and you are the
        data controller. If you deploy Seneca for others, you are responsible
        for any additional notices or consents your jurisdiction requires.
      </p>
    </>
  );
}

function TermsBody() {
  return (
    <>
      <p>
        Seneca is open-source software released under the MIT license. You may
        run, copy, modify, and redistribute it, including for commercial use.
      </p>
      <p className="mt-4">
        The software is provided <em>as-is</em>, without warranty of any kind.
        The maintainers are not liable for the cost of upstream API usage you
        incur or for any consequence of decisions you make based on Seneca's
        output. Verify anything important before acting on it.
      </p>
      <p className="mt-4">
        By using a deployed instance of Seneca, you also accept the terms of
        any third-party services it integrates with: Anthropic, Supabase, and
        (optionally) ElevenLabs, Voyage AI, and Tavily. Their links live on
        the Privacy page.
      </p>
      <p className="mt-6 text-sm text-fg-subtle">
        Full license text:{" "}
        <a
          href="https://github.com/aaronpk-seneca/repo/blob/main/LICENSE"
          target="_blank"
          rel="noreferrer noopener"
        >
          LICENSE
        </a>
        .
      </p>
    </>
  );
}
