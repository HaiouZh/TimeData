import type { Database } from "better-sqlite3";
import { markCommitHashDirty } from "../sync/state.js";

// 业务表 → 主键列。一次性 seq 回填用，显式列出当前四个同步域。
const BUSINESS_TABLES: Array<{ table: string; pk: string }> = [
  { table: "categories", pk: "id" },
  { table: "time_entries", pk: "id" },
  { table: "settings", pk: "key" },
  { table: "quick_notes", pk: "id" },
];

// 给所有"在业务表里有行、但 sync_seq 里没有任何记录"的行补一条 create seq。
// 背景：账本模型的 pull 只通过 sync_seq 读数据；早于 seq 机制写入的历史行（含首次启动默认播种的分类）
// 在 sync_seq 里没有记录，会对 seq-only pull 不可见。这个回填一次性补齐编号，使全部历史数据可被拉取。
// 幂等：已有 seq 的行不再补；没有缺失行时不写入、不标 dirty。
// 不在范围内：早于 seq 机制的删除（tombstone 无对应 delete seq）——那类行业务表里已不存在，属罕见边角。
export function backfillMissingSeq(db: Database): number {
  let inserted = 0;
  const insert = db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, 'create')");
  const run = db.transaction(() => {
    for (const { table, pk } of BUSINESS_TABLES) {
      const rows = db
        .prepare(
          `SELECT ${pk} AS id FROM ${table} t
           WHERE NOT EXISTS (
             SELECT 1 FROM sync_seq s WHERE s.table_name = ? AND s.record_id = t.${pk}
           )`,
        )
        .all(table) as Array<{ id: string }>;
      for (const row of rows) {
        insert.run(table, row.id);
        inserted++;
      }
    }
  });
  run();
  if (inserted > 0) markCommitHashDirty(db);
  return inserted;
}
