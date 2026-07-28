import { ageBuckets } from "../../../../lib/todoStats/age.ts";
import type { TodoStatsModuleProps } from "../types.ts";

export default function AgeDistributionSection({ tasks, today }: TodoStatsModuleProps) {
  const buckets = ageBuckets(tasks, new Date(today));
  const oldest = buckets[0]?.oldest ?? [];

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-elev1">
      <h2 className="td-text-label font-medium text-ink-2">存活时长分布</h2>
      <p className="mt-1 td-text-caption text-ink-3">未完成待办从创建到现在的存活时长分布，不含重复任务。</p>
      <ul className="mt-3 space-y-1">
        {buckets.map((bucket) => (
          <li key={bucket.label} className="flex items-center justify-between td-text-label">
            <span className="text-ink-2">{bucket.label}</span>
            <span className="font-medium text-ink">{bucket.count}</span>
          </li>
        ))}
      </ul>
      {oldest.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer td-text-caption text-ink-3">最老 {oldest.length} 条</summary>
          <ul className="mt-2 space-y-1">
            {oldest.map((task) => (
              <li key={task.id} className="td-text-caption text-ink-3">
                {task.title}（{task.createdAt.slice(0, 10)}）
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
