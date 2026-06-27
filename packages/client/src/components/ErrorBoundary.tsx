import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  hasError: boolean;
  error?: Error;
}

interface Props {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  override render() {
    if (this.state.hasError) {
      const error = this.state.error || new Error("Unknown error");
      if (this.props.fallback) return this.props.fallback(error);
      return (
        <div className="p-6 space-y-3 text-center text-ink">
          <h1 className="text-lg font-medium">应用出错了</h1>
          <p className="text-xs text-ink-2">{error.message}</p>
          <button
            onClick={() => location.reload()}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-page hover:bg-accent-strong"
          >
            刷新
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
