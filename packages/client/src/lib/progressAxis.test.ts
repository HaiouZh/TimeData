import type { Task, Track, TrackStep } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { DEFAULT_TODO_GRAVITY_SETTINGS } from "./tasks/gravity.js";
import {
  bucketForProject,
  bucketForTask,
  bucketForTrack,
  type TaskBucketContext,
} from "./progressAxis.js";

const NOW = new Date("2026-08-07T12:00:00.000Z");
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "t1",
    parentId: null,
    title: "任务",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    weight: 0,
    completedAt: null,
    tags: [],
    ruleId: null,
    sessionId: null,
    skipped: false,
    sortOrder: 0,
    createdAt: iso(60 * DAY),
    updatedAt: iso(1 * DAY),
    ...patch,
  };
}

function ctx(patch: Partial<TaskBucketContext> = {}): TaskBucketContext {
  return {
    handSessionId: null,
    projectMemberIds: new Set<string>(),
    gravitySettings: DEFAULT_TODO_GRAVITY_SETTINGS,
    now: NOW,
    ...patch,
  };
}

describe("bucketForTask 排除", () => {
  it("子任务不成行", () => {
    expect(bucketForTask(makeTask({ parentId: "p1" }), ctx())).toBeNull();
  });

  it("重复模板本体不成行", () => {
    // Recurrence 的字段是 freq/interval/basis（entitySchemas.ts:61-74），不是 kind；basis 必填。
    const task = makeTask({ recurrence: { freq: "daily", interval: 1, basis: "due" } });
    expect(bucketForTask(task, ctx())).toBeNull();
  });

  it("已跳过的发不成行", () => {
    expect(bucketForTask(makeTask({ ruleId: "r1", skipped: true }), ctx())).toBeNull();
  });
});

describe("bucketForTask 优先级链", () => {
  it("已完成 → settled", () => {
    expect(bucketForTask(makeTask({ done: true }), ctx())).toBe("settled");
  });

  it("在手头 → doing（压过排期）", () => {
    const task = makeTask({ sessionId: "s1", scheduledAt: iso(-3 * DAY) });
    expect(bucketForTask(task, ctx({ handSessionId: "s1" }))).toBe("doing");
  });

  it("指向已散场的 sessionId 不算在手头", () => {
    const task = makeTask({ sessionId: "old" });
    expect(bucketForTask(task, ctx({ handSessionId: "s1" }))).toBe("todo");
  });

  it("排了今天 → doing", () => {
    expect(bucketForTask(makeTask({ scheduledAt: iso(0) }), ctx())).toBe("doing");
  });

  it("排期已过却没做 → waiting（4a）", () => {
    expect(bucketForTask(makeTask({ scheduledAt: iso(30 * DAY) }), ctx())).toBe("waiting");
  });

  it("排期在未来 → queued", () => {
    expect(bucketForTask(makeTask({ scheduledAt: iso(-3 * DAY) }), ctx())).toBe("queued");
  });

  it("无排期但超水位线 → waiting（4b）", () => {
    const task = makeTask({ updatedAt: iso(40 * DAY) });
    expect(bucketForTask(task, ctx())).toBe("waiting");
  });

  it("项目成员无日期 → queued 不是 todo", () => {
    const task = makeTask({ id: "m1" });
    expect(bucketForTask(task, ctx({ projectMemberIds: new Set(["m1"]) }))).toBe("queued");
  });

  it("其余 → todo", () => {
    expect(bucketForTask(makeTask(), ctx())).toBe("todo");
  });
});

describe("waiting 两条判据的反证与降级", () => {
  it("反证：排期已过的任务喂给 isTaskSunken 必定为 false —— 证明 4a 不是死代码", async () => {
    const { isTaskSunken } = await import("./tasks/gravity.js");
    const overdue = makeTask({ scheduledAt: iso(30 * DAY), updatedAt: iso(40 * DAY) });
    expect(isTaskSunken(overdue, DEFAULT_TODO_GRAVITY_SETTINGS, NOW)).toBe(false);
    expect(bucketForTask(overdue, ctx())).toBe("waiting");
  });

  it("重力关闭：4b 失效落 todo，4a 仍生效", () => {
    const off = { ...DEFAULT_TODO_GRAVITY_SETTINGS, enabled: false };
    expect(bucketForTask(makeTask({ updatedAt: iso(40 * DAY) }), ctx({ gravitySettings: off }))).toBe("todo");
    expect(bucketForTask(makeTask({ scheduledAt: iso(30 * DAY) }), ctx({ gravitySettings: off }))).toBe("waiting");
  });

  it("新建保护期内不沉", () => {
    const fresh = makeTask({ createdAt: iso(2 * DAY), updatedAt: iso(2 * DAY) });
    expect(bucketForTask(fresh, ctx())).toBe("todo");
  });
});

function makeTrack(patch: Partial<Track> = {}): Track {
  return {
    id: "k1",
    title: "轨道",
    status: "active",
    refs: [],
    createdAt: iso(30 * DAY),
    updatedAt: iso(0),
    ...patch,
  };
}

let stepSeq = 0;
function makeStep(trackId: string, endedAgo: number | null, startedAgo: number): TrackStep {
  stepSeq += 1;
  return {
    id: `st${stepSeq}`,
    trackId,
    source: "user",
    content: `步骤${stepSeq}`,
    startedAt: iso(startedAgo),
    endedAt: endedAgo === null ? null : iso(endedAgo),
    refs: [],
    tags: [],
    seq: stepSeq,
    createdAt: iso(startedAgo),
    updatedAt: iso(startedAgo),
  };
}

describe("bucketForTrack", () => {
  it("非 active → settled", () => {
    expect(bucketForTrack(makeTrack({ status: "concluded" }), [], NOW)).toBe("settled");
    expect(bucketForTrack(makeTrack({ status: "parked" }), [], NOW)).toBe("settled");
  });

  it("停滞压过开口步：有开口步但 12 天没动 → waiting", () => {
    const steps = [makeStep("k1", null, 12 * DAY)];
    expect(bucketForTrack(makeTrack(), steps, NOW)).toBe("waiting");
  });

  it("有开口步且新鲜 → doing", () => {
    const steps = [makeStep("k1", null, 2 * DAY)];
    expect(bucketForTrack(makeTrack(), steps, NOW)).toBe("doing");
  });

  it("无步轨道用 createdAt 兜底：建了 8 天没写 → waiting", () => {
    expect(bucketForTrack(makeTrack({ createdAt: iso(8 * DAY) }), [], NOW)).toBe("waiting");
  });

  it("无步轨道刚建 → queued", () => {
    expect(bucketForTrack(makeTrack({ createdAt: iso(1 * DAY) }), [], NOW)).toBe("queued");
  });

  it("有步全闭合且新鲜 → doing", () => {
    const steps = [makeStep("k1", 1 * DAY, 2 * DAY)];
    expect(bucketForTrack(makeTrack(), steps, NOW)).toBe("doing");
  });
});

describe("bucketForProject 结构式 roll-up", () => {
  it("零成员 → null（不成行）", () => {
    expect(bucketForProject([])).toBeNull();
  });

  it("全部了结 → settled", () => {
    expect(bucketForProject(["settled", "settled"])).toBe("settled");
  });

  it("任一成员在做 → doing", () => {
    expect(bucketForProject(["settled", "waiting", "doing"])).toBe("doing");
  });

  it("无人在做且所有未了结成员都在等 → waiting", () => {
    expect(bucketForProject(["settled", "waiting", "waiting"])).toBe("waiting");
  });

  it("有能动的成员 → queued", () => {
    expect(bucketForProject(["waiting", "queued"])).toBe("queued");
    expect(bucketForProject(["waiting", "todo"])).toBe("queued");
  });

  it("结构式判定与时间无关：成员全在等即判 waiting", () => {
    expect(bucketForProject(["waiting"])).toBe("waiting");
  });
});
