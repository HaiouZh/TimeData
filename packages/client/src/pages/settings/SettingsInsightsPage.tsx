import { useMemo } from "react";
import { useCategories } from "../../hooks/useCategories.ts";
import { setSleepCategoryId, useSleepCategoryId } from "../../lib/sleepCategorySetting.ts";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

export default function SettingsInsightsPage() {
  const { parentCategories } = useCategories();
  const sleepCategoryId = useSleepCategoryId();
  const selectedName = useMemo(
    () => parentCategories.find((category) => category.id === sleepCategoryId)?.name ?? null,
    [parentCategories, sleepCategoryId],
  );

  return (
    <SettingsDetailPage title="数据洞察">
      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div>
          <h3 className="text-sm font-medium text-slate-100">睡眠分类</h3>
          <p className="mt-1 text-xs text-slate-500">用于作息、覆盖率、异常时段活动和超长记录的睡眠口径。</p>
        </div>
        <select
          aria-label="睡眠分类"
          value={sleepCategoryId ?? ""}
          onChange={(event) => {
            const value = event.target.value || null;
            void setSleepCategoryId(value);
          }}
          className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200"
        >
          <option value="">未指定</option>
          {parentCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">
          {selectedName
            ? `当前使用「${selectedName}」作为睡眠父分类。`
            : "未指定时，覆盖率按全天估算，睡眠时段使用默认 23:00~07:00。"}
        </p>
      </section>
    </SettingsDetailPage>
  );
}
