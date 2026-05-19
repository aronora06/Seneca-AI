import { lazy, Suspense } from "react";

import { BootSplash } from "../components/BootSplash";
import { GlobalShortcuts } from "../components/KeyboardShortcuts/GlobalShortcuts";

const AppShell = lazy(() =>
  import("../components/AppShell").then((m) => ({ default: m.AppShell })),
);

export function AppWorkspace() {
  return (
    <Suspense fallback={<BootSplash />}>
      <GlobalShortcuts />
      <AppShell />
    </Suspense>
  );
}
