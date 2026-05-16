import { useAppUpdate } from "../appUpdate.tsx";

export default function AppUpdatePrompt() {
  const { needRefresh, updateApp, dismissUpdate } = useAppUpdate();

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-lg rounded-xl border border-blue-500/40 bg-slate-900 p-4 shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-100">发现新版本</div>
          <div className="mt-1 text-xs text-slate-400">点击更新后会刷新页面并加载最新代码。</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={dismissUpdate} className="rounded bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700">稍后</button>
          <button onClick={updateApp} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">立即更新</button>
        </div>
      </div>
    </div>
  );
}
