import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Category, SyncChange, TimeEntry } from "@timedata/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type E2EServer, startE2EServer } from "./helpers.js";

// 真实数据回放：用现网导出的 timedata.backup 灌入新同步管线，走 push → 记账 → sinceSeq 0 全量 pull，
// 对比业务字段逐条一致（updatedAt 由服务器分配，排除在对比外）。
// 夹具不进 Git：把真实备份放到 docs_local/fixtures/timedata.backup 后本测试才会执行，缺失时跳过。

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../docs_local/fixtures/timedata.backup",
);

interface BackupDocument {
  format: string;
  categories: Category[];
  timeEntries: TimeEntry[];
}

function loadFixture(): BackupDocument | null {
  if (!fs.existsSync(FIXTURE_PATH)) return null;
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8")) as BackupDocument;
}

function toCreateChange(tableName: "categories" | "time_entries", recordId: string, data: unknown, timestamp: string): SyncChange {
  return { tableName, recordId, action: "create", data, timestamp } as SyncChange;
}

async function pushBatch(server: E2EServer, changes: SyncChange[]): Promise<void> {
  const res = await server.app.request("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes, baseSeq: null }),
  });
  const body = (await res.json()) as { accepted: number; rejected: number; conflicts: number; outcomes?: unknown[] };
  if (res.status !== 200 || body.rejected > 0 || body.conflicts > 0) {
    throw new Error(`real-data push failed (status=${res.status}): ${JSON.stringify(body.outcomes).slice(0, 2000)}`);
  }
}

const fixture = loadFixture();
let server: E2EServer | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

describe("real data replay through the ledger pipeline", () => {
  it.skipIf(!fixture)("pushes the full backup and pulls it back identically", async () => {
    const backup = fixture as BackupDocument;
    // 接受 timedata.backup 及其版本化变体（如 timedata.backup.v2）。
    expect(backup.format).toMatch(/^timedata\.backup/);
    server = await startE2EServer();
    // 测试库默认播种的分类与真实数据无关，先清掉避免重名校验干扰。
    server.db.prepare("DELETE FROM categories").run();

    const categoryChanges = backup.categories.map((category) =>
      toCreateChange("categories", category.id, category, category.updatedAt),
    );
    const entryChanges = backup.timeEntries.map((entry) => toCreateChange("time_entries", entry.id, entry, entry.updatedAt));

    const BATCH = 500;
    for (let index = 0; index < categoryChanges.length; index += BATCH) {
      await pushBatch(server, categoryChanges.slice(index, index + BATCH));
    }
    for (let index = 0; index < entryChanges.length; index += BATCH) {
      await pushBatch(server, entryChanges.slice(index, index + BATCH));
    }

    const pullRes = await server.app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: 0 }),
    });
    expect(pullRes.status).toBe(200);
    const pulled = (await pullRes.json()) as { changes: SyncChange[] };

    const pulledCategories = new Map(
      pulled.changes.filter((c) => c.tableName === "categories").map((c) => [c.recordId, c.data as Category]),
    );
    const pulledEntries = new Map(
      pulled.changes.filter((c) => c.tableName === "time_entries").map((c) => [c.recordId, c.data as TimeEntry]),
    );

    expect(pulledCategories.size).toBe(backup.categories.length);
    expect(pulledEntries.size).toBe(backup.timeEntries.length);

    for (const category of backup.categories) {
      expect(pulledCategories.get(category.id), `category ${category.id}`).toMatchObject({
        name: category.name,
        parentId: category.parentId,
        color: category.color,
        sortOrder: category.sortOrder,
        isArchived: category.isArchived,
        createdAt: category.createdAt,
      });
    }
    for (const entry of backup.timeEntries) {
      expect(pulledEntries.get(entry.id), `entry ${entry.id}`).toMatchObject({
        categoryId: entry.categoryId,
        startTime: entry.startTime,
        endTime: entry.endTime,
        note: entry.note,
        createdAt: entry.createdAt,
      });
    }
  });

  it.skipIf(fixture)("fixture missing — drop a real timedata.backup into docs_local/fixtures/ to enable replay", () => {
    console.warn(`[real-data-replay] fixture not found at ${FIXTURE_PATH}, replay skipped`);
    expect(true).toBe(true);
  });
});
