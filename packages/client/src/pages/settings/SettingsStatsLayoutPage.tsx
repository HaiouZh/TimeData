import { useStatsLayout } from "../../lib/statsLayoutSetting.ts";
import { STATS_MODULE_LIST, STATS_MODULES } from "../stats/modules/statsModules.ts";
import type { StatsModuleId } from "../stats/modules/types.ts";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

export default function SettingsStatsLayoutPage() {
  const { order, hidden, setLayout, reset } = useStatsLayout(STATS_MODULE_LIST);

  const toggle = (id: StatsModuleId) => {
    const nextHidden = new Set(hidden);
    if (nextHidden.has(id)) nextHidden.delete(id);
    else nextHidden.add(id);
    setLayout({ order, hidden: order.filter((item) => nextHidden.has(item)) });
  };

  const move = (id: StatsModuleId, direction: -1 | 1) => {
    const index = order.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    const nextOrder = [...order];
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
    setLayout({ order: nextOrder, hidden: nextOrder.filter((item) => hidden.has(item)) });
  };

  return (
    <SettingsDetailPage title="统计页面布局">
      <section className="space-y-3">
        <p className="px-1 text-xs leading-relaxed text-slate-500">调整统计页各模块的显示与顺序，设置会跨设备同步。</p>
        <ul className="space-y-2">
          {order.map((id, index) => {
            const module = STATS_MODULES[id];
            const isHidden = hidden.has(id);
            return (
              <li key={id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-100">{module.title}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{module.description}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!isHidden}
                    aria-label={`显示 ${module.title}`}
                    onClick={() => toggle(id)}
                    className={`h-7 w-12 shrink-0 rounded-full p-0.5 transition ${
                      isHidden ? "bg-slate-700" : "bg-sky-500"
                    }`}
                  >
                    <span
                      className={`block h-6 w-6 rounded-full bg-white transition ${
                        isHidden ? "translate-x-0" : "translate-x-5"
                      }`}
                    />
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    aria-label={`上移 ${module.title}`}
                    disabled={index === 0}
                    onClick={() => move(id, -1)}
                    className="min-h-9 rounded-full border border-slate-700 bg-slate-900 px-3 text-xs text-slate-300 disabled:opacity-30"
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    aria-label={`下移 ${module.title}`}
                    disabled={index === order.length - 1}
                    onClick={() => move(id, 1)}
                    className="min-h-9 rounded-full border border-slate-700 bg-slate-900 px-3 text-xs text-slate-300 disabled:opacity-30"
                  >
                    下移
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <button
        type="button"
        onClick={reset}
        className="min-h-11 w-full rounded-full border border-slate-700 bg-slate-900 text-sm text-slate-300"
      >
        重置默认布局
      </button>
    </SettingsDetailPage>
  );
}
