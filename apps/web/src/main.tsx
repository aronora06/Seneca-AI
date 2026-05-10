import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element in index.html");

// NOTE: We intentionally don't wrap in <StrictMode>. Excalidraw 0.18 uses
// useSyncExternalStore internally, and its store fires updates during the
// effect-cleanup phase that StrictMode's double-mount triggers, which then
// throws "Maximum update depth exceeded" on every page load. Removing
// StrictMode is the standard workaround until the upstream fix lands.
// Reintroduce it for the parts of the tree that don't include Excalidraw
// once we have time to wrap that subtree separately.

// Surface uncaught errors in the DOM so a blank page is impossible.
window.addEventListener("error", (e) => {
  console.error("[seneca] window error:", e.error ?? e.message);
  showFatalError(e.error?.stack ?? e.message ?? "Unknown error");
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[seneca] unhandled rejection:", e.reason);
  showFatalError(
    e.reason?.stack ?? String(e.reason ?? "Unhandled promise rejection"),
  );
});

function showFatalError(message: string): void {
  if (root && root.childNodes.length === 0) {
    root.innerHTML = `<div style="font-family: ui-sans-serif, system-ui; padding: 24px; max-width: 720px; margin: 40px auto; background: #fff7f0; border: 1px solid #f4c089; border-radius: 8px; color: #4d3f2d; line-height: 1.5;">
      <h1 style="margin: 0 0 8px; font-size: 18px; font-weight: 600;">Seneca couldn't render the app</h1>
      <p style="margin: 0 0 12px; font-size: 14px;">A runtime error stopped the page from mounting. Open DevTools → Console for the full trace, or share the message below with the dev.</p>
      <pre style="white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; background: #fdebd0; padding: 12px; border-radius: 4px; margin: 0;">${escapeHtml(message)}</pre>
    </div>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

try {
  createRoot(root).render(<App />);
} catch (err) {
  console.error("[seneca] createRoot failed:", err);
  showFatalError(
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  );
}
