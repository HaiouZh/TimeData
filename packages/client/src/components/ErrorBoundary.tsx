import { Component, type ErrorInfo, type ReactNode } from "react";
import { useRouteError } from "react-router-dom";

interface State {
  hasError: boolean;
  error?: Error;
}

interface Props {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
}

/** 两处兜底 UI 共用的展示组件：应用级 ErrorBoundary 与路由级 errorElement 都渲染它。 */
function ErrorFallbackView({ error }: { error: Error }) {
  return (
    <div className="p-6 space-y-3 text-center text-ink">
      <h1 className="td-text-title">应用出错了</h1>
      <p className="td-text-caption text-ink-2">{error.message}</p>
      <button
        type="button"
        onClick={() => location.reload()}
        className="rounded bg-accent px-4 py-2 td-text-body font-medium text-page hover:bg-accent-strong"
      >
        刷新
      </button>
    </div>
  );
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
      return <ErrorFallbackView error={error} />;
    }

    return this.props.children;
  }
}

/**
 * react-router 的 `_renderMatches` 对根路由（index === 0）总会包一层 `RenderErrorBoundary`；
 * 不提供 `errorElement` 时它落回 RR 自带的 `DefaultErrorComponent`——未翻译英文文案、无样式、
 * 替换整个 shell（含导航栏）。这层 boundary 在 `RouterProvider` 内部，在 App() 里
 * `<ErrorBoundary>` 之下，页面渲染错误会先被它接住、冒不到外层。给根路由挂上这个
 * `errorElement`，用同一套兜底 UI 接住，行为不因迁到 data router 而倒退。
 */
export function RouteErrorFallback() {
  const routeError = useRouteError();
  const error = routeError instanceof Error ? routeError : new Error(String(routeError));
  return <ErrorFallbackView error={error} />;
}
