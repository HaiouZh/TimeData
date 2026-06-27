import { useAppUpdate } from "../appUpdate.tsx";

export default function AppUpdatePrompt() {
  const { needRefresh, updateApp, dismissUpdate } = useAppUpdate();

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-lg rounded-xl border border-accent/40 bg-surface-elevated p-4 shadow-elev2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-ink">发现新版本</div>
          <div className="mt-1 text-xs text-ink-2">点击更新后会刷新页面并加载最新代码。</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={dismissUpdate}
            className="rounded border border-border bg-surface px-3 py-1.5 text-xs text-ink-2 hover:bg-surface-hover"
          >
            稍后
          </button>
          <button
            onClick={updateApp}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-page hover:bg-accent-strong"
          >
            立即更新
          </button>
        </div>
      </div>
    </div>
  );
}
