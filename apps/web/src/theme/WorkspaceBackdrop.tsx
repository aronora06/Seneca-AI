/**
 * Background texture layer for the signed-in workspace. Lives inside
 * AppShell (not fixed behind #root) so patterns sit directly under the
 * voice pane and canvas, which use translucent surfaces.
 */

import { useTheme } from "./ThemeProvider";

export function WorkspaceBackdrop() {
  const { backgroundStyle } = useTheme();

  return (
    <div
      id="app-backdrop"
      aria-hidden
      className="app-backdrop pointer-events-none absolute inset-0 z-0"
      {...(backgroundStyle !== "gradient" ? { "data-bg": backgroundStyle } : {})}
    />
  );
}
