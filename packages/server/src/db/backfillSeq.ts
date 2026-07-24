import { encodeGoalLayoutPinKey, type GoalLayoutPinNodeKind } from "@timedata/shared";
import type { Database } from "better-sqlite3";
import { markCommitHashDirty } from "../sync/state.js";

type BusinessTable =
  | { table: string; pk: string }
  | {
      table: string;
      select: string;
      recordIdOfRow: (row: Record<string, unknown>) => string;
    };

// 业务表 → recordId 生成规则。一次性 seq 回填用，显式列出当前同步域。
const BUSINESS_TABLES: BusinessTable[] = [
  { table: "categories", pk: "id" },
  { table: "time_entries", pk: "id" },
  { table: "settings", pk: "key" },
  { table: "quick_notes", pk: "id" },
  { table: "tasks", pk: "id" },
  { table: "sessions", pk: "id" },
  { table: "health_heart_rate", pk: "id" },
  { table: "health_hrv", pk: "id" },
  { table: "health_sleep", pk: "id" },
  { table: "health_stress", pk: "id" },
  { table: "runs", pk: "id" },
  { table: "health_charts", pk: "id" },
  { table: "tracks", pk: "id" },
  { table: "track_steps", pk: "id" },
  { table: "goals", pk: "id" },
  {
    table: "goal_layout_pins",
    select: "goal_id, node_kind, node_id",
    recordIdOfRow: (row) =>
      encodeGoalLayoutPinKey(
        String(row.goal_id),
        row.node_kind as GoalLayoutPinNodeKind,
        String(row.node_id),
      ),
  },
];

function selectBackfillRows(db: Database, item: BusinessTable): Array<{ recordId: string }> {
  if ("pk" in item) {
    return db.prepare(`SELECT ${item.pk} AS recordId FROM ${item.table}`).all() as Array<{ recordId: string }>;
  }

  const rows = db.prepare(`SELECT ${item.select} FROM ${item.table}`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({ recordId: item.recordIdOfRow(row) }));
}

// 给所有"在业务表里有行、但 sync_seq 里没有任何记录"的行补一条 create seq。
// 背景：账本模型的 pull 只通过 sync_seq 读数据；早于 seq 机制写入的历史行（含首次启动默认播种的分类）
// 在 sync_seq 里没有记录，会对 seq-only pull 不可见。这个回填一次性补齐编号，使全部历史数据可被拉取。
// 幂等：已有 seq 的行不再补；没有缺失行时不写入、不标 dirty。
// 不在范围内：早于 seq 机制的删除（tombstone 无对应 delete seq）——那类行业务表里已不存在，属罕见边角。
export function backfillMissingSeq(db: Database): number {
  let inserted = 0;
  const insert = db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, 'create')");
  const run = db.transaction(() => {
    const exists = db.prepare("SELECT 1 FROM sync_seq WHERE table_name = ? AND record_id = ? LIMIT 1");
    for (const item of BUSINESS_TABLES) {
      const rows = selectBackfillRows(db, item);
      for (const row of rows) {
        if (exists.get(item.table, row.recordId)) continue;
        insert.run(item.table, row.recordId);
        inserted++;
      }
    }
  });
  run();
  if (inserted > 0) markCommitHashDirty(db);
  return inserted;
}
