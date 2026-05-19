/**
 * Centralised marketing copy. Keep tone consistent: editorial, warm,
 * confident — patient mentor, not startup-generic.
 */

export const SITE = {
  name: "Seneca",
  tagline: "A voice you talk with, on a canvas you both use.",
  shortBlurb:
    "Voice-driven conversation with a shared whiteboard, diagrams, maps, documents, and the web — together in one workspace.",
  footer: "Voice and a shared canvas — together, not in tabs.",
} as const;

export const HERO = {
  eyebrow: "Voice + canvas, together",
  headline: "A voice you talk with, on a canvas you both use.",
  subhead:
    "Seneca is a voice-driven interlocutor with a shared workspace. Whiteboard, diagrams, maps, documents, and the web — explored out loud, side by side.",
  primaryCta: "Get started",
  primaryCtaBypass: "Open workspace",
  secondaryCta: "How it works",
  proof: "Talk while you sketch. Read while you discuss. Share the same room.",
} as const;

export const FEATURES = [
  {
    id: "voice",
    title: "Talk while you work",
    body: "Voice runs continuously alongside the canvas. Push-to-talk, hands-free conversation, or type when you prefer — no detour to a chat sidebar.",
  },
  {
    id: "canvas",
    title: "A canvas you both use",
    body: "Whiteboard, diagrams, map, documents, web — one workspace. Seneca can draw, navigate, and reference what you have open. So can you.",
  },
  {
    id: "documents",
    title: "Grounded in your materials",
    body: "Upload PDFs and notes, search semantically across them, and study with Seneca citing the pages and passages that matter.",
  },
  {
    id: "vision",
    title: "Vision when you want it",
    body: "Toggle whether Seneca sees the active tab. Off by default — costs stay low; structured workspace context still keeps Seneca oriented.",
  },
] as const;

export const USE_CASES = [
  {
    id: "philosophy",
    kicker: "Philosophy",
    title: "Spinoza on the whiteboard",
    body: "Open a passage, sketch the geometric structure of an argument, and talk through it without leaving the conversation.",
  },
  {
    id: "geopolitics",
    kicker: "Maps & analysis",
    title: "A walk through the Caspian",
    body: "Fly the map, drop pins, surface recent reporting on the web tab, and discuss the dynamics aloud.",
  },
  {
    id: "study",
    kicker: "Document study",
    title: "Reading a paper, together",
    body: "Drag a PDF in, ask questions, jump to a page, and let Seneca cite the section in the margin.",
  },
] as const;

export const STEPS = [
  {
    step: "01",
    title: "Open a session",
    body: "Sign in, create a session. Your transcript, canvas state, and uploads persist across visits — pick up where you left off.",
  },
  {
    step: "02",
    title: "Talk or type",
    body: "Use the voice pane for push-to-talk or hands-free conversation, or type in the input when you want precision.",
  },
  {
    step: "03",
    title: "Share the canvas",
    body: "Switch tabs for whiteboard, diagrams, map, documents, or web. Seneca can act on what you have open — and you can interrupt anytime.",
  },
  {
    step: "04",
    title: "Choose what Seneca sees",
    body: "Turn vision on for a snapshot of the active tab, or rely on structured workspace context when you want to save tokens.",
  },
] as const;

export const ABOUT = {
  eyebrow: "About Seneca",
  headline: "Inspired by a patient correspondent.",
  subhead:
    "Seneca takes its name from Lucius Annaeus Seneca the Younger — Roman Stoic, philosophical mentor, careful letter-writer. Warm, rigorous, comfortable with hard questions. He thinks alongside you rather than performing expertise at you.",
  closingTitle: "Built for self-directed learning",
  closingBody:
    "The MVP is shaped for one curious person at a desk: philosophy dialogue with sketches on the board, geopolitical walkthroughs on the map, or working through an uploaded paper together — without leaving the conversation.",
} as const;

export const CTA_BAND = {
  eyebrow: "Try it",
  headline: "Sit down, open a session, start a conversation.",
  body: "Bring your own questions and your own materials. Seneca brings the room.",
} as const;

export const PRICING = {
  eyebrow: "Pricing",
  headline: "Honest about costs.",
  subhead:
    "Seneca is open source under the MIT license. The software is free. You pay for the inference — directly, on your own accounts.",
} as const;

export const PRICING_PLANS = [
  {
    id: "self-host",
    name: "Self-host",
    price: "Free",
    priceNote: "MIT licensed",
    summary:
      "The default. Clone the repository, bring your own keys, run it on your laptop or deploy to Vercel + Railway.",
    bullets: [
      "Full source on GitHub",
      "Bring your own Anthropic and Supabase keys",
      "Optional: ElevenLabs, Voyage, Tavily",
      "All data stays on infrastructure you control",
    ],
    ctaLabel: "Read the setup guide",
    ctaHref: "https://github.com",
    ctaExternal: true,
    featured: true,
  },
  {
    id: "hosted",
    name: "Hosted",
    price: "Coming",
    priceNote: "preview list",
    summary:
      "A managed deployment for people who'd rather not run servers — still uses your keys for inference.",
    bullets: [
      "Single-click setup",
      "Same data ownership model",
      "Email me when this opens",
    ],
    ctaLabel: "Notify me",
    ctaHref: "mailto:hello@seneca.local?subject=Seneca%20hosted%20preview",
    ctaExternal: true,
    featured: false,
  },
  {
    id: "custom",
    name: "Custom",
    price: "Talk",
    priceNote: "by request",
    summary:
      "Need help deploying Seneca for a class, lab, or small team? I'm happy to scope a one-off engagement.",
    bullets: [
      "Bespoke deployment + persona",
      "Domain-specific tools and prompts",
      "Direct support during setup",
    ],
    ctaLabel: "Get in touch",
    ctaHref: "mailto:hello@seneca.local?subject=Seneca%20custom%20deployment",
    ctaExternal: true,
    featured: false,
  },
] as const;

export const PRICING_COSTS = [
  {
    id: "anthropic",
    name: "Anthropic Claude",
    role: "Required",
    summary: "Pay-per-token. Sonnet for short turns, Opus for hard reasoning.",
    estimate: "~$5–50 / month",
    href: "https://www.anthropic.com/pricing",
  },
  {
    id: "supabase",
    name: "Supabase",
    role: "Required",
    summary:
      "Postgres, auth, and storage. The free tier is comfortable for one learner.",
    estimate: "$0",
    href: "https://supabase.com/pricing",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    role: "Optional",
    summary:
      "Studio-quality TTS. Browser TTS works without it; switch in Settings.",
    estimate: "from $5 / month",
    href: "https://elevenlabs.io/pricing",
  },
  {
    id: "voyage",
    name: "Voyage AI",
    role: "Optional",
    summary:
      "Embeddings for semantic document search. Without it, search is local substring.",
    estimate: "pennies per doc",
    href: "https://docs.voyageai.com/docs/pricing",
  },
  {
    id: "tavily",
    name: "Tavily",
    role: "Optional",
    summary:
      "Clean web-search results when Seneca needs to look something up.",
    estimate: "free up to 1k queries / mo",
    href: "https://tavily.com/#pricing",
  },
] as const;

export const PRICING_FAQ = [
  {
    q: "Why is the software free?",
    a: "Seneca is a personal-use project shared as open source under the MIT license. You can copy it, modify it, and deploy it for yourself or others.",
  },
  {
    q: "What does an hour of conversation actually cost?",
    a: "On Sonnet, a focused 30-minute exchange with vision off lands around $0.20–$0.50. With vision pinned on or Opus enabled for deep reasoning, expect $1–$2 per hour.",
  },
  {
    q: "Will there be a paid tier?",
    a: "Maybe a managed deployment for people who don't want to run servers, but the local + self-host story will always work and will always cost the same — what you pay your providers, nothing more.",
  },
] as const;
