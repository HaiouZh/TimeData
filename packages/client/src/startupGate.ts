/**
 * 前置边搬家（`goal.prerequisites` → `taskRelations`）是一次性迁移，2026-08-15 就完成了，
 * 但它每次冷启动都开事务 + `goals.toArray()` 全表读。iOS 回收渲染进程后会整页重载，
 * 这份浪费于是被乘上了重载频率。
 *
 * 闸按版本号，与 `SCHEMA_NORMALIZATION_VERSION` 同一套取舍：将来若需再搬，bump 这个数即可。
 * 判据取「存的 >= 当前」而非「相等」——降级装回旧版时不该倒着再搬一遍。
 */
export const GOAL_PREREQ_MIGRATION_VERSION = 1;

export function shouldRunGoalPrereqMigration(savedRaw: string | null, currentVersion: number): boolean {
  if (savedRaw === null) return true;
  // 刻意不特判空串/空白：`Number("")` 与 `Number(" ")` 都是 0，而 0 < 任何正版本号已经得出
  // 「要跑」这个正确结论——加特判测不出差别，是死防御（A 档穷举变异实测过）。
  const saved = Number(savedRaw);
  // 垃圾值（含 NaN 与 Infinity）当没跑过：宁可多跑一次（迁移本身幂等）也不能漏。
  if (!Number.isFinite(saved)) return true;
  return saved < currentVersion;
}
