import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[seneca] React error boundary caught:", error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-full items-center justify-center px-6 py-10">
          <div className="card max-w-2xl p-6">
            <h1 className="font-serif text-2xl text-fg">
              Something broke while rendering
            </h1>
            <p className="mt-2 text-sm text-fg-muted">
              Open the browser console for the full stack trace. The error
              message:
            </p>
            <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-border bg-surface-sunk p-3 font-mono text-xs text-fg">
              {this.state.error.stack ?? this.state.error.message}
            </pre>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={this.reset}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
