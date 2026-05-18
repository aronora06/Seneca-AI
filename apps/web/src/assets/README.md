# `src/assets/`

Static media that ships with the Seneca web app — images, illustrations, future fonts, sounds, etc.

These files are **bundled by Vite**: every import is fingerprinted with a content hash and cached aggressively in production. Don't put anything here that needs a stable, predictable URL (favicons, robots.txt, etc.) — those go in `apps/web/public/`.

## Layout

```
src/assets/
├── images/   ← raster + vector visuals used inside the React tree
│   └── hero-background.png    (hero / login landing background)
└── README.md
```

When the asset surface grows, add sibling folders alongside `images/`:

- `fonts/` for self-hosted webfonts.
- `audio/` for notification sounds, etc.
- `lottie/` or `motion/` for JSON-driven animations.

## How to use an image in a component

```tsx
import heroBackground from "../assets/images/hero-background.png";

export function Hero() {
  return (
    <div
      className="h-full w-full bg-cover bg-center"
      style={{ backgroundImage: `url(${heroBackground})` }}
      aria-hidden="true"
    />
  );
}
```

Vite resolves the import to a hashed URL like `/assets/hero-background-a8f2c1d4.png` at build time; in dev it serves the file directly. TypeScript already knows about `*.png` / `*.jpg` / `*.svg` imports because `vite/client` is in `tsconfig.app.json` → `compilerOptions.types`.

## Naming

- **kebab-case** filenames (`hero-background.png`, not `HeroBackground.png` or `hero_background.png`) — matches the directory convention used everywhere else in the repo.
- Be descriptive about purpose, not source: `hero-background` rather than `seneca-hero-page-uuid`.

## When NOT to put something here

- Auth-protected user uploads → those belong in Supabase Storage, not in the bundle.
- Anything > ~500 KB → consider whether the image really needs to ship in the JS bundle, or whether it should live in `public/` (or be loaded from a CDN).
