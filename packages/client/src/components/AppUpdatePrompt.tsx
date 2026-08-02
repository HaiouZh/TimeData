import { useAppUpdate } from "../appUpdate.tsx";

export default function AppUpdatePrompt() {
  const { needRefresh, updateApp, dismissUpdate } = useAppUpdate();

  if (!needRefresh) return null;

  return (
    <div
      className="fixed inset-x-3 z-[var(--z-modal)] mx-auto max-w-lg rounded-card border border-accent/40 bg-surface-elevated p-4 shadow-elev2 bottom-20"
      // bottom-20 是 env() 未定义环境（Firefox 桌面 / 旧 WebView）下 calc 失效时的兜底，与 calc 同值；
      // env() 有效时内联样式优先。
      style={{ bottom: "calc(5rem + var(--safe-bottom))" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="td-text-label font-medium text-ink">发现新版本</div>
          <div className="mt-1 td-text-caption text-ink-2">点击更新后会刷新页面并加载最新代码。</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={dismissUpdate}
            className="rounded border border-border bg-surface px-3 py-1.5 td-text-caption text-ink-2 hover:bg-surface-hover"
          >
            稍后
          </button>
          <button
            onClick={updateApp}
            className="rounded bg-accent px-3 py-1.5 td-text-caption font-medium text-page hover:bg-accent-strong"
          >
            立即更新
          </button>
        </div>
      </div>
    </div>
  );
}
