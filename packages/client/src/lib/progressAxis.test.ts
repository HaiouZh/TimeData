import type { Goal, Task, Track, TrackStep } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { DEFAULT_TODO_GRAVITY_SETTINGS, splitInboxByGravity } from "./tasks/gravity.js";
import { placementForTask } from "./tasks/placement.js";
import {
  bucketForProject,
  bucketForTask,
  bucketForTrack,
  buildProgressItems,
  type ProgressAxisInput,
  type TaskBucketContext,
} from "./progressAxis.js";
import { buildBlockedByIndex } from "./taskRelations.js";

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
  it("子任务有桶（解锁后按自身状态进桶，无排期无手头 → 兜底 todo）", () => {
    expect(bucketForTask(makeTask({ parentId: "p1" }), ctx())).toBe("todo");
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

function input(patch: Partial<ProgressAxisInput> = {}): ProgressAxisInput {
  return {
    tasks: [],
    childrenByParent: new Map(),
    tracks: [],
    stepsByTrack: new Map(),
    projects: [],
    handSessionId: null,
    gravitySettings: DEFAULT_TODO_GRAVITY_SETTINGS,
    now: NOW,
    ...patch,
  };
}

describe("buildProgressItems 去重", () => {
  it("任务挂 active 轨道 → 只出一行，两个 id 都在，桶取任务的", () => {
    const task = makeTask({ id: "t1", done: true });
    const track = makeTrack({ id: "k1", refs: [{ kind: "task", id: "t1" }] });
    const items = buildProgressItems(input({ tasks: [task], tracks: [track] }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "task", taskId: "t1", trackId: "k1", bucket: "settled" });
  });

  it("轨道 refs 指向已删除任务 → 轨道独立成行，不被吞掉", () => {
    const track = makeTrack({ id: "k1", refs: [{ kind: "task", id: "gone" }] });
    const items = buildProgressItems(input({ tracks: [track] }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "track", trackId: "k1", taskId: null });
  });

  it("一任务挂两条 active 轨道 → 取 updatedAt 新者", () => {
    const task = makeTask({ id: "t1" });
    const older = makeTrack({ id: "old", refs: [{ kind: "task", id: "t1" }], updatedAt: iso(5 * DAY) });
    const newer = makeTrack({ id: "new", refs: [{ kind: "task", id: "t1" }], updatedAt: iso(1 * DAY) });
    const items = buildProgressItems(input({ tasks: [task], tracks: [older, newer] }));
    expect(items.filter((i) => i.kind === "task")[0].trackId).toBe("new");
  });

  it("一轨道 refs 指多任务 → 合并到下标最小的那个，其余独立成行", () => {
    const a = makeTask({ id: "a" });
    const b = makeTask({ id: "b" });
    const track = makeTrack({ id: "k1", refs: [{ kind: "task", id: "a" }, { kind: "task", id: "b" }] });
    const items = buildProgressItems(input({ tasks: [a, b], tracks: [track] }));
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.taskId === "a")?.trackId).toBe("k1");
    expect(items.find((i) => i.taskId === "b")?.trackId).toBeNull();
  });
});

describe("buildProgressItems 进度", () => {
  it("子任务口径：剔 skipped", () => {
    const parent = makeTask({ id: "p" });
    const children = new Map([[
      "p",
      [
        makeTask({ id: "c1", parentId: "p", done: true }),
        makeTask({ id: "c2", parentId: "p" }),
        makeTask({ id: "c3", parentId: "p", skipped: true, ruleId: "r" }),
      ],
    ]]);
    const items = buildProgressItems(input({ tasks: [parent], childrenByParent: children }));
    expect(items[0].progress).toEqual({ kind: "subtasks", done: 1, total: 2 });
  });

  it("步数口径：不减已闭合", () => {
    const task = makeTask({ id: "t1" });
    const track = makeTrack({ id: "k1", refs: [{ kind: "task", id: "t1" }] });
    const steps = [makeStep("k1", 1 * DAY, 2 * DAY), makeStep("k1", null, 1 * DAY)];
    const items = buildProgressItems(
      input({ tasks: [task], tracks: [track], stepsByTrack: new Map([["k1", steps]]) }),
    );
    expect(items[0].progress).toEqual({ kind: "steps", count: 2 });
  });

  it("无子任务无轨道 → progress 为 null", () => {
    const items = buildProgressItems(input({ tasks: [makeTask()] }));
    expect(items[0].progress).toBeNull();
  });
});

describe("buildProgressItems 项目组与 latestNote", () => {
  function makeGoal(members: Goal["members"]): Goal {
    return {
      id: "g1",
      title: "项目",
      kind: "project",
      status: "active",
      members,
      prerequisites: [],
      createdAt: iso(30 * DAY),
      updatedAt: iso(0),
    };
  }

  it("成员全是轨道的项目仍然成行——不因只认 task 成员而整个消失", () => {
    const track = makeTrack({ id: "k1", createdAt: iso(1 * DAY) });
    const goal = makeGoal([{ kind: "track", id: "k1" }]);
    const row = buildProgressItems(input({ tracks: [track], projects: [goal] })).find(
      (i) => i.kind === "project",
    );
    expect(row).toMatchObject({ goalId: "g1", bucket: "queued" });
    expect(row?.progress).toEqual({ kind: "members", done: 0, total: 1 });
  });

  it("被合并进任务行的轨道，roll-up 取任务的桶不取轨道自己的", () => {
    // 任务已完成 → 合并行 settled；轨道有开口步、单独算会是 doing。项目组必须跟合并行走。
    const task = makeTask({ id: "t1", done: true });
    const track = makeTrack({ id: "k1", refs: [{ kind: "task", id: "t1" }] });
    const items = buildProgressItems(
      input({
        tasks: [task],
        tracks: [track],
        stepsByTrack: new Map([["k1", [makeStep("k1", null, 1 * DAY)]]]),
        projects: [makeGoal([{ kind: "track", id: "k1" }])],
      }),
    );
    expect(items.find((i) => i.kind === "project")?.bucket).toBe("settled");
  });

  it("latestNote 取轨道最新一步正文；无轨道的任务为 null", () => {
    const task = makeTask({ id: "t1" });
    const track = makeTrack({ id: "k1", refs: [{ kind: "task", id: "t1" }] });
    const steps = [makeStep("k1", 2 * DAY, 3 * DAY), makeStep("k1", null, 1 * DAY)];
    const merged = buildProgressItems(
      input({ tasks: [task], tracks: [track], stepsByTrack: new Map([["k1", steps]]) }),
    );
    expect(merged[0].latestNote).toBe(steps[1].content);
    expect(buildProgressItems(input({ tasks: [makeTask({ id: "t2" })] }))[0].latestNote).toBeNull();
  });
});

describe("buildProgressItems 排序", () => {
  it("组内按 lastActivityAt 倒序、空值沉底", () => {
    const older = makeTask({ id: "old", updatedAt: iso(5 * DAY) });
    const newer = makeTask({ id: "new", updatedAt: iso(1 * DAY) });
    const items = buildProgressItems(input({ tasks: [older, newer] }));
    expect(items.map((i) => i.taskId)).toEqual(["new", "old"]);
  });
});

/**
 * 正交性回归。**这一组是回归哨兵，不是行为验证**——`buildProgressItems` 现在纯读、
 * 天然不碰入参，所以这几条现在恒绿，删掉本层实现它们也不会红。它们守的是**将来**：
 * 谁要是往这一层加了写操作（顺手把 placement 缓存回写 task、把桶写进实体、
 * 就地 sort 传进来的数组），这里会立刻红。
 *
 * 推进轴是**新增读法**，不是改写既有投影——这是阶段 1 的立身之本，值得一组哨兵守着。
 */
describe("正交性：本层不改变既有投影的输出", () => {
  const makeFixture = (): Task[] => [
    makeTask({ id: "a", scheduledAt: iso(0) }),
    makeTask({ id: "b", scheduledAt: iso(30 * DAY) }),
    makeTask({ id: "c", updatedAt: iso(40 * DAY) }),
    makeTask({ id: "d", done: true }),
  ];

  it("placementForTask 的结果不因本层被调用而改变", () => {
    const fixture = makeFixture();
    const before = fixture.map((task) => placementForTask(task, NOW));
    buildProgressItems(input({ tasks: fixture }));
    expect(fixture.map((task) => placementForTask(task, NOW))).toEqual(before);
  });

  it("splitInboxByGravity 的结果不因本层被调用而改变", () => {
    const fixture = makeFixture();
    const before = splitInboxByGravity(fixture, DEFAULT_TODO_GRAVITY_SETTINGS, NOW);
    buildProgressItems(input({ tasks: fixture }));
    expect(splitInboxByGravity(fixture, DEFAULT_TODO_GRAVITY_SETTINGS, NOW)).toEqual(before);
  });

  it("不修改传入的任何实体，也不就地重排传入的数组", () => {
    const tasks = makeFixture();
    const tracks = [makeTrack({ id: "k1", refs: [{ kind: "task", id: "a" }] })];
    const steps = [makeStep("k1", null, 2 * DAY)];
    const goals = [
      {
        id: "g1",
        title: "项目",
        kind: "project" as const,
        status: "active" as const,
        members: [{ kind: "task" as const, id: "a" }],
        prerequisites: [],
        createdAt: iso(30 * DAY),
        updatedAt: iso(0),
      },
    ];
    const snapshot = JSON.parse(JSON.stringify({ tasks, tracks, steps, goals })) as unknown;

    buildProgressItems(
      input({ tasks, tracks, stepsByTrack: new Map([["k1", steps]]), projects: goals }),
    );

    // 深比较连数组顺序一起验：就地 sort 也会被这条抓到。
    expect(JSON.parse(JSON.stringify({ tasks, tracks, steps, goals }))).toEqual(snapshot);
  });
});

describe("结构式 waiting（阶段3）", () => {
  it("被未完成前置挡住的任务落 waiting 桶", () => {
    const blockedBy = new Map([["task:t1", ["task:blocker"]]]);
    expect(bucketForTask(makeTask(), ctx({ blockedBy }))).toBe("waiting");
  });

  it("被未完成前置挡住且排在未来时仍落 waiting 桶", () => {
    const blockedBy = new Map([["task:t1", ["task:blocker"]]]);
    expect(bucketForTask(makeTask({ scheduledAt: iso(-3 * DAY) }), ctx({ blockedBy }))).toBe("waiting");
  });

  it("前置全部完成后不再 waiting（buildBlockedByIndex 已剔除已完成 blocker）", () => {
    const blockedBy = new Map<string, string[]>(); // 已完成的 blocker 不进索引
    expect(bucketForTask(makeTask(), ctx({ blockedBy }))).not.toBe("waiting");
  });

  it("环内两条互相挡：都落 waiting，且函数正常返回不死循环", () => {
    const blockedBy = new Map([
      ["task:a", ["task:b"]],
      ["task:b", ["task:a"]],
    ]);
    expect(bucketForTask(makeTask({ id: "a" }), ctx({ blockedBy }))).toBe("waiting");
    expect(bucketForTask(makeTask({ id: "b" }), ctx({ blockedBy }))).toBe("waiting");
  });

  it("没有 blockedBy 字段时行为与阶段2 一致", () => {
    expect(bucketForTask(makeTask(), ctx())).toBe(bucketForTask(makeTask(), ctx({ blockedBy: new Map() })));
  });
});

describe("buildBlockedByIndex", () => {
  const relation = (blockerId: string, blockedId: string) => ({
    blockerKind: "task" as const,
    blockerId,
    blockedKind: "task" as const,
    blockedId,
    type: "blocks" as const,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  });

  it("未完成的 blocker 进索引", () => {
    const index = buildBlockedByIndex([relation("a", "b")], new Set(), new Set(["task:a", "task:b"]));
    expect(index.get("task:b")).toEqual(["task:a"]);
  });

  it("已完成的 blocker 不进索引——这就是「前置一勾自动解锁」", () => {
    // liveKeys 里留着 task:a：让它被排除的理由只能是「已完成」，不是「已不存在」。
    const index = buildBlockedByIndex([relation("a", "b")], new Set(["task:a"]), new Set(["task:a", "task:b"]));
    expect(index.get("task:b")).toBeUndefined();
  });

  it("多个 blocker 全部收进同一条目", () => {
    const index = buildBlockedByIndex(
      [relation("a", "c"), relation("b", "c")],
      new Set(),
      new Set(["task:a", "task:b", "task:c"]),
    );
    expect(index.get("task:c")?.sort()).toEqual(["task:a", "task:b"]);
  });
});
