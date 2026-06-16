import { useMemo } from "react";
import { useCategories } from "../../hooks/useCategories.ts";
import { setSleepCategoryId, useSleepCategoryId } from "../../lib/sleepCategorySetting.ts";
import { setPunchCategoryId, usePunchCategoryId } from "../../lib/settings/punchCategorySetting.ts";
import {
  setTodoDefaultDestination,
  useTodoDefaultDestination,
} from "../../lib/settings/todoDefaultDestinationSetting.ts";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

// 历史路由名 /settings/insights、文件名 SettingsInsightsPage 均保留；本页现为「杂项」设置归处。
export default function SettingsInsightsPage() {
  const { parentCategories, getChildren, getCategoryPath } = useCategories();
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

  return (
    <SettingsDetailPage title="杂项">
      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div>
          <h3 className="text-sm font-medium text-slate-100">新建待办默认落点</h3>
          <p className="mt-1 text-xs text-slate-500">
            待办页底部添加、速记页「待办」按钮新建任务时默认进哪个池。
          </p>
        </div>
        <select
          aria-label="新建待办默认落点"
          value={todoDestination}
          onChange={(event) => {
            void setTodoDefaultDestination(event.target.value === "inbox" ? "inbox" : "today");
          }}
          className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200"
        >
          <option value="today">今天</option>
          <option value="inbox">收件箱</option>
        </select>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div>
          <h3 className="text-sm font-medium text-slate-100">打点分类</h3>
          <p className="mt-1 text-xs text-slate-500">速记页和时间轴打点时，直接记录到这个子分类。</p>
        </div>
        <select
          aria-label="打点分类"
          value={punchCategoryId ?? ""}
          onChange={(event) => {
            const value = event.target.value || null;
            void setPunchCategoryId(value);
          }}
          className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200"
        >
          <option value="">未指定</option>
          {punchCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {getCategoryPath(category.id)}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">
          {selectedPunchName ? `当前打点会记录到「${selectedPunchName}」。` : "未指定时，打点不会写入时间记录。"}
        </p>
      </section>

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
