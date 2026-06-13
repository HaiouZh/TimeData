import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;

beforeEach(async () => {
  db = new Database(":memory:");
  vi.resetModules();
  vi.doMock("../db/connection.js", () => ({ getDb: () => db }));
  const { initializeDatabase } = await import("../db/schema.js");
  initializeDatabase();
});

afterEach(() => {
  db.close();
  vi.doUnmock("../db/connection.js");
});

describe("syncState", () => {
  it("computeAndPersistCommitHash writes and returns the commit hash", async () => {
    const { computeAndPersistCommitHash } = await import("./state.js");
    // 清掉初始化时给默认分类回填的 seq，验证空账本时 latestSeq 为 null 的基线行为。
    db.prepare("DELETE FROM sync_seq").run();

    const result = computeAndPersistCommitHash();

    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.latestSeq).toBeNull();
    expect(db.prepare("SELECT value FROM sync_state WHERE key = 'commit_hash'").get()).toMatchObject({
      value: result.hash,
    });
    expect(db.prepare("SELECT value FROM sync_state WHERE key = 'latest_seq'").get()).toMatchObject({ value: "" });
  });

  it("getCommitHash recomputes and stores state when missing", async () => {
    const { getCommitHash } = await import("./state.js");
    db.prepare("DELETE FROM sync_state").run();

    const result = getCommitHash();

    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(db.prepare("SELECT value FROM sync_state WHERE key = 'commit_hash'").get()).toMatchObject({
      value: result.hash,
    });
  });

  it("returns the same hash for unchanged content", async () => {
    const { computeAndPersistCommitHash } = await import("./state.js");

    const first = computeAndPersistCommitHash();
    const second = computeAndPersistCommitHash();

    expect(second.hash).toBe(first.hash);
    expect(second.latestSeq).toBe(first.latestSeq);
  });

  it("marks commit hash dirty when sync_seq changes and recomputes on next read", async () => {
    const { computeAndPersistCommitHash, getCommitHash } = await import("./state.js");
    const { recordSeq } = await import("./seq.js");

    const first = computeAndPersistCommitHash();
    const created = recordSeq("categories", "cat-1", "create");

    expect(db.prepare("SELECT value FROM sync_state WHERE key = 'dirty'").get()).toMatchObject({ value: "1" });

    const second = getCommitHash();
    expect(second.latestSeq).toBe(created);
    expect(second.hash).not.toBe(first.hash);
    expect(db.prepare("SELECT value FROM sync_state WHERE key = 'dirty'").get()).toMatchObject({ value: "0" });
  });

  it("设置变更改变 commit-hash，避免已对齐快路径跳过设置同步", async () => {
    const { computeAndPersistCommitHash } = await import("./state.js");

    const before = computeAndPersistCommitHash().hash;
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "sleep.categoryId",
      "cat-1",
      "2026-05-30T00:00:00.000Z",
    );
    const after = computeAndPersistCommitHash().hash;

    expect(after).not.toBe(before);
    expect(db.prepare("SELECT value FROM sync_state WHERE key = 'row_count_settings'").get()).toMatchObject({
      value: "1",
    });
  });

  it("quick note 变更改变 commit-hash，避免 note-only 同步被快路径跳过", async () => {
    const { computeAndPersistCommitHash } = await import("./state.js");

    const before = computeAndPersistCommitHash().hash;
    db.prepare(`
      INSERT INTO quick_notes (id, text, occurred_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      "note-1",
      "repo",
      "2026-06-01T04:01:30.123Z",
      "2026-06-01T04:02:00.000Z",
      "2026-06-01T04:02:00.000Z",
    );
    const after = computeAndPersistCommitHash().hash;

    expect(after).not.toBe(before);
    expect(db.prepare("SELECT value FROM sync_state WHERE key = 'row_count_quick_notes'").get()).toMatchObject({
      value: "1",
    });
  });
});
