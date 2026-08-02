import type { QuickNote } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import type { QuickNoteDisplayItem } from "../lib/quickNoteDisplay.js";
import { groupDisplayItemsByDay } from "./dayGroups.js";

function note(id: string, occurredAt: string): QuickNote {
  return { id, text: id, occurredAt, createdAt: occurredAt, updatedAt: occurredAt };
}

function dateItem(localDate: string, label: string): QuickNoteDisplayItem {
  return { type: "date", key: `date:${localDate}`, label, localDate };
}

function noteItem(id: string, occurredAt: string): QuickNoteDisplayItem {
  return { type: "note", key: `note:${id}`, note: note(id, occurredAt) };
}

describe("groupDisplayItemsByDay", () => {
  it("空数组产出空分组", () => {
    expect(groupDisplayItemsByDay([])).toEqual([]);
  });

  it("单天单条：一个组，日期条 + 一条速记", () => {
    const groups = groupDisplayItemsByDay([dateItem("2026-06-01", "6月1日"), noteItem("a", "2026-06-01T04:00:00.000Z")]);

    expect(groups.length).toBe(1);
    expect(groups[0].key).toBe("date:2026-06-01");
    expect(groups[0].date).toEqual({ label: "6月1日", localDate: "2026-06-01" });
    expect(groups[0].notes.map((entry) => entry.note.id)).toEqual(["a"]);
  });

  it("单天多条：同一天的速记全部落进同一个组", () => {
    const groups = groupDisplayItemsByDay([
      dateItem("2026-06-01", "6月1日"),
      noteItem("a", "2026-06-01T04:00:00.000Z"),
      noteItem("b", "2026-06-01T05:00:00.000Z"),
      noteItem("c", "2026-06-01T06:00:00.000Z"),
    ]);

    expect(groups.length).toBe(1);
    expect(groups[0].notes.map((entry) => entry.note.id)).toEqual(["a", "b", "c"]);
  });

  it("多天：每天各自一组，速记不串组", () => {
    const groups = groupDisplayItemsByDay([
      dateItem("2026-06-01", "6月1日"),
      noteItem("a", "2026-06-01T04:00:00.000Z"),
      dateItem("2026-06-02", "6月2日"),
      noteItem("b", "2026-06-02T04:00:00.000Z"),
      noteItem("c", "2026-06-02T05:00:00.000Z"),
      dateItem("2026-06-03", "6月3日"),
      noteItem("d", "2026-06-03T04:00:00.000Z"),
    ]);

    expect(groups.map((group) => group.date?.localDate)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(groups.map((group) => group.notes.map((entry) => entry.note.id))).toEqual([["a"], ["b", "c"], ["d"]]);
  });

  it("key 逐组唯一——同一父级下的 React 兄弟不能撞 key", () => {
    const groups = groupDisplayItemsByDay([
      dateItem("2026-06-01", "6月1日"),
      noteItem("a", "2026-06-01T04:00:00.000Z"),
      dateItem("2026-06-02", "6月2日"),
      noteItem("b", "2026-06-02T04:00:00.000Z"),
    ]);

    expect(new Set(groups.map((group) => group.key)).size).toBe(groups.length);
  });

  it("防御档：速记出现在任何日期项之前时照常渲染，不吞条目", () => {
    const groups = groupDisplayItemsByDay([
      noteItem("orphan", "2026-05-31T04:00:00.000Z"),
      dateItem("2026-06-01", "6月1日"),
      noteItem("a", "2026-06-01T04:00:00.000Z"),
    ]);

    // 丢速记比少一条日期条严重得多：孤儿条目自成一组、date 为 null（该组不渲染日期条）。
    expect(groups.length).toBe(2);
    expect(groups[0].date).toBeNull();
    expect(groups[0].notes.map((entry) => entry.note.id)).toEqual(["orphan"]);
    expect(groups[1].date?.localDate).toBe("2026-06-01");
    expect(groups[1].notes.map((entry) => entry.note.id)).toEqual(["a"]);
  });

  it("防御档的组 key 不与后续日期组撞车", () => {
    const groups = groupDisplayItemsByDay([
      noteItem("orphan", "2026-05-31T04:00:00.000Z"),
      dateItem("2026-06-01", "6月1日"),
      noteItem("a", "2026-06-01T04:00:00.000Z"),
    ]);

    expect(new Set(groups.map((group) => group.key)).size).toBe(groups.length);
  });
});
