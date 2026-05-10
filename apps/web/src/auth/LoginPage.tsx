import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";

type Mode = "signin" | "signup";

export function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        await signUp(email, password);
        setInfo(
          "Account created. If email confirmation is enabled in Supabase, check your inbox.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="card w-full max-w-md p-8">
        <header className="mb-6 text-center">
          <h1 className="font-serif text-4xl text-fg">Seneca</h1>
          <p className="mt-2 text-sm text-fg-muted">
            A voice-driven interlocutor with a shared canvas.
          </p>
        </header>

        <div className="mb-6 flex rounded-md border border-border bg-surface-sunk p-1 text-sm">
          <button
            type="button"
            className={`flex-1 rounded px-3 py-1.5 font-medium transition-colors ${
              mode === "signin"
                ? "bg-card text-fg shadow-sm"
                : "text-fg-muted hover:text-fg"
            }`}
            onClick={() => setMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`flex-1 rounded px-3 py-1.5 font-medium transition-colors ${
              mode === "signup"
                ? "bg-card text-fg shadow-sm"
                : "text-fg-muted hover:text-fg"
            }`}
            onClick={() => setMode("signup")}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-muted"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-muted"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          {error && (
            <div
              role="alert"
              className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-fg"
            >
              {error}
            </div>
          )}
          {info && (
            <div
              role="status"
              className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-fg-muted"
            >
              {info}
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting
              ? "Working…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
      </div>
    </main>
  );
}
