import { findMainNavItem } from "../../lib/navigation/navRegistry.js";
import { CONFIGURABLE_TABS, useVisibleTabs } from "../../lib/settings/navVisibleTabsSetting.js";
import { Icon } from "../../components/Icon.js";
import SettingsDetailPage from "./SettingsDetailPage.tsx";
import { SettingsRow, SettingsSection } from "./components/SettingsRows.js";

export default function SettingsMorePage() {
  const visibleTabs = useVisibleTabs();
  const visibleSet = new Set(visibleTabs);
  const hiddenItems = CONFIGURABLE_TABS.filter((route) => !visibleSet.has(route))
    .map((route) => findMainNavItem(route))
    .filter((item) => item !== undefined);

  return (
    <SettingsDetailPage title="更多功能">
      {hiddenItems.length > 0 ? (
        <SettingsSection title="未显示在手机底栏">
          {hiddenItems.map((item) => (
            <SettingsRow
              key={item.to}
              to={item.to}
              icon={<Icon icon={item.icon} size={20} />}
              title={item.ariaLabel}
            />
          ))}
        </SettingsSection>
      ) : (
        <div className="td-text-label rounded-card border border-border bg-surface p-4 text-ink-3">
          所有功能都已显示在手机底栏。
        </div>
      )}
    </SettingsDetailPage>
  );
}
