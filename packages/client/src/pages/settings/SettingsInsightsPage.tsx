import { useMemo, useState } from "react";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { SelectSheet } from "../../components/ui/SelectSheet.js";
import { Switch } from "../../components/ui/Switch.js";
import { useCategories } from "../../hooks/useCategories.ts";
import { getMergeOvernightEnabled, setMergeOvernightEnabled } from "../../lib/overnightDisplaySetting.ts";
import { setSleepCategoryId, useSleepCategoryId } from "../../lib/sleepCategorySetting.ts";
import { setPunchCategoryId, usePunchCategoryId } from "../../lib/settings/punchCategorySetting.ts";
import {
  setTodoDefaultDestination,
  useTodoDefaultDestination,
} from "../../lib/settings/todoDefaultDestinationSetting.ts";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

// 历史路由名 /settings/insights、文件名 SettingsInsightsPage 均保留；本页现为「记录偏好」设置归处。
export default function SettingsInsightsPage() {
  const { parentCategories, getChildren, getCategoryPath } = useCategories();
  const [mergeOvernightEnabled, setMergeOvernightEnabledState] = useState(getMergeOvernightEnabled());
  const sleepCategoryId = useSleepCategoryId();
  const todoDestination = useTodoDefaultDestination();
  const punchCategoryId = usePunchCategoryId();
  const punchCategories = useMemo(
    () => parentCategories.flatMap((parent) => getChildren(parent.id)),
    [getChildren, parentCategories],
  );
  const selectedName = useMemo(
    () => parentCategories.find((category) => category.id === sleepCategoryId)?.name ?? null,
    [parentCategories, sleepCategoryId],
  );
  const selectedPunchName = useMemo(
    () =>
      punchCategories.some((category) => category.id === punchCategoryId) && punchCategoryId
        ? getCategoryPath(punchCategoryId)
        : null,
    [getCategoryPath, punchCategories, punchCategoryId],
  );

  function handleMergeOvernightChange(checked: boolean) {
    setMergeOvernightEnabled(checked);
    setMergeOvernightEnabledState(checked);
  }

  return (
    <SettingsDetailPage title="记录偏好">
      <section className="space-y-3 rounded-card border border-border bg-surface p-4">
        <div>
          <h3 className="text-sm font-medium text-ink">新建待办默认落点</h3>
          <p className="mt-1 text-xs text-ink-3">
            待办页底部添加、速记页「待办」按钮新建任务时默认进哪个池。
          </p>
        </div>
        <SegmentedControl
          ariaLabel="新建待办默认落点"
          value={todoDestination}
          onChange={(v) => void setTodoDefaultDestination(v)}
          options={[
            { value: "today", label: "今天" },
            { value: "inbox", label: "收件箱" },
          ]}
        />
      </section>

      <section className="space-y-3 rounded-card border border-border bg-surface p-4">
        <div>
          <h3 className="text-sm font-medium text-ink">打点分类</h3>
          <p className="mt-1 text-xs text-ink-3">速记页和时间轴打点时，直接记录到这个子分类。</p>
        </div>
        <SelectSheet
          label="打点分类"
          placeholder="未指定"
          value={punchCategoryId ?? ""}
          onChange={(v) => void setPunchCategoryId(v || null)}
          options={[
            { value: "", label: "未指定" },
            ...punchCategories.map((c) => ({ value: c.id, label: getCategoryPath(c.id) })),
          ]}
        />
        <p className="text-xs text-ink-3">
          {selectedPunchName ? `当前打点会记录到「${selectedPunchName}」。` : "未指定时，打点不会写入时间记录。"}
        </p>
      </section>

      <section className="space-y-3 rounded-card border border-border bg-surface p-4">
        <div>
          <h3 className="text-sm font-medium text-ink">睡眠分类</h3>
          <p className="mt-1 text-xs text-ink-3">用于作息、覆盖率、异常时段活动和超长记录的睡眠口径。</p>
        </div>
        <SelectSheet
          label="睡眠分类"
          placeholder="未指定"
          value={sleepCategoryId ?? ""}
          onChange={(v) => void setSleepCategoryId(v || null)}
          options={[{ value: "", label: "未指定" }, ...parentCategories.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <p className="text-xs text-ink-3">
          {selectedName
            ? `当前使用「${selectedName}」作为睡眠父分类。`
            : "未指定时，覆盖率按全天估算，睡眠时段使用默认 23:00~07:00。"}
        </p>
      </section>

      <section className="space-y-3 rounded-card border border-border bg-surface p-4">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-ink">跨天记录合并展示</span>
            <span className="mt-1 block text-xs text-ink-3">
              开启后，结束于当天的跨天记录会显示完整时间段，例如 23:57 - 06:00。统计仍按自然日计算。
            </span>
          </span>
          <Switch
            ariaLabel="跨天记录合并展示"
            checked={mergeOvernightEnabled}
            onChange={(on) => handleMergeOvernightChange(on)}
          />
        </label>
      </section>
    </SettingsDetailPage>
  );
}
