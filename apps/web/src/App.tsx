import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { LoginPage } from "./auth/LoginPage";
import { AppShell } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { hasSupabaseEnv } from "./lib/supabase";
import { devBypassAuth } from "./lib/devBypass";
import { ThemeProvider } from "./theme/ThemeProvider";

export function App() {
  return (
    <ThemeProvider>
      {!devBypassAuth && !hasSupabaseEnv() ? (
        <MissingEnv />
      ) : (
        <ErrorBoundary>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </ErrorBoundary>
      )}
    </ThemeProvider>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <BootSplash />;
  if (!user) return <LoginPage />;
  return <AppShell />;
}

function BootSplash() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="font-serif text-2xl text-fg-muted">Loading…</div>
    </div>
  );
}

function MissingEnv() {
  return (
    <main className="flex min-h-full items-center justify-center px-6 py-10">
      <div className="card max-w-lg p-6">
        <h1 className="font-serif text-2xl text-fg">Configuration needed</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Seneca couldn't find your Supabase credentials. You have two options:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-fg-muted">
          <li>
            <strong>Fastest:</strong> set{" "}
            <code className="rounded bg-surface-sunk px-1 py-0.5 text-xs">
              VITE_DEV_BYPASS_AUTH=true
            </code>{" "}
            in{" "}
            <code className="rounded bg-surface-sunk px-1 py-0.5 text-xs">
              apps/web/.env
            </code>{" "}
            and{" "}
            <code className="rounded bg-surface-sunk px-1 py-0.5 text-xs">
              DEV_BYPASS_AUTH=true
            </code>{" "}
            in{" "}
            <code className="rounded bg-surface-sunk px-1 py-0.5 text-xs">
              apps/api/.env
            </code>{" "}
            to skip auth during dev.
          </li>
          <li>
            <strong>Real auth:</strong> fill in{" "}
            <code className="rounded bg-surface-sunk px-1 py-0.5 text-xs">
              VITE_SUPABASE_URL
            </code>{" "}
            and{" "}
            <code className="rounded bg-surface-sunk px-1 py-0.5 text-xs">
              VITE_SUPABASE_ANON_KEY
            </code>
            . See <code>docs/setup.md</code>.
          </li>
        </ul>
        <p className="mt-3 text-xs text-fg-subtle">
          After updating the file, restart{" "}
          <code className="rounded bg-surface-sunk px-1 py-0.5">pnpm dev</code>.
        </p>
      </div>
    </main>
  );
}
