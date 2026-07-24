import type { BackupDocument } from "./schema.js";

/** 完整备份里普通域的中文短标签，按 table 名键入；缺省回退 table 名本身。 */
const DOMAIN_LABELS: Record<string, string> = {
  goals: "目标",
  tasks: "任务",
  quick_notes: "速记",
  health_heart_rate: "心率",
  health_hrv: "HRV",
  health_sleep: "睡眠",
  health_stress: "压力",
  runs: "跑步",
  tracks: "轨道",
  track_steps: "轨道步骤",
  sessions: "手头会话",
};

function labelFor(table: string): string {
  return DOMAIN_LABELS[table] ?? table;
}

/** 把 domainCounts 渲染成 “3 条任务、5 条速记” 这样的中文摘要；空集合返回空串。 */
export function describeDomainCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([table, count]) => `${count} 条${labelFor(table)}`)
    .join("，");
}

/** 从备份文档直接算 domainCounts（导出后没有 summary 时用）。 */
export function domainCountsFromBackup(backup: BackupDocument): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [table, records] of Object.entries(backup.domains)) {
    counts[table] = records.length;
  }
  return counts;
}
