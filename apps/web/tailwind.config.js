/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Semantic tokens ──────────────────────────────────────────────
        // Use these in components. They auto-switch based on the .dark
        // class on <html>. The CSS variables they reference live in
        // src/index.css.
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-sunk": "rgb(var(--c-surface-sunk) / <alpha-value>)",
        card: "rgb(var(--c-card) / <alpha-value>)",
        border: "rgb(var(--c-border) / <alpha-value>)",
        fg: {
          DEFAULT: "rgb(var(--c-fg) / <alpha-value>)",
          muted: "rgb(var(--c-fg-muted) / <alpha-value>)",
          subtle: "rgb(var(--c-fg-subtle) / <alpha-value>)",
          on: "rgb(var(--c-fg-on) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--c-accent) / <alpha-value>)",
          soft: "rgb(var(--c-accent-soft) / <alpha-value>)",
          fg: "rgb(var(--c-accent-fg) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "rgb(var(--c-danger) / <alpha-value>)",
          soft: "rgb(var(--c-danger-soft) / <alpha-value>)",
          fg: "rgb(var(--c-danger-fg) / <alpha-value>)",
        },
        ok: {
          DEFAULT: "rgb(var(--c-ok) / <alpha-value>)",
          soft: "rgb(var(--c-ok-soft) / <alpha-value>)",
        },

        // ── Raw palette (kept for one-off accents) ───────────────────────
        ink: {
          50: "#f8f6f1",
          100: "#efeae0",
          200: "#dfd6c4",
          300: "#c8baa1",
          400: "#a89373",
          500: "#8a7355",
          600: "#6b573f",
          700: "#4d3f2d",
          800: "#33291d",
          900: "#1a140e",
          950: "#0e0a06",
        },
        ember: {
          400: "#e8b873",
          500: "#d49a47",
          600: "#b27a2a",
        },
      },
      fontFamily: {
        serif: [
          '"Cormorant Garamond"',
          '"Iowan Old Style"',
          '"Apple Garamond"',
          "Georgia",
          "ui-serif",
          "serif",
        ],
        sans: [
          '"Inter"',
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono"',
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      boxShadow: {
        soft: "0 4px 20px -8px rgba(20, 14, 6, 0.25)",
        "soft-dark": "0 4px 20px -8px rgba(0, 0, 0, 0.6)",
      },
    },
  },
  plugins: [],
};
