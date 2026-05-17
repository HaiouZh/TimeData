import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncChange } from "@timedata/shared";

let db: Database.Database;
let validateSyncChanges: (
  db: Database.Database,
  changes: SyncChange[],
  options?: { now?: Date | string }
) => { valid: boolean; outcomes: Array<{ status: string; reasonCode: string; recordId: string; message?: string }> };

function createSchema() {
  db.exec(`
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      color TEXT NOT NULL DEFAULT '#808080',
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES categories(id)
    );

    CREATE TABLE time_entries (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );
  `);
}

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema();
  db.prepare(`INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run("cat-1", "工作", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");
  db.prepare(`INSERT INTO categories (id, name, color, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run("cat-archived", "归档", "#777777", 1, "2026-05-08T08:00:00", "2026-05-08T08:00:00");
  vi.resetModules();
  ({ validateSyncChanges } = await import("./validation.js"));
});

afterEach(() => {
  db.close();
});

function entryChange(overrides: Partial<SyncChange> = {}): SyncChange {
  return {
    tableName: "time_entries",
    recordId: "entry-1",
    action: "create",
    data: {
      id: "entry-1",
      categoryId: "cat-1",
      startTime: "2026-05-08T09:00:00.000Z",
      endTime: "2026-05-08T10:00:00.000Z",
      note: null,
      createdAt: "2026-05-08T09:00:00.000Z",
      updatedAt: "2026-05-08T09:00:00.000Z",
    },
    timestamp: "2026-05-08T09:00:00.000Z",
    ...overrides,
  };
}

function categoryChange(overrides: Partial<SyncChange> = {}): SyncChange {
  return {
    tableName: "categories",
    recordId: "cat-new",
    action: "create",
    data: {
      id: "cat-new",
      name: "新分类",
      parentId: null,
      color: "#3366ff",
      icon: null,
      sortOrder: 2,
      isArchived: false,
      createdAt: "2026-05-08T08:30:00",
      updatedAt: "2026-05-08T08:30:00",
    },
    timestamp: "2026-05-08T08:30:00",
    ...overrides,
  };
}

describe("validateSyncChanges", () => {
  it("rejects a self-referencing category", () => {
    const result = validateSyncChanges(db, [categoryChange({
      recordId: "cat-self",
      data: {
        id: "cat-self",
        name: "自引用",
        parentId: "cat-self",
        color: "#3366ff",
        icon: null,
        sortOrder: 2,
        isArchived: false,
        createdAt: "2026-05-08T08:30:00",
        updatedAt: "2026-05-08T08:30:00",
      },
    })]);

    expect(result.valid).toBe(false);
    expect(result.outcomes[0]).toMatchObject({ status: "rejected", reasonCode: "invalid_shape" });
  });

  it("rejects a third-level category", () => {
    db.prepare(`INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      "cat-child",
      "子分类",
      "cat-1",
      "#22c55e",
      "2026-05-08T08:00:00",
      "2026-05-08T08:00:00",
    );

    const result = validateSyncChanges(db, [categoryChange({
      recordId: "cat-grandchild",
      data: {
        id: "cat-grandchild",
        name: "三级分类",
        parentId: "cat-child",
        color: "#3366ff",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T08:30:00",
        updatedAt: "2026-05-08T08:30:00",
      },
    })]);

    expect(result.valid).toBe(false);
    expect(result.outcomes[0]).toMatchObject({ status: "rejected", reasonCode: "invalid_shape" });
  });

  it("rejects create and update changes with missing payload", () => {
    const result = validateSyncChanges(db, [entryChange({ data: null })]);

    expect(result.valid).toBe(false);
    expect(result.outcomes[0]).toMatchObject({
      status: "rejected",
      reasonCode: "missing_payload",
      recordId: "entry-1",
    });
  });

  it("rejects a time entry whose end is not after start", () => {
    const result = validateSyncChanges(db, [entryChange({
      data: {
        id: "entry-1",
        categoryId: "cat-1",
        startTime: "2026-05-08T10:00:00.000Z",
        endTime: "2026-05-08T09:00:00.000Z",
        note: null,
        createdAt: "2026-05-08T10:00:00.000Z",
        updatedAt: "2026-05-08T10:00:00.000Z",
      },
      timestamp: "2026-05-08T10:00:00.000Z",
    })]);

    expect(result.valid).toBe(false);
    expect(result.outcomes[0]).toMatchObject({ status: "rejected", reasonCode: "invalid_time_range" });
  });

  it("rejects an Asia/Shanghai local entry (no Z suffix) after UTC migration", () => {
    const result = validateSyncChanges(db, [entryChange({
      data: {
        id: "entry-1",
        categoryId: "cat-1",
        startTime: "2026-05-08T17:00:00",
        endTime: "2026-05-08T17:30:00",
        note: null,
        createdAt: "2026-05-08T17:00:00",
        updatedAt: "2026-05-08T17:00:00",
      },
    })], { now: new Date("2026-05-08T09:30:00.000Z") });

    expect(result.valid).toBe(false);
    expect(result.outcomes[0]).toMatchObject({ status: "rejected", reasonCode: "invalid_shape" });
  });

  it("rejects a time entry whose end is in the future", () => {
    const result = validateSyncChanges(db, [entryChange({
      data: {
        id: "entry-1",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:00:00.000Z",
        endTime: "2026-05-08T10:01:00.000Z",
        note: null,
        createdAt: "2026-05-08T09:00:00.000Z",
        updatedAt: "2026-05-08T09:00:00.000Z",
      },
    })], { now: new Date("2026-05-08T10:00:00.000Z") });

    expect(result.valid).toBe(false);
    expect(result.outcomes[0]).toMatchObject({
      status: "rejected",
      reasonCode: "invalid_time_range",
      message: "entry endTime cannot be in the future",
    });
  });

  it("accepts a time entry whose end is exactly the current time", () => {
    const result = validateSyncChanges(db, [entryChange({
      data: {
        id: "entry-1",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:00:00.000Z",
        endTime: "2026-05-08T10:00:00.000Z",
        note: null,
        createdAt: "2026-05-08T09:00:00.000Z",
        updatedAt: "2026-05-08T09:00:00.000Z",
      },
    })], { now: new Date("2026-05-08T10:00:00.000Z") });

    expect(result.valid).toBe(true);
    expect(result.outcomes[0]).toMatchObject({ status: "accepted", reasonCode: "applied" });
  });

  it("rejects an entry that references a missing category", () => {
    const result = validateSyncChanges(db, [entryChange({
      data: {
        id: "entry-1",
        categoryId: "missing-category",
        startTime: "2026-05-08T09:00:00.000Z",
        endTime: "2026-05-08T10:00:00.000Z",
        note: null,
        createdAt: "2026-05-08T09:00:00.000Z",
        updatedAt: "2026-05-08T09:00:00.000Z",
      },
    })]);

    expect(result.valid).toBe(false);
    expect(result.outcomes[0]).toMatchObject({ status: "rejected", reasonCode: "missing_category" });
  });

  it("accepts a child category whose parent is created in the same push batch", () => {
    const parent = categoryChange({
      recordId: "cat-parent",
      data: {
        id: "cat-parent",
        name: "父分类",
        parentId: null,
        color: "#3366ff",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T08:30:00",
        updatedAt: "2026-05-08T08:30:00",
      },
      timestamp: "2026-05-08T08:30:00",
    });
    const child = categoryChange({
      recordId: "cat-child",
      data: {
        id: "cat-child",
        name: "子分类",
        parentId: "cat-parent",
        color: "#3366ff",
        icon: null,
        sortOrder: 1,
        isArchived: false,
        createdAt: "2026-05-08T08:31:00",
        updatedAt: "2026-05-08T08:31:00",
      },
      timestamp: "2026-05-08T08:31:00",
    });

    const result = validateSyncChanges(db, [parent, child]);

    expect(result.valid).toBe(true);
    expect(result.outcomes.map((item) => item.status)).toEqual(["accepted", "accepted"]);
  });

  it("rejects a same-batch category that would create a third level", () => {
    const parent = categoryChange({
      recordId: "cat-parent",
      data: {
        id: "cat-parent",
        name: "父分类",
        parentId: null,
        color: "#3366ff",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-08T08:30:00",
        updatedAt: "2026-05-08T08:30:00",
      },
      timestamp: "2026-05-08T08:30:00",
    });
    const child = categoryChange({
      recordId: "cat-child",
      data: {
        id: "cat-child",
        name: "子分类",
        parentId: "cat-parent",
        color: "#3366ff",
        icon: null,
        sortOrder: 1,
        isArchived: false,
        createdAt: "2026-05-08T08:31:00",
        updatedAt: "2026-05-08T08:31:00",
      },
      timestamp: "2026-05-08T08:31:00",
    });
    const grandChild = categoryChange({
      recordId: "cat-grandchild",
      data: {
        id: "cat-grandchild",
        name: "孙分类",
        parentId: "cat-child",
        color: "#3366ff",
        icon: null,
        sortOrder: 2,
        isArchived: false,
        createdAt: "2026-05-08T08:32:00",
        updatedAt: "2026-05-08T08:32:00",
      },
      timestamp: "2026-05-08T08:32:00",
    });

    const result = validateSyncChanges(db, [parent, child, grandChild]);

    expect(result.valid).toBe(false);
    expect(result.outcomes[2]).toMatchObject({ status: "rejected", reasonCode: "invalid_shape" });
  });


  it("rejects an entry that references an archived category", () => {
    const result = validateSyncChanges(db, [entryChange({
      data: {
        id: "entry-1",
        categoryId: "cat-archived",
        startTime: "2026-05-08T09:00:00.000Z",
        endTime: "2026-05-08T10:00:00.000Z",
        note: null,
        createdAt: "2026-05-08T09:00:00.000Z",
        updatedAt: "2026-05-08T09:00:00.000Z",
      },
    })]);

    expect(result.valid).toBe(false);
    expect(result.outcomes[0]).toMatchObject({ status: "rejected", reasonCode: "archived_category" });
  });

  it("accepts an entry that overlaps an existing server entry for local-first apply", () => {
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("existing", "cat-1", "2026-05-08T09:00:00", "2026-05-08T10:00:00", null, "2026-05-08T09:00:00", "2026-05-08T09:00:00");

    const result = validateSyncChanges(db, [entryChange({
      recordId: "entry-2",
      data: {
        id: "entry-2",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:30:00.000Z",
        endTime: "2026-05-08T10:30:00.000Z",
        note: null,
        createdAt: "2026-05-08T09:30:00.000Z",
        updatedAt: "2026-05-08T09:30:00.000Z",
      },
      timestamp: "2026-05-08T09:30:00.000Z",
    })]);

    expect(result.valid).toBe(true);
    expect(result.outcomes[0]).toMatchObject({ status: "accepted", reasonCode: "applied" });
  });

  it("accepts an entry when the server version is newer or same timestamp", () => {
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("entry-1", "cat-1", "2026-05-08T09:00:00", "2026-05-08T10:00:00", null, "2026-05-08T09:00:00", "2026-05-08T11:00:00");

    const result = validateSyncChanges(db, [entryChange()]);

    expect(result.valid).toBe(true);
    expect(result.outcomes[0]).toMatchObject({ status: "accepted", reasonCode: "applied" });
  });

  it("rejects time entries with non-UTC startTime/endTime (no Z suffix)", () => {
    const result = validateSyncChanges(db, [entryChange({
      data: {
        id: "entry-1",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:00:00",
        note: null,
        createdAt: "2026-05-08T09:00:00",
        updatedAt: "2026-05-08T09:00:00",
      },
    })]);

    expect(result.valid).toBe(false);
    expect(result.outcomes[0]).toMatchObject({ status: "rejected", reasonCode: "invalid_shape" });
  });

  it("rejects a batch when two incoming local entries overlap each other", () => {
    const result = validateSyncChanges(db, [
      entryChange({
        recordId: "entry-local-a",
        data: {
          id: "entry-local-a",
          categoryId: "cat-1",
          startTime: "2026-05-08T09:00:00.000Z",
          endTime: "2026-05-08T10:00:00.000Z",
          note: null,
          createdAt: "2026-05-08T09:00:00.000Z",
          updatedAt: "2026-05-08T09:00:00.000Z",
        },
      }),
      entryChange({
        recordId: "entry-local-b",
        data: {
          id: "entry-local-b",
          categoryId: "cat-1",
          startTime: "2026-05-08T09:30:00.000Z",
          endTime: "2026-05-08T10:30:00.000Z",
          note: null,
          createdAt: "2026-05-08T09:30:00.000Z",
          updatedAt: "2026-05-08T09:30:00.000Z",
        },
      }),
    ]);

    expect(result.valid).toBe(false);
    expect(result.outcomes[1]).toMatchObject({ status: "conflict", reasonCode: "overlap" });
  });
});


