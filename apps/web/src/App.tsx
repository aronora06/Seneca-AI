import { RouterProvider } from "react-router-dom";

import { AuthProvider } from "./auth/AuthProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ShortcutOverlay } from "./components/KeyboardShortcuts/ShortcutOverlay";
import { ToastViewport } from "./components/Toast/ToastViewport";
import { router } from "./routes/router";
import { ThemeProvider } from "./theme/ThemeProvider";

export function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ErrorBoundary>
      <ToastViewport />
      <ShortcutOverlay />
    </ThemeProvider>
  );
}
