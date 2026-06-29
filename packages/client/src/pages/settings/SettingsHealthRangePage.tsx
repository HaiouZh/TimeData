import { useMemo } from "react";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { useSetting, setSetting } from "../../lib/settings/index.ts";
import {
  HEALTH_RANGE_PRESETS,
  HEALTH_RANGE_PRESETS_KEY,
  parseHealthRangePresets,
  rangeLabel,
  type HealthRangePreset,
} from "../../lib/settings/healthRangeSetting.ts";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

export default function SettingsHealthRangePage() {
  const raw = useSetting(HEALTH_RANGE_PRESETS_KEY);
  const selected = useMemo(() => new Set(parseHealthRangePresets(raw)), [raw]);

  async function toggle(preset: HealthRangePreset) {
    const next = new Set(selected);
    if (next.has(preset)) next.delete(preset);
    else next.add(preset);
    const ordered = HEALTH_RANGE_PRESETS.filter((item) => next.has(item));
    await setSetting(HEALTH_RANGE_PRESETS_KEY, ordered.length > 0 ? ordered.join(",") : null);
  }

  return (
    <SettingsDetailPage title="健康范围">
      <section className="space-y-3">
        <p className="px-1 text-xs leading-relaxed text-ink-3">选择健康统计页顶部显示哪些时间范围。</p>
        <ul className="space-y-2">
          {HEALTH_RANGE_PRESETS.map((preset) => (
            <li key={preset} className="rounded-card border border-border bg-surface p-3">
              <Checkbox
                ariaLabel={rangeLabel(preset)}
                label={rangeLabel(preset)}
                checked={selected.has(preset)}
                onChange={() => toggle(preset)}
                className="w-full justify-between"
              />
            </li>
          ))}
        </ul>
      </section>
    </SettingsDetailPage>
  );
}
