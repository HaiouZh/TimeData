import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 每个用例一套 :memory: 库。历史上本文件直连真实 getDb()，落到 DB_PATH 的默认值
// packages/server/data/timedata.db —— 那是本机 dev server 正在写的同一个文件：
// beforeEach 的 DELETE FROM sync_seq 会清掉真实同步账本，initializeDatabase 的默认分类播种
// 又会和 dev server 的启动/UTC 重置交错，撞 categories.parent_id 外键（间歇性 FOREIGN KEY constraint failed）。
let db: Database.Database;
let recordSeq: typeof import("./seq.js").recordSeq;
let getLatestSeq: typeof import("./seq.js").getLatestSeq;
let getChangesSinceSeq: typeof import("./seq.js").getChangesSinceSeq;
let computeAndPersistCommitHash: typeof import("./state.js").computeAndPersistCommitHash;
let getCommitHash: typeof import("./state.js").getCommitHash;

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  vi.resetModules();
  vi.doMock("../db/connection.js", () => ({ getDb: () => db, getDbPath: () => ":memory:" }));

  const { initializeDatabase } = await import("../db/schema.js");
  initializeDatabase();
  // 清掉初始化时给默认分类回填的 seq，让账本从空开始。
  db.exec("DELETE FROM sync_seq");

  ({ recordSeq, getLatestSeq, getChangesSinceSeq } = await import("./seq.js"));
  ({ computeAndPersistCommitHash, getCommitHash } = await import("./state.js"));
});

afterEach(() => {
  db.close();
  vi.doUnmock("../db/connection.js");
});

describe("sync_seq", () => {
  it("recordSeq inserts a row and returns the new id", () => {
    const seq = recordSeq("categories", "cat-1", "create");
    expect(seq).toBeGreaterThan(0);
  });

  it("recordSeq marks the persisted commit hash dirty", () => {
    computeAndPersistCommitHash();

    const seq = recordSeq("categories", "cat-1", "create");

    expect(db.prepare("SELECT value FROM sync_state WHERE key = 'dirty'").get()).toMatchObject({ value: "1" });
    expect(getCommitHash().latestSeq).toBe(seq);
    expect(db.prepare("SELECT value FROM sync_state WHERE key = 'dirty'").get()).toMatchObject({ value: "0" });
  });

  it("seq ids are strictly monotonic", () => {
    const seq1 = recordSeq("categories", "cat-1", "create");
    const seq2 = recordSeq("time_entries", "entry-1", "create");
    const seq3 = recordSeq("categories", "cat-1", "update");
    expect(seq2).toBeGreaterThan(seq1);
    expect(seq3).toBeGreaterThan(seq2);
  });

  it("getLatestSeq returns the highest seq id", () => {
    recordSeq("categories", "cat-1", "create");
    const seq2 = recordSeq("time_entries", "entry-1", "create");
    expect(getLatestSeq()).toBe(seq2);
  });

  it("getLatestSeq returns null when table is empty", () => {
    expect(getLatestSeq()).toBeNull();
  });

  it("getChangesSinceSeq returns records after given seq", () => {
    const seq1 = recordSeq("categories", "cat-1", "create");
    recordSeq("time_entries", "entry-1", "create");
    recordSeq("categories", "cat-2", "update");

    const changes = getChangesSinceSeq(seq1);
    expect(changes).toHaveLength(2);
    expect(changes[0].tableName).toBe("time_entries");
    expect(changes[0].recordId).toBe("entry-1");
    expect(changes[1].tableName).toBe("categories");
    expect(changes[1].recordId).toBe("cat-2");
  });

  it("tracks quick_notes records", () => {
    const seq = recordSeq("quick_notes", "note-1", "create");

    expect(getLatestSeq()).toBe(seq);
    expect(getChangesSinceSeq(null)).toEqual([
      { id: seq, tableName: "quick_notes", recordId: "note-1", action: "create" },
    ]);
  });

  it("getChangesSinceSeq with null returns all records", () => {
    recordSeq("categories", "cat-1", "create");
    recordSeq("time_entries", "entry-1", "create");

    const changes = getChangesSinceSeq(null);
    expect(changes).toHaveLength(2);
  });

  it("getChangesSinceSeq deduplicates by latest seq per record", () => {
    recordSeq("categories", "cat-1", "create");
    recordSeq("categories", "cat-1", "update");
    recordSeq("categories", "cat-1", "update");

    const changes = getChangesSinceSeq(null);
    expect(changes).toHaveLength(1);
    expect(changes[0].action).toBe("update");
  });
});
