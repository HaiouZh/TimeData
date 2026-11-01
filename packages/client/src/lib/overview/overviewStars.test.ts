import { describe, expect, it } from "vitest";
import type { QuickNote, Task, Track, TrackStep } from "@timedata/shared";
import { getDateString } from "../time.js";
import { buildOverviewStars } from "./overviewStars.js";

const now = new Date("2026-11-01T12:00:00.000Z");
const DAY = 86_400_000;
const ago = (ms: number): string => new Date(now.getTime() - ms).toISOString();

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
    weight: 0,
    completedAt: overrides.completedAt ?? null,
    tags: [],
    ruleId: null,
    sessionId: null,
    skipped: false,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
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

function step(overrides: Partial<TrackStep> & Pick<TrackStep, "id" | "trackId">): TrackStep {
  return {
    id: overrides.id,
    trackId: overrides.trackId,
    source: "agent",
    content: "",
    startedAt: overrides.startedAt ?? "2026-06-22T04:00:00.000Z",
    endedAt: overrides.endedAt ?? null,
    refs: [],
    tags: [],
    seq: overrides.seq ?? 0,
    createdAt: overrides.createdAt ?? "2026-06-22T04:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-22T04:00:00.000Z",
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

describe("overviewStars", () => {
  it("速记都是 input 星，at 取 occurredAt 与 updatedAt 里晚的，置顶带出来，href 带应用时区日期", () => {
    const result = buildOverviewStars({
      tasks: [],
      tracks: [],
      steps: [],
      quickNotes: [
        note({
          id: "n1",
          occurredAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-20T00:00:00.000Z",
          pinned: true,
        }),
        note({ id: "n2" }),
      ],
      now,
    });

    expect(result.stars.find((s) => s.key === "quick_note:n1")).toMatchObject({
      key: "quick_note:n1",
      kind: "input",
      at: "2026-10-20T00:00:00.000Z",
      pinned: true,
    });
    expect(result.stars.find((s) => s.key === "quick_note:n1")?.href).toBe(
      `/quick-notes?date=${getDateString(new Date("2026-10-01T00:00:00.000Z"))}`,
    );
    expect(result.stars.find((s) => s.key === "quick_note:n1")?.source.type).toBe("quick_note");
    expect(result.stars.find((s) => s.key === "quick_note:n2")?.pinned).toBe(false);
    expect(result.placements.size).toBe(0);
  });

  it("速记标题取第一行非空文字，超过 80 字截断", () => {
    const result = buildOverviewStars({
      tasks: [],
      tracks: [],
      steps: [],
      quickNotes: [
        note({ id: "a", text: "\n\nhttps://x.com/abc\n第二行" }),
        note({ id: "b", text: "字".repeat(81) }),
        note({ id: "c", text: "字".repeat(80) }),
      ],
      now,
    });

    expect(result.stars.find((s) => s.key === "quick_note:a")?.title).toBe("https://x.com/abc");
    expect(result.stars.find((s) => s.key === "quick_note:b")?.title).toBe(`${"字".repeat(80)}…`);
    expect(result.stars.find((s) => s.key === "quick_note:c")?.title).toBe("字".repeat(80));
  });

  it("searchText 已小写，待办带上标签，轨道带上摘要", () => {
    const result = buildOverviewStars({
      tasks: [task({ id: "t", title: "Run 买鞋", tags: ["Gear", "Shoes"] })],
      tracks: [track({ id: "g", title: "Galaxy", summary: "Sky Map" })],
      steps: [],
      quickNotes: [note({ id: "n", text: "Hello World\n第二行" })],
      now,
    });

    expect(result.stars.find((s) => s.key === "quick_note:n")?.searchText).toBe("hello world\n第二行");
    expect(result.stars.find((s) => s.key === "task:t")?.searchText).toBe("run 买鞋 gear shoes");
    expect(result.stars.find((s) => s.key === "track:g")?.searchText).toBe("galaxy sky map");
  });

  it("未完成的根待办是 input 星，at = updatedAt，href 为 /todo?taskId=<id>", () => {
    const result = buildOverviewStars({
      tasks: [task({ id: "t1", updatedAt: "2026-10-25T00:00:00.000Z" })],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.find((s) => s.key === "task:t1")).toMatchObject({
      key: "task:t1",
      kind: "input",
      at: "2026-10-25T00:00:00.000Z",
      href: "/todo?taskId=t1",
    });
    expect(result.placements.get("task:t1")).toEqual({ type: "star", starKey: "task:t1" });
  });

  it("近 30 天做完的是 done 星，更早的不上天但留下动静", () => {
    const result = buildOverviewStars({
      tasks: [
        task({ id: "t1", done: true, completedAt: ago(29 * DAY) }),
        task({ id: "t2", done: true, completedAt: ago(31 * DAY) }),
      ],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    const t1 = result.stars.find((s) => s.key === "task:t1");
    expect(t1?.kind).toBe("done");
    expect(t1?.at).toBe(ago(29 * DAY));
    expect(result.stars.find((s) => s.key === "task:t2")).toBeUndefined();
    expect(result.placements.get("task:t2")).toEqual({
      type: "excluded",
      reason: "done-old",
      event: { kind: "done", at: ago(31 * DAY) },
    });
    expect(result.exclusions["done-old"]).toBe(1);
  });

  it("completedAt 为空的已完成待办用 updatedAt 判窗口", () => {
    const result = buildOverviewStars({
      tasks: [task({ id: "t3", done: true, completedAt: null, updatedAt: ago(5 * DAY) })],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    const t3 = result.stars.find((s) => s.key === "task:t3");
    expect(t3?.kind).toBe("done");
    expect(t3?.at).toBe(ago(5 * DAY));
  });

  it("重复模板只出一颗 ↻，发生不单列，at 取发生里最晚的完成时刻", () => {
    const result = buildOverviewStars({
      tasks: [
        task({
          id: "r1",
          recurrence: { freq: "daily", interval: 1, basis: "due" },
          updatedAt: "2026-10-01T00:00:00.000Z",
        }),
        task({
          id: "o1",
          ruleId: "r1",
          done: true,
          scheduledAt: "2026-10-28T00:00:00.000Z",
          completedAt: "2026-10-28T09:00:00.000Z",
        }),
        task({
          id: "o2",
          ruleId: "r1",
          done: true,
          scheduledAt: "2026-10-30T00:00:00.000Z",
          completedAt: "2026-10-30T09:00:00.000Z",
        }),
      ],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.filter((s) => s.key.startsWith("task:"))).toHaveLength(1);
    const r1 = result.stars.find((s) => s.key === "task:r1");
    expect(r1?.kind).toBe("recurring");
    expect(r1?.at).toBe("2026-10-30T09:00:00.000Z");
    expect(result.placements.get("task:o1")).toEqual({ type: "star", starKey: "task:r1" });
    expect(result.placements.get("task:o2")).toEqual({ type: "star", starKey: "task:r1" });
    expect(result.exclusions.occurrence).toBe(2);
  });

  it("重复规则已结束的不上天", () => {
    const result = buildOverviewStars({
      tasks: [
        task({ id: "r2", recurrence: { freq: "daily", interval: 1, basis: "due", count: 1 } }),
        task({
          id: "o3",
          ruleId: "r2",
          done: true,
          scheduledAt: "2026-10-20T00:00:00.000Z",
          completedAt: "2026-10-20T09:00:00.000Z",
        }),
      ],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.find((s) => s.key === "task:r2")).toBeUndefined();
    expect(result.placements.get("task:r2")).toEqual({ type: "excluded", reason: "rule-exhausted", event: null });
    expect(result.placements.get("task:o3")).toEqual({ type: "excluded", reason: "occurrence", event: null });
    expect(result.exclusions["rule-exhausted"]).toBe(1);
  });

  it("子任务并进根任务那颗星，做完的子任务给根星加动静", () => {
    const result = buildOverviewStars({
      tasks: [
        task({ id: "p" }),
        task({ id: "c1", parentId: "p", done: true, completedAt: "2026-10-31T08:00:00.000Z" }),
        task({ id: "c2", parentId: "c1" }),
      ],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.filter((s) => s.key.startsWith("task:"))).toHaveLength(1);
    expect(result.placements.get("task:c1")).toEqual({ type: "star", starKey: "task:p" });
    expect(result.placements.get("task:c2")).toEqual({ type: "star", starKey: "task:p" });
    expect(result.stars.find((s) => s.key === "task:p")?.extraEvents).toEqual([
      { kind: "done", at: "2026-10-31T08:00:00.000Z" },
    ]);
    expect(result.exclusions.child).toBe(2);
  });

  it("根任务不上天时，子任务也不上天", () => {
    const result = buildOverviewStars({
      tasks: [
        task({ id: "q", done: true, completedAt: ago(40 * DAY) }),
        task({ id: "d1", parentId: "q", done: true, completedAt: ago(DAY) }),
      ],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.find((s) => s.key === "task:q")).toBeUndefined();
    expect(result.stars.find((s) => s.key === "task:d1")).toBeUndefined();
    expect(result.placements.get("task:d1")).toEqual({ type: "excluded", reason: "child", event: { kind: "done", at: ago(DAY) } });
    expect(result.placements.get("task:q")).toEqual({ type: "excluded", reason: "done-old", event: { kind: "done", at: ago(DAY) } });
    expect(result.exclusions.child).toBe(1);
  });

  it("根任务不上天时，没做完的子任务不带动静，也不改根的动静", () => {
    const result = buildOverviewStars({
      tasks: [
        task({ id: "q", done: true, completedAt: ago(40 * DAY) }),
        task({ id: "d1", parentId: "q", updatedAt: ago(DAY) }),
      ],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.find((s) => s.key === "task:q")).toBeUndefined();
    expect(result.stars.find((s) => s.key === "task:d1")).toBeUndefined();
    expect(result.placements.get("task:d1")).toEqual({ type: "excluded", reason: "child", event: null });
    expect(result.placements.get("task:q")).toEqual({
      type: "excluded",
      reason: "done-old",
      event: { kind: "done", at: ago(40 * DAY) },
    });
    expect(result.exclusions.child).toBe(1);
  });

  it("根任务不上天时，子任务里最晚的那次完成记在根的动静上", () => {
    const result = buildOverviewStars({
      tasks: [
        task({ id: "q", done: true, completedAt: ago(40 * DAY) }),
        task({ id: "d1", parentId: "q", done: true, completedAt: ago(DAY) }),
        task({ id: "d2", parentId: "q", done: true, completedAt: ago(20 * DAY) }),
      ],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.find((s) => s.key === "task:q")).toBeUndefined();
    expect(result.stars.find((s) => s.key === "task:d1")).toBeUndefined();
    expect(result.stars.find((s) => s.key === "task:d2")).toBeUndefined();
    expect(result.placements.get("task:q")).toEqual({
      type: "excluded",
      reason: "done-old",
      event: { kind: "done", at: ago(DAY) },
    });
    expect(result.placements.get("task:d2")).toEqual({
      type: "excluded",
      reason: "child",
      event: { kind: "done", at: ago(20 * DAY) },
    });
    expect(result.exclusions.child).toBe(2);
  });

  it("重复模板的发生里夹着没做完的那次，at 仍取做完里最晚的", () => {
    const result = buildOverviewStars({
      tasks: [
        task({ id: "r1", recurrence: { freq: "daily", interval: 1, basis: "due" }, updatedAt: "2026-10-01T00:00:00.000Z" }),
        task({ id: "o1", ruleId: "r1", done: true, scheduledAt: "2026-10-28T00:00:00.000Z", completedAt: "2026-10-28T09:00:00.000Z" }),
        task({ id: "o2", ruleId: "r1", scheduledAt: "2026-10-29T00:00:00.000Z" }),
        task({ id: "o3", ruleId: "r1", done: true, scheduledAt: "2026-10-30T00:00:00.000Z", completedAt: "2026-10-30T09:00:00.000Z" }),
      ],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.find((s) => s.key === "task:r1")?.at).toBe("2026-10-30T09:00:00.000Z");
  });

  it("恰好 30 天整之前做完的仍是 done 星", () => {
    const result = buildOverviewStars({
      tasks: [task({ id: "t30", done: true, completedAt: ago(30 * DAY) })],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.find((s) => s.key === "task:t30")?.kind).toBe("done");
    expect(result.exclusions["done-old"]).toBe(0);
  });

  it("速记标题按字符截断，不把表情劈成两半", () => {
    const grin = String.fromCodePoint(0x1f600);
    const result = buildOverviewStars({
      tasks: [],
      tracks: [],
      steps: [],
      quickNotes: [note({ id: "e81", text: grin.repeat(81) }), note({ id: "e41", text: grin.repeat(41) })],
      now,
    });

    expect(result.stars.find((s) => s.key === "quick_note:e81")?.title).toBe(`${grin.repeat(80)}…`);
    expect(result.stars.find((s) => s.key === "quick_note:e41")?.title).toBe(grin.repeat(41));
  });

  it("父任务已删的子任务当根待办上天", () => {
    const result = buildOverviewStars({
      tasks: [task({ id: "x", parentId: "gone" })],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.find((s) => s.key === "task:x")?.kind).toBe("input");
    expect(result.exclusions.child).toBe(0);
  });

  it("父链成环的当根待办上天", () => {
    const result = buildOverviewStars({
      tasks: [task({ id: "a", parentId: "b" }), task({ id: "b", parentId: "a" })],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.find((s) => s.key === "task:a")?.kind).toBe("input");
    expect(result.stars.find((s) => s.key === "task:b")?.kind).toBe("input");
    expect(result.exclusions.child).toBe(0);
  });

  it("模板挂在自己某次发生的下面：不无限递归，两条都指向同一颗星", () => {
    const result = buildOverviewStars({
      tasks: [
        task({ id: "r1", parentId: "o1", recurrence: { freq: "daily", interval: 1, basis: "due" } }),
        task({ id: "o1", ruleId: "r1", done: true, completedAt: ago(DAY) }),
      ],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.length).toBe(1);
    const only = result.stars[0]?.key;
    expect(result.placements.get("task:r1")).toEqual({ type: "star", starKey: only });
    expect(result.placements.get("task:o1")).toEqual({ type: "star", starKey: only });
  });

  it("模板已删的发生：没跳过的上天，跳过的不上天", () => {
    const result = buildOverviewStars({
      tasks: [task({ id: "o4", ruleId: "gone" }), task({ id: "o5", ruleId: "gone", skipped: true })],
      tracks: [],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.find((s) => s.key === "task:o4")?.kind).toBe("input");
    expect(result.placements.get("task:o5")).toEqual({ type: "excluded", reason: "occurrence", event: null });
    expect(result.exclusions.occurrence).toBe(1);
  });

  it("活跃轨道是 progress 星，at 取轨道和步骤里最晚的动静", () => {
    const result = buildOverviewStars({
      tasks: [],
      tracks: [track({ id: "k1", status: "active", updatedAt: "2026-10-20T00:00:00.000Z" })],
      steps: [
        step({
          id: "s1",
          trackId: "k1",
          startedAt: "2026-10-21T00:00:00.000Z",
          endedAt: "2026-10-22T00:00:00.000Z",
          updatedAt: "2026-10-21T00:00:00.000Z",
        }),
      ],
      quickNotes: [],
      now,
    });

    expect(result.stars.find((s) => s.key === "track:k1")).toMatchObject({
      key: "track:k1",
      kind: "progress",
      at: "2026-10-22T00:00:00.000Z",
      href: "/tracks/k1",
    });
    expect(result.placements.get("track:k1")).toEqual({ type: "star", starKey: "track:k1" });
  });

  it("已结束和已归档的轨道不上天但留下 progress 动静", () => {
    const result = buildOverviewStars({
      tasks: [],
      tracks: [
        track({ id: "k2", status: "concluded", updatedAt: "2026-09-01T00:00:00.000Z" }),
        track({ id: "k3", status: "parked", updatedAt: "2026-08-01T00:00:00.000Z" }),
      ],
      steps: [],
      quickNotes: [],
      now,
    });

    expect(result.stars.find((s) => s.key === "track:k2")).toBeUndefined();
    expect(result.stars.find((s) => s.key === "track:k3")).toBeUndefined();
    expect(result.placements.get("track:k2")).toEqual({
      type: "excluded",
      reason: "track-concluded",
      event: { kind: "progress", at: "2026-09-01T00:00:00.000Z" },
    });
    expect(result.placements.get("track:k3")).toEqual({
      type: "excluded",
      reason: "track-parked",
      event: { kind: "progress", at: "2026-08-01T00:00:00.000Z" },
    });
    expect(result.exclusions["track-concluded"]).toBe(1);
    expect(result.exclusions["track-parked"]).toBe(1);
  });

  it("每个待办和轨道恰好一条去处，每颗待办 / 轨道星都指向自己", () => {
    const tasks = [
      task({ id: "t1", done: true, completedAt: ago(29 * DAY) }),
      task({ id: "t2", done: true, completedAt: ago(31 * DAY) }),
      task({
        id: "r1",
        recurrence: { freq: "daily", interval: 1, basis: "due" },
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
      task({
        id: "o1",
        ruleId: "r1",
        done: true,
        scheduledAt: "2026-10-28T00:00:00.000Z",
        completedAt: "2026-10-28T09:00:00.000Z",
      }),
      task({
        id: "o2",
        ruleId: "r1",
        done: true,
        scheduledAt: "2026-10-30T00:00:00.000Z",
        completedAt: "2026-10-30T09:00:00.000Z",
      }),
      task({ id: "r2", recurrence: { freq: "daily", interval: 1, basis: "due", count: 1 } }),
      task({
        id: "o3",
        ruleId: "r2",
        done: true,
        scheduledAt: "2026-10-20T00:00:00.000Z",
        completedAt: "2026-10-20T09:00:00.000Z",
      }),
      task({ id: "p" }),
      task({ id: "c1", parentId: "p", done: true, completedAt: "2026-10-31T08:00:00.000Z" }),
      task({ id: "c2", parentId: "c1" }),
      task({ id: "q", done: true, completedAt: ago(40 * DAY) }),
      task({ id: "d1", parentId: "q", done: true, completedAt: ago(DAY) }),
      task({ id: "x", parentId: "gone" }),
      task({ id: "a", parentId: "b" }),
      task({ id: "b", parentId: "a" }),
      task({ id: "o4", ruleId: "gone" }),
      task({ id: "o5", ruleId: "gone", skipped: true }),
    ];
    const tracks = [
      track({ id: "k1", status: "active", updatedAt: "2026-10-20T00:00:00.000Z" }),
      track({ id: "k2", status: "concluded", updatedAt: "2026-09-01T00:00:00.000Z" }),
      track({ id: "k3", status: "parked", updatedAt: "2026-08-01T00:00:00.000Z" }),
    ];
    const result = buildOverviewStars({
      tasks,
      tracks,
      steps: [
        step({
          id: "s1",
          trackId: "k1",
          startedAt: "2026-10-21T00:00:00.000Z",
          endedAt: "2026-10-22T00:00:00.000Z",
          updatedAt: "2026-10-21T00:00:00.000Z",
        }),
      ],
      quickNotes: [note({ id: "n1", pinned: true }), note({ id: "n2" })],
      now,
    });

    expect(result.placements.size).toBe(tasks.length + tracks.length);
    for (const star of result.stars) {
      if (star.key.startsWith("task:") || star.key.startsWith("track:")) {
        expect(result.placements.get(star.key)).toEqual({ type: "star", starKey: star.key });
      }
    }
    const starCount = result.stars.filter(
      (s) => s.key.startsWith("task:") || s.key.startsWith("track:"),
    ).length;
    const excludedCount =
      result.exclusions.occurrence +
      result.exclusions.child +
      result.exclusions["rule-exhausted"] +
      result.exclusions["done-old"] +
      result.exclusions["track-concluded"] +
      result.exclusions["track-parked"];
    expect(starCount + excludedCount).toBe(tasks.length + tracks.length);
  });

  it("星按 at 倒序，同一时刻按 key 升序", () => {
    const result = buildOverviewStars({
      tasks: [task({ id: "t9", updatedAt: "2026-10-25T00:00:00.000Z" })],
      tracks: [],
      steps: [],
      quickNotes: [
        note({ id: "nB", occurredAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" }),
        note({ id: "nA", occurredAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" }),
        note({ id: "nC", occurredAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z" }),
      ],
      now,
    });

    expect(result.stars.map((s) => s.key)).toEqual(["task:t9", "quick_note:nA", "quick_note:nB", "quick_note:nC"]);
  });
});
