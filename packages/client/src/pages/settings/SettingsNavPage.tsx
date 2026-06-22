import { Switch } from "../../components/ui/Switch.js";
import { CONFIGURABLE_TABS, setVisibleTabs, useVisibleTabs, type ConfigurableTab } from "../../lib/settings/navVisibleTabsSetting.js";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

const TAB_LABELS: Record<ConfigurableTab, string> = {
  "/quick-notes": "记录",
  "/": "时间轴",
  "/todo": "待办",
  "/tracks": "轨道",
  "/goals": "目标",
  "/stats/time": "时间",
  "/stats/health": "健康",
};

export function SettingsNavPage() {
  const visibleTabs = useVisibleTabs();
  const visibleSet = new Set(visibleTabs);

  function toggle(tab: ConfigurableTab) {
    const next = new Set(visibleTabs);
    if (next.has(tab)) next.delete(tab);
    else next.add(tab);
    void setVisibleTabs(CONFIGURABLE_TABS.filter((item) => next.has(item)));
  }

  return (
    <SettingsDetailPage title="底部导航">
      <section className="space-y-2">
        {CONFIGURABLE_TABS.map((tab) => (
          <label
            key={tab}
            className="flex min-h-12 items-center justify-between rounded-lg border border-slate-800 bg-slate-900/70 px-4 text-sm text-slate-100"
          >
            <span>{TAB_LABELS[tab]}</span>
            <Switch ariaLabel={TAB_LABELS[tab]} checked={visibleSet.has(tab)} onChange={() => toggle(tab)} />
          </label>
        ))}
      </section>
    </SettingsDetailPage>
  );
}
