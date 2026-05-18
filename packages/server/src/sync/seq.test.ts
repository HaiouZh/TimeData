import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../db/connection.js";
import { initializeDatabase } from "../db/schema.js";
import { getChangesSinceSeq, getLatestSeq, recordSeq } from "./seq.js";
import { computeAndPersistCommitHash, getCommitHash } from "./state.js";

describe("sync_seq", () => {
  beforeEach(() => {
    initializeDatabase();
    const db = getDb();
    db.exec("DELETE FROM sync_seq");
  });

  it("recordSeq inserts a row and returns the new id", () => {
    const seq = recordSeq("categories", "cat-1", "create");
    expect(seq).toBeGreaterThan(0);
  });

  it("recordSeq marks the persisted commit hash dirty", () => {
    computeAndPersistCommitHash();

    const seq = recordSeq("categories", "cat-1", "create");
    const db = getDb();

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
