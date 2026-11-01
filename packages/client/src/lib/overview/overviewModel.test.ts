import { describe, expect, it } from "vitest";
import type { Goal, QuickNote, Task, Track, TrackStep } from "@timedata/shared";
import { buildOverviewStars } from "./overviewStars.js";
import { buildOverviewModel, clusterTitlesByStarKey } from "./overviewModel.js";

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

function track(overrides: Partial<Track> & Pick<Track, "id">): Track {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    status: overrides.status ?? "active",
    refs: [],
    createdAt: "2026-06-22T01:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-22T03:00:00.000Z",
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

describe("overviewModel", () => {
  it("活跃目标成团、成员星进团，归档目标不成团且计入 archivedGoals", () => {
    const { model } = build(
      [
        goal({ id: "g1", title: "G1", members: [{ kind: "task", id: "t1" }] }),
        goal({ id: "g2", title: "G2", status: "archived", members: [{ kind: "task", id: "t2" }] }),
      ],
      {
        tasks: [task({ id: "t1", updatedAt: ago(DAY) }), task({ id: "t2", updatedAt: ago(DAY) })],
      },
    );
    expect(model.clusters.find((c) => c.key === "goal:g1")?.litStars.map((s) => s.key)).toEqual([
      "task:t1",
    ]);
    expect(model.clusters.find((c) => c.key === "goal:g2")).toBeUndefined();
    expect(model.tally.archivedGoals).toBe(1);
    expect(
      model.clusters.find((c) => c.key === "loose")?.litStars.map((s) => s.key),
    ).toContain("task:t2");
  });

  it("子任务和父任务都是成员时，团里只有一颗星", () => {
    const { model } = build(
      [goal({ id: "g1", title: "G1", members: [{ kind: "task", id: "p" }, { kind: "task", id: "c" }] })],
      {
        tasks: [task({ id: "p", updatedAt: ago(DAY) }), task({ id: "c", parentId: "p", updatedAt: ago(DAY) })],
      },
    );
    expect(model.clusters.find((c) => c.key === "goal:g1")?.litStars.map((s) => s.key)).toEqual([
      "task:p",
    ]);
  });

  it("同一颗星属于两个目标：两团都有，totalStars 只算一次", () => {
    const { model } = build(
      [
        goal({ id: "g1", title: "G1", members: [{ kind: "task", id: "t1" }] }),
        goal({ id: "g2", title: "G2", members: [{ kind: "task", id: "t1" }] }),
      ],
      { tasks: [task({ id: "t1", updatedAt: ago(DAY) })] },
    );
    expect(model.clusters.find((c) => c.key === "goal:g1")?.litStars.map((s) => s.key)).toContain(
      "task:t1",
    );
    expect(model.clusters.find((c) => c.key === "goal:g2")?.litStars.map((s) => s.key)).toContain(
      "task:t1",
    );
    expect(model.tally.totalStars).toBe(1);
  });

  it("成员指向已删的东西：不进团、不报错，计入 danglingMemberRefs", () => {
    const { model } = build(
      [
        goal({
          id: "g1",
          title: "G1",
          members: [{ kind: "task", id: "gone" }, { kind: "track", id: "gone2" }],
        }),
      ],
      {},
    );
    const g1 = model.clusters.find((c) => c.key === "goal:g1");
    expect(g1).toBeDefined();
    expect(g1?.litStars).toEqual([]);
    expect(g1?.status).toBe("empty");
    expect(model.tally.danglingMemberRefs).toBe(2);
  });

  it("30 天前做完的成员不上天，但它的动静让团显示搁着，而不是还空着", () => {
    const { model } = build(
      [goal({ id: "g1", title: "G1", members: [{ kind: "task", id: "old" }] })],
      {
        tasks: [
          task({ id: "old", done: true, completedAt: ago(40 * DAY), updatedAt: ago(40 * DAY) }),
        ],
      },
    );
    const g1 = model.clusters.find((c) => c.key === "goal:g1");
    expect(g1?.status).toBe("shelved");
    expect(g1?.quietDays).toBe(40);
    expect(g1?.litStars).toEqual([]);
  });

  it("目标成员是 30 天前做完的根任务，它的子任务昨天刚做完：团算在推进", () => {
    const { model } = build(
      [goal({ id: "g1", title: "G1", members: [{ kind: "task", id: "q" }] })],
      {
        tasks: [
          task({ id: "q", done: true, completedAt: ago(40 * DAY), updatedAt: ago(40 * DAY) }),
          task({ id: "d1", parentId: "q", done: true, completedAt: ago(DAY), updatedAt: ago(DAY) }),
        ],
      },
    );
    const g1 = model.clusters.find((c) => c.key === "goal:g1");
    expect(g1?.status).toBe("moving");
    expect(g1?.lastActivityAt).toBe(ago(DAY));
    expect(g1?.litStars).toEqual([]);
  });

  it("目标成员只有那个子任务：它自己的完成动静也让团算在推进", () => {
    const { model } = build(
      [goal({ id: "g1", title: "G1", members: [{ kind: "task", id: "d1" }] })],
      {
        tasks: [
          task({ id: "q", done: true, completedAt: ago(40 * DAY), updatedAt: ago(40 * DAY) }),
          task({ id: "d1", parentId: "q", done: true, completedAt: ago(DAY), updatedAt: ago(DAY) }),
        ],
      },
    );
    const g1 = model.clusters.find((c) => c.key === "goal:g1");
    expect(g1?.status).toBe("moving");
    expect(g1?.lastActivityAt).toBe(ago(DAY));
  });

  it("轨道两天前刚结束：团里没有星，也算在推进", () => {
    const { model } = build(
      [goal({ id: "g1", title: "G1", members: [{ kind: "track", id: "k" }] })],
      { tracks: [track({ id: "k", status: "concluded", updatedAt: ago(2 * DAY) })] },
    );
    const g1 = model.clusters.find((c) => c.key === "goal:g1");
    expect(g1?.status).toBe("moving");
    expect(g1?.litStars).toEqual([]);
  });

  it("没归团的做完的事按前缀分小团，不分大小写，团名取最近那颗的写法", () => {
    const { model } = build([], {
      tasks: [
        task({
          id: "a",
          title: "run · a",
          done: true,
          completedAt: "2026-10-30T00:00:00.000Z",
          updatedAt: "2026-10-30T00:00:00.000Z",
        }),
        task({
          id: "b",
          title: "Run · b",
          done: true,
          completedAt: "2026-10-31T00:00:00.000Z",
          updatedAt: "2026-10-31T00:00:00.000Z",
        }),
      ],
    });
    const prefix = model.clusters.find((c) => c.key === "prefix:run");
    expect(prefix).toMatchObject({ kind: "prefix", title: "Run", goalId: null, status: "moving" });
    expect(prefix?.litStars.map((s) => s.key)).toEqual(["task:b", "task:a"]);
  });

  it("前缀和活跃目标同名的并进目标，不另出小团", () => {
    const { model } = build(
      [goal({ id: "gA", title: "TimeData" }), goal({ id: "gB", title: "timedata" })],
      {
        tasks: [
          task({ id: "s", title: "timedata · 修同步", done: true, completedAt: ago(DAY), updatedAt: ago(DAY) }),
        ],
      },
    );
    expect(
      model.clusters.find((c) => c.key === "goal:gA")?.litStars.map((s) => s.key),
    ).toContain("task:s");
    expect(
      model.clusters.find((c) => c.key === "goal:gB")?.litStars.map((s) => s.key),
    ).toContain("task:s");
    expect(model.clusters.find((c) => c.key === "prefix:timedata")).toBeUndefined();
    const loose = model.clusters.find((c) => c.key === "loose");
    expect([...(loose?.litStars ?? []), ...(loose?.darkStars ?? [])].map((s) => s.key)).not.toContain(
      "task:s",
    );
  });

  it("并进目标的星和前缀小团里的星，20 天前做完的也不沉暗处", () => {
    const { model } = build([goal({ id: "g", title: "TimeData" })], {
      tasks: [
        task({
          id: "x",
          title: "TimeData · x",
          done: true,
          completedAt: ago(20 * DAY),
          updatedAt: ago(20 * DAY),
        }),
        task({
          id: "y",
          title: "Run · y",
          done: true,
          completedAt: ago(20 * DAY),
          updatedAt: ago(20 * DAY),
        }),
      ],
    });
    const g = model.clusters.find((c) => c.key === "goal:g");
    expect(g?.litStars.map((s) => s.key)).toContain("task:x");
    expect(g?.darkStars).toEqual([]);
    const prefix = model.clusters.find((c) => c.key === "prefix:run");
    expect(prefix?.litStars.map((s) => s.key)).toContain("task:y");
    expect(prefix?.darkStars).toEqual([]);
  });

  it("没前缀、没归团的星进散着：14 天前的沉暗处，置顶的不沉", () => {
    const { model } = build([], {
      quickNotes: [
        note({ id: "n1", text: "n1", occurredAt: ago(15 * DAY), updatedAt: ago(15 * DAY) }),
        note({
          id: "n2",
          text: "n2",
          occurredAt: ago(15 * DAY),
          updatedAt: ago(15 * DAY),
          pinned: true,
        }),
        note({ id: "n3", text: "n3", occurredAt: ago(DAY), updatedAt: ago(DAY) }),
      ],
    });
    const loose = model.clusters.find((c) => c.key === "loose");
    expect(loose).toMatchObject({
      kind: "loose",
      title: "还没归到哪件事",
      goalId: null,
      status: null,
      lastActivityAt: null,
      quietDays: null,
    });
    expect(loose?.darkStars.map((s) => s.key)).toEqual(["quick_note:n1"]);
    expect(loose?.litStars.map((s) => s.key)).toEqual(["quick_note:n3", "quick_note:n2"]);
    expect(model.tally.darkStars).toBe(1);
    expect(model.tally.litStars).toBe(2);
  });

  it("未完成的待办即使带前缀也留在散着", () => {
    const { model } = build([], {
      tasks: [task({ id: "shoe", title: "Run · 买鞋", updatedAt: ago(DAY) })],
    });
    expect(
      model.clusters.find((c) => c.key === "loose")?.litStars.map((s) => s.key),
    ).toContain("task:shoe");
    expect(model.clusters.find((c) => c.key === "prefix:run")).toBeUndefined();
  });

  it("排序：在推进 → 在攒 → 固定 → 搁着 → 还空着，散着最后", () => {
    const { model } = build(
      [
        goal({ id: "gEmptyB", title: "Beta" }),
        goal({
          id: "gShelved",
          title: "Shelved",
          members: [{ kind: "task", id: "sOld" }],
        }),
        goal({ id: "gFixed", title: "Fixed", members: [{ kind: "task", id: "r1" }] }),
        goal({ id: "gMoving2", title: "Moving2", members: [{ kind: "task", id: "m2" }] }),
        goal({ id: "gSaving", title: "Saving", members: [{ kind: "task", id: "sv" }] }),
        goal({ id: "gEmptyA", title: "Alpha" }),
        goal({ id: "gMoving", title: "Moving", members: [{ kind: "task", id: "m1" }] }),
      ],
      {
        tasks: [
          task({ id: "sOld", updatedAt: ago(20 * DAY) }),
          task({
            id: "r1",
            recurrence: { freq: "daily", interval: 1, basis: "due" },
            updatedAt: ago(10 * DAY),
          }),
          task({ id: "m2", done: true, completedAt: ago(3 * DAY), updatedAt: ago(3 * DAY) }),
          task({ id: "sv", updatedAt: ago(DAY) }),
          task({ id: "m1", done: true, completedAt: ago(DAY), updatedAt: ago(DAY) }),
        ],
        quickNotes: [note({ id: "n", text: "n", occurredAt: ago(DAY), updatedAt: ago(DAY) })],
      },
    );
    expect(model.clusters.map((c) => c.key)).toEqual([
      "goal:gMoving",
      "goal:gMoving2",
      "goal:gSaving",
      "goal:gFixed",
      "goal:gShelved",
      "goal:gEmptyA",
      "goal:gEmptyB",
      "loose",
    ]);
  });

  it("对账：速记、未完成的根待办、活跃轨道、近 30 天做完的事，每一颗都在某一团里（亮的或暗的）", () => {
    const { index, model } = build(
      [
        goal({
          id: "g1",
          title: "G1",
          members: [
            { kind: "task", id: "tOpen" },
            { kind: "track", id: "kActive" },
            { kind: "task", id: "gone" },
            { kind: "task", id: "p" },
            { kind: "task", id: "c" },
          ],
        }),
        goal({
          id: "g2",
          title: "G2",
          status: "archived",
          members: [{ kind: "task", id: "tArch" }],
        }),
      ],
      {
        tasks: [
          task({ id: "tOpen", updatedAt: ago(DAY) }),
          task({ id: "p", updatedAt: ago(DAY) }),
          task({ id: "c", parentId: "p", updatedAt: ago(DAY) }),
          task({ id: "tArch", updatedAt: ago(DAY) }),
          task({
            id: "runDone",
            title: "Run · 跑完",
            done: true,
            completedAt: ago(DAY),
            updatedAt: ago(DAY),
          }),
          task({
            id: "r1",
            recurrence: { freq: "daily", interval: 1, basis: "due" },
            updatedAt: ago(10 * DAY),
          }),
          task({
            id: "o1",
            ruleId: "r1",
            done: true,
            scheduledAt: ago(2 * DAY),
            completedAt: ago(2 * DAY),
            updatedAt: ago(2 * DAY),
          }),
          task({
            id: "o2",
            ruleId: "r1",
            done: true,
            scheduledAt: ago(DAY),
            completedAt: ago(DAY),
            updatedAt: ago(DAY),
          }),
        ],
        tracks: [track({ id: "kActive", updatedAt: ago(DAY) })],
        quickNotes: [
          note({ id: "nDay", text: "day note", occurredAt: ago(DAY), updatedAt: ago(DAY) }),
          note({
            id: "nOld",
            text: "old note",
            occurredAt: ago(30 * DAY),
            updatedAt: ago(30 * DAY),
          }),
        ],
      },
    );
    const titles = clusterTitlesByStarKey(model.clusters);
    for (const star of index.stars) {
      expect(titles.get(star.key)?.length ?? 0).toBeGreaterThan(0);
    }
    expect(titles.get("task:tArch")).toEqual(["还没归到哪件事"]);
  });

  it("团的星种计数把暗处的星也算上", () => {
    const { model } = build([], {
      quickNotes: [
        note({ id: "nOld", occurredAt: ago(20 * DAY), updatedAt: ago(20 * DAY) }),
        note({ id: "nNew", occurredAt: ago(DAY), updatedAt: ago(DAY) }),
      ],
      tasks: [task({ id: "tDone", title: "买菜", done: true, completedAt: ago(2 * DAY), updatedAt: ago(2 * DAY) })],
    });
    const loose = model.clusters.find((c) => c.key === "loose");
    expect(loose?.darkStars.map((s) => s.key)).toEqual(["quick_note:nOld"]);
    expect(loose?.kindCounts).toEqual({ input: 2, done: 1, progress: 0, recurring: 0 });
  });

  it("统计按种类数全部星，并逐项带出不上天的去处", () => {
    const { model } = build([], {
      quickNotes: [note({ id: "n1", occurredAt: ago(DAY), updatedAt: ago(DAY) })],
      tasks: [
        task({ id: "p", updatedAt: ago(DAY) }),
        task({ id: "c", parentId: "p", updatedAt: ago(DAY) }),
        task({ id: "dNew", done: true, completedAt: ago(DAY), updatedAt: ago(DAY) }),
        task({ id: "dOld", done: true, completedAt: ago(40 * DAY), updatedAt: ago(40 * DAY) }),
        task({ id: "r1", recurrence: { freq: "daily", interval: 1, basis: "due" }, updatedAt: ago(DAY) }),
      ],
      tracks: [
        track({ id: "kActive", status: "active", updatedAt: ago(DAY) }),
        track({ id: "kDone", status: "concluded", updatedAt: ago(DAY) }),
        track({ id: "kParked", status: "parked", updatedAt: ago(DAY) }),
      ],
    });
    expect(model.tally.starsByKind).toEqual({ input: 2, done: 1, progress: 1, recurring: 1 });
    expect(model.tally.exclusions).toEqual({
      occurrence: 0,
      child: 1,
      "rule-exhausted": 0,
      "done-old": 1,
      "track-concluded": 1,
      "track-parked": 1,
    });
  });

  it("clusterTitlesByStarKey 给出每颗星所在的全部团名", () => {
    const { model } = build(
      [
        goal({ id: "gA", title: "目标A", members: [{ kind: "task", id: "t1" }] }),
        goal({ id: "gB", title: "目标B", members: [{ kind: "task", id: "t1" }] }),
      ],
      { tasks: [task({ id: "t1", updatedAt: ago(DAY) })] },
    );
    expect(clusterTitlesByStarKey(model.clusters).get("task:t1")).toEqual(["目标A", "目标B"]);
  });
});
