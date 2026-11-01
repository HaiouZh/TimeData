import { describe, expect, it } from "vitest";
import type { Goal, QuickNote, Task, Track, TrackStep } from "@timedata/shared";
import { buildOverviewStars } from "./overviewStars.js";
import { buildOverviewModel } from "./overviewModel.js";
import { searchOverview } from "./overviewSearch.js";

const now = new Date("2026-11-01T12:00:00.000Z");
const DAY = 86_400_000;
const ago = (ms: number): string => new Date(now.getTime() - ms).toISOString();

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    title: "发布 v2",
    kind: "project",
    status: "active",
    members: [],
    prerequisites: [],
    createdAt: "2026-06-22T01:00:00.000Z",
    updatedAt: "2026-06-22T01:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<Task> & Pick<Task, "id">): Task {
  return {
    id: overrides.id,
    parentId: null,
    title: overrides.title ?? overrides.id,
    done: overrides.done ?? false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: overrides.completedAt ?? null,
    tags: [],
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: "2026-06-22T01:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-22T02:00:00.000Z",
    ...overrides,
  };
}

function note(overrides: Partial<QuickNote> & Pick<QuickNote, "id">): QuickNote {
  return {
    id: overrides.id,
    text: overrides.text ?? overrides.id,
    occurredAt: overrides.occurredAt ?? "2026-10-01T00:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-10-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function build(
  goals: Goal[],
  parts: {
    tasks?: Task[];
    tracks?: Track[];
    steps?: TrackStep[];
    quickNotes?: QuickNote[];
  } = {},
) {
  const tasks = parts.tasks ?? [];
  const tracks = parts.tracks ?? [];
  const steps = parts.steps ?? [];
  const quickNotes = parts.quickNotes ?? [];
  const index = buildOverviewStars({ tasks, tracks, steps, quickNotes, now });
  const model = buildOverviewModel({ goals, index, now });
  return { index, model };
}

describe("overviewSearch", () => {
  it("只有空白的查询返回 null", () => {
    const { model } = build([], {});
    expect(searchOverview(model.clusters, "")).toBeNull();
    expect(searchOverview(model.clusters, "   ")).toBeNull();
  });

  it("按全部词匹配星，暗处的也能搜到，匹配的放进 litStars", () => {
    const { model } = build([], {
      quickNotes: [
        note({
          id: "nOld",
          text: "old Galaxy note",
          occurredAt: ago(20 * DAY),
          updatedAt: ago(20 * DAY),
        }),
        note({ id: "nNew", text: "new note", occurredAt: ago(DAY), updatedAt: ago(DAY) }),
      ],
    });
    const result = searchOverview(model.clusters, "galaxy OLD");
    expect(result?.clusters.find((c) => c.key === "loose")?.litStars.map((s) => s.key)).toEqual([
      "quick_note:nOld",
    ]);
    expect(result?.clusters.find((c) => c.key === "loose")?.darkStars).toEqual([]);
    expect(result?.matchCount).toBe(1);
  });

  it("团名命中时整团留下", () => {
    const { model } = build(
      [
        goal({
          id: "g",
          title: "Galaxy Sky",
          members: [{ kind: "task", id: "t1" }, { kind: "task", id: "t2" }],
        }),
      ],
      {
        tasks: [
          task({ id: "t1", title: "买菜", updatedAt: ago(DAY) }),
          task({ id: "t2", title: "跑步", updatedAt: ago(DAY) }),
        ],
      },
    );
    const result = searchOverview(model.clusters, "galaxy");
    const g = result?.clusters.find((c) => c.key === "goal:g");
    expect(g).toBeDefined();
    expect(g?.litStars.map((s) => s.key).sort()).toEqual(["task:t1", "task:t2"]);
    expect(result?.matchCount).toBe(2);
  });

  it("只留下部分星的团，星种计数按留下的星重算", () => {
    const { model } = build([], {
      quickNotes: [
        note({ id: "nA", text: "跑鞋", occurredAt: ago(DAY), updatedAt: ago(DAY) }),
        note({ id: "nB", text: "看书", occurredAt: ago(DAY), updatedAt: ago(DAY) }),
        note({ id: "nC", text: "买菜", occurredAt: ago(20 * DAY), updatedAt: ago(20 * DAY) }),
      ],
      tasks: [task({ id: "tD", title: "跑步", done: true, completedAt: ago(2 * DAY), updatedAt: ago(2 * DAY) })],
    });
    const loose = model.clusters.find((c) => c.key === "loose");
    expect(loose?.kindCounts).toEqual({ input: 3, done: 1, progress: 0, recurring: 0 });
    const result = searchOverview(model.clusters, "跑");
    const searched = result?.clusters.find((c) => c.key === "loose");
    expect(searched?.litStars.map((s) => s.key)).toEqual(["quick_note:nA", "task:tD"]);
    expect(searched?.kindCounts).toEqual({ input: 1, done: 1, progress: 0, recurring: 0 });
  });

  it("没有匹配的团被拿掉，matchCount 按星去重", () => {
    const { model } = build(
      [
        goal({ id: "gA", title: "目标A", members: [{ kind: "task", id: "t1" }] }),
        goal({ id: "gB", title: "目标B", members: [{ kind: "task", id: "t1" }] }),
        goal({ id: "gC", title: "目标C", members: [{ kind: "task", id: "t3" }] }),
      ],
      {
        tasks: [
          task({ id: "t1", title: "Run 鞋", updatedAt: ago(DAY) }),
          task({ id: "t3", title: "其他", updatedAt: ago(DAY) }),
        ],
      },
    );
    const result = searchOverview(model.clusters, "鞋");
    expect(result?.clusters.map((c) => c.key)).toEqual(["goal:gA", "goal:gB"]);
    expect(result?.matchCount).toBe(1);
  });
});
