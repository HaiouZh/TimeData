import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalSchema, TaskSchema, TrackSchema } from "@timedata/shared";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import { db } from "./index.js";
import {
  isDeepEqual,
  planNormalization,
  SCHEMA_NORMALIZATION_VERSION,
  runSchemaNormalizationIfNeeded,
} from "./schemaNormalization.js";

const keyOf = (doc: Record<string, unknown>) => String(doc.id);
const baseTask = {
  id: "a",
  parentId: null,
  title: "A",
  done: false,
  recurrence: null,
  lastDoneAt: null,
  startAt: null,
  scheduledAt: null,
  sortOrder: 0,
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
};
const normalizedTask = {
  ...baseTask,
  completedCount: 0,
  weight: 0,
  completedAt: null,
  tags: [],
};
const legacyStateField = "tu" + "rn";
const legacyStateTimeField = `${legacyStateField}At`;

const localStorageMock = (() => {
  let store = new Map<string, string>();
  return {
    clear: () => {
      store = new Map<string, string>();
    },
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });

function legacyTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "t1",
    title: "旧任务",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    sortOrder: 0,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("isDeepEqual", () => {
  it("对象键顺序不同但内容相同 -> 相等", () => {
    expect(isDeepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("数组顺序敏感", () => {
    expect(isDeepEqual([1, 2], [2, 1])).toBe(false);
  });

  it("多一个键 -> 不等", () => {
    expect(isDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe("planNormalization", () => {
  it("strips retired Task/Track goalId while defaulting Goal.members", () => {
    expect(planNormalization([{ ...baseTask, goalId: "goal-1" }], TaskSchema, keyOf).writes).toEqual([
      { key: "a", value: normalizedTask },
    ]);
    expect(
      planNormalization(
        [
          {
            id: "track-1",
            title: "轨道",
            status: "active",
            refs: [],
            goalId: "goal-1",
            createdAt: "2026-06-20T00:00:00.000Z",
            updatedAt: "2026-06-20T00:00:00.000Z",
          },
        ],
        TrackSchema,
        keyOf,
      ).writes,
    ).toEqual([
      {
        key: "track-1",
        value: {
          id: "track-1",
          title: "轨道",
          status: "active",
          refs: [],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      },
    ]);
    expect(
      GoalSchema.parse({
        id: "goal-1",
        title: "目标",
        kind: "project",
        status: "active",
        prerequisites: [],
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }).members,
    ).toEqual([]);
  });

  it("缺字段按默认值计划写回", () => {
    const plan = planNormalization([baseTask], TaskSchema, keyOf);

    expect(plan).toEqual({
      writes: [{ key: "a", value: normalizedTask }],
      skipped: [],
    });
  });

  it("孤儿字段被 strip 并计划写回", () => {
    const plan = planNormalization(
      [{ ...normalizedTask, ghostField: true }],
      TaskSchema,
      keyOf,
    );

    expect(plan.writes).toEqual([{ key: "a", value: normalizedTask }]);
    expect(plan.skipped).toEqual([]);
  });

  it("旧状态字段被 strip 并计划写回", () => {
    const plan = planNormalization(
      [
        {
          ...normalizedTask,
          [legacyStateField]: "running",
          [legacyStateTimeField]: "2026-06-20T01:00:00.000Z",
        },
      ],
      TaskSchema,
      keyOf,
    );

    expect(plan.writes).toEqual([{ key: "a", value: normalizedTask }]);
    expect(plan.skipped).toEqual([]);
  });

  it("干净数据不写回；键顺序不同也不写回", () => {
    const clean = planNormalization([normalizedTask], TaskSchema, keyOf);
    const reordered = planNormalization(
      [
        {
          title: "A",
          id: "a",
          completedAt: null,
          completedCount: 0,
          weight: 0,
          tags: [],
          sortOrder: 0,
          scheduledAt: null,
          startAt: null,
          lastDoneAt: null,
          recurrence: null,
          done: false,
          parentId: null,
          updatedAt: "2026-06-20T00:00:00.000Z",
          createdAt: "2026-06-20T00:00:00.000Z",
        },
      ],
      TaskSchema,
      keyOf,
    );

    expect(clean.writes).toEqual([]);
    expect(reordered.writes).toEqual([]);
  });

  it("坏行进 skipped 不进 writes", () => {
    const plan = planNormalization([{ id: "a" }], TaskSchema, keyOf);

    expect(plan.writes).toEqual([]);
    expect(plan.skipped).toEqual([{ key: "a", issues: expect.arrayContaining([expect.stringContaining("title")]) }]);
  });
});

describe("runSchemaNormalizationIfNeeded", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
  });

  it("版本低 -> 跑：补默认/剥孤儿、保留 updatedAt、不写 syncLog、推进版本", async () => {
    await db.tasks.put(
      legacyTask({
        ghostField: "strip-me",
        [legacyStateField]: "running",
        [legacyStateTimeField]: "2026-06-20T01:00:00.000Z",
      }) as never,
    );
    await db.quickNotes.put({
      id: "n1",
      text: "hi",
      occurredAt: "2026-06-20T00:00:00.000Z",
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
      ghostField: "x",
    } as never);

    await runSchemaNormalizationIfNeeded();

    const task = await db.tasks.get("t1");
    expect(task).not.toHaveProperty("ghostField");
    expect(task).not.toHaveProperty(legacyStateField);
    expect(task).not.toHaveProperty(legacyStateTimeField);
    expect(task).toMatchObject({ completedCount: 0, parentId: null, tags: [] });
    expect(task).not.toHaveProperty("goalId");
    expect(task?.updatedAt).toBe("2026-06-20T00:00:00.000Z");
    expect(await db.quickNotes.get("n1")).not.toHaveProperty("ghostField");
    expect(await db.syncLog.count()).toBe(0);
    expect(localStorage.getItem(STORAGE_KEYS.schemaNormalizationVersion)).toBe(String(SCHEMA_NORMALIZATION_VERSION));
  });

  it("版本相等 -> 不跑", async () => {
    localStorage.setItem(STORAGE_KEYS.schemaNormalizationVersion, String(SCHEMA_NORMALIZATION_VERSION));
    const spy = vi.spyOn(db.tasks, "toArray");

    await runSchemaNormalizationIfNeeded();

    expect(spy).not.toHaveBeenCalled();
  });

  it("坏行 skip + warn + 保留不动", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await db.tasks.put({ id: "bad", sortOrder: 0 } as never);

    await runSchemaNormalizationIfNeeded();

    expect(warn).toHaveBeenCalled();
    expect(await db.tasks.get("bad")).toMatchObject({ id: "bad" });
  });

  it("事务抛错 -> 不推进版本，下次可重试", async () => {
    await db.tasks.put(legacyTask({ ghostField: "x" }) as never);
    const transactionSpy = vi.spyOn(db, "transaction").mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    await expect(runSchemaNormalizationIfNeeded()).rejects.toThrow("boom");
    expect(localStorage.getItem(STORAGE_KEYS.schemaNormalizationVersion)).toBeNull();

    transactionSpy.mockRestore();
    await runSchemaNormalizationIfNeeded();
    expect(localStorage.getItem(STORAGE_KEYS.schemaNormalizationVersion)).toBe(String(SCHEMA_NORMALIZATION_VERSION));
  });
});
