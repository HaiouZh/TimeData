import { describe, it, expect } from "vitest";
import { validateForcePushBusinessRules } from "./forcePushValidation.js";
import type { Category, QuickNote, Task, TimeEntry } from "@timedata/shared";

const baseCategory = (overrides: Partial<Category>): Category => ({
  id: "c1", name: "X", parentId: null, color: "#ffffff", icon: null,
  sortOrder: 0, isArchived: false,
  createdAt: "2026-05-19T03:00:00.000Z", updatedAt: "2026-05-19T03:00:00.000Z",
  ...overrides,
});

const baseEntry = (overrides: Partial<TimeEntry>): TimeEntry => ({
  id: "e1", categoryId: "c1", startTime: "2026-05-19T09:00:00.000Z", endTime: "2026-05-19T10:00:00.000Z",
  note: null, createdAt: "2026-05-19T03:00:00.000Z", updatedAt: "2026-05-19T03:00:00.000Z",
  ...overrides,
});

const baseQuickNote = (overrides: Partial<QuickNote>): QuickNote => ({
  id: "note-1",
  text: "repo",
  occurredAt: "2026-06-01T04:01:30.123Z",
  createdAt: "2026-06-01T04:02:00.000Z",
  updatedAt: "2026-06-01T04:02:00.000Z",
  ...overrides,
});

const baseTask = (overrides: Partial<Task>): Task => ({
  id: "task-1",
  parentId: null,
  title: "跑步",
  done: false,
  recurrence: null,
  lastDoneAt: null,
  startAt: null,
  scheduledAt: null,
  completedCount: 0,
  completedAt: null,
  tags: [],
  sortOrder: 0,
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
  ...overrides,
});

describe("validateForcePushBusinessRules", () => {
  it("rejects duplicate category id", () => {
    const result = validateForcePushBusinessRules([baseCategory({}), baseCategory({})], []);
    expect(result).toMatch(/duplicate category/);
  });

  it("rejects self-referencing parentId", () => {
    const result = validateForcePushBusinessRules([baseCategory({ id: "c1", parentId: "c1" })], []);
    expect(result).toMatch(/references itself/);
  });

  it("rejects third-level parent-child", () => {
    const result = validateForcePushBusinessRules(
      [
        baseCategory({ id: "p" }),
        baseCategory({ id: "c", parentId: "p" }),
        baseCategory({ id: "g", parentId: "c" }),
      ],
      [],
    );
    expect(result).toMatch(/third level/);
  });

  it("validates parent levels without array find lookups", () => {
    const categories = [
      baseCategory({ id: "p" }),
      baseCategory({ id: "c", parentId: "p" }),
      baseCategory({ id: "g", parentId: "c" }),
    ];
    categories.find = () => {
      throw new Error("Array.find should not be used for parent lookup");
    };

    const result = validateForcePushBusinessRules(categories, []);

    expect(result).toMatch(/third level/);
  });

  it("rejects missing parent category", () => {
    const result = validateForcePushBusinessRules([baseCategory({ id: "c1", parentId: "missing" })], []);
    expect(result).toMatch(/missing parent/);
  });

  it("rejects entry referencing non-existent category", () => {
    const result = validateForcePushBusinessRules([baseCategory({ id: "c1" })], [baseEntry({ categoryId: "nonexistent" })]);
    expect(result).toMatch(/missing category/);
  });

  it("rejects duplicate entry id", () => {
    const result = validateForcePushBusinessRules([baseCategory({})], [baseEntry({}), baseEntry({})]);
    expect(result).toMatch(/duplicate entry/);
  });

  it("rejects overlapping entries", () => {
    const result = validateForcePushBusinessRules(
      [baseCategory({ id: "c1" })],
      [
        baseEntry({ id: "e1", startTime: "2026-05-19T09:00:00.000Z", endTime: "2026-05-19T10:30:00.000Z" }),
        baseEntry({ id: "e2", startTime: "2026-05-19T10:00:00.000Z", endTime: "2026-05-19T11:00:00.000Z" }),
      ],
    );
    expect(result).toMatch(/overlapping/);
  });

  it("accepts valid payload returning null", () => {
    const result = validateForcePushBusinessRules([baseCategory({})], [baseEntry({})]);
    expect(result).toBeNull();
  });

  it("rejects duplicate quick note id without requiring categories", () => {
    const result = validateForcePushBusinessRules([], [], [baseQuickNote({}), baseQuickNote({})]);
    expect(result).toMatch(/duplicate quick note/);
  });

  it("accepts quick notes independently from category validation", () => {
    const result = validateForcePushBusinessRules([], [], [baseQuickNote({})]);
    expect(result).toBeNull();
  });

  it("rejects duplicate task id", () => {
    const result = validateForcePushBusinessRules([], [], [], [baseTask({}), baseTask({})]);
    expect(result).toMatch(/duplicate task/);
  });

  it("rejects self-referencing task parentId", () => {
    const result = validateForcePushBusinessRules([], [], [], [baseTask({ id: "a", parentId: "a" })]);
    expect(result).toMatch(/references itself/);
  });

  it("rejects task with missing parent", () => {
    const result = validateForcePushBusinessRules([], [], [], [baseTask({ id: "child", parentId: "missing" })]);
    expect(result).toMatch(/missing parent task/);
  });

  it("rejects third-level task parent structure", () => {
    const result = validateForcePushBusinessRules([], [], [], [
      baseTask({ id: "root", parentId: null }),
      baseTask({ id: "child", parentId: "root" }),
      baseTask({ id: "grandchild", parentId: "child" }),
    ]);
    expect(result).toMatch(/third level/);
  });

  it("accepts tasks independently from category validation", () => {
    const result = validateForcePushBusinessRules([], [], [], [baseTask({})]);
    expect(result).toBeNull();
  });

  it("accepts adjacent entries (endTime === startTime) without overlap", () => {
    const result = validateForcePushBusinessRules(
      [baseCategory({ id: "c1" })],
      [
        baseEntry({ id: "e1", startTime: "2026-05-19T09:00:00.000Z", endTime: "2026-05-19T10:00:00.000Z" }),
        baseEntry({ id: "e2", startTime: "2026-05-19T10:00:00.000Z", endTime: "2026-05-19T11:00:00.000Z" }),
      ],
    );
    expect(result).toBeNull();
  });
});
