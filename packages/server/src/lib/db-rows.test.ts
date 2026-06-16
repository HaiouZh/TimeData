import { describe, expect, it } from "vitest";
import { rowToQuickNote, rowToTask, type QuickNoteRow, type TaskRow } from "./db-rows.js";

const baseRow: QuickNoteRow = {
  id: "note-1",
  text: "hi",
  occurred_at: "2026-06-03T00:00:00.000Z",
  created_at: "2026-06-03T00:00:00.000Z",
  updated_at: "2026-06-03T00:00:00.000Z",
  source: null,
  source_label: null,
  pinned: 0,
};

describe("rowToQuickNote", () => {
  it("omits source metadata for legacy rows", () => {
    const note = rowToQuickNote(baseRow);

    expect(note.source).toBeUndefined();
    expect(note.sourceLabel).toBeUndefined();
  });

  it("maps agent source metadata", () => {
    const note = rowToQuickNote({ ...baseRow, source: "agent", source_label: "Hermes" });

    expect(note.source).toBe("agent");
    expect(note.sourceLabel).toBe("Hermes");
  });

  it("maps pinned rows and omits false pinned values", () => {
    expect(rowToQuickNote({ ...baseRow, pinned: 1 }).pinned).toBe(true);
    expect(rowToQuickNote({ ...baseRow, pinned: 0 }).pinned).toBeUndefined();
  });
});

const taskRow: TaskRow = {
  id: "t1",
  title: "想法",
  done: 0,
  recurrence: null,
  last_done_at: null,
  start_at: null,
  sort_order: 0,
  scheduled_at: null,
  subtasks: "[]",
  completed_count: 0,
  turn: "me",
  turn_at: "2026-06-16T01:00:00.000Z",
  created_at: "2026-06-16T00:00:00.000Z",
  updated_at: "2026-06-16T00:00:00.000Z",
};

describe("rowToTask", () => {
  it("maps turn and turnAt", () => {
    const task = rowToTask(taskRow);

    expect(task.turn).toBe("me");
    expect(task.turnAt).toBe("2026-06-16T01:00:00.000Z");
  });

  it("maps null turn columns to null", () => {
    const task = rowToTask({ ...taskRow, turn: null, turn_at: null });

    expect(task.turn).toBeNull();
    expect(task.turnAt).toBeNull();
  });

  it("maps completedAt and tags", () => {
    const task = rowToTask({
      ...taskRow,
      completed_at: "2026-06-16T02:00:00.000Z",
      tags: JSON.stringify(["agent", "idea"]),
    } as TaskRow);

    expect(task.completedAt).toBe("2026-06-16T02:00:00.000Z");
    expect(task.tags).toEqual(["agent", "idea"]);
  });

  it("defaults tags to [] when the column is null", () => {
    const task = rowToTask({
      ...taskRow,
      completed_at: null,
      tags: null,
    } as unknown as TaskRow);

    expect(task.tags).toEqual([]);
  });
});
