import { describe, expect, it } from "vitest";
import type { Task } from "@timedata/shared";
import type { TodoProjectGroup } from "./goalMembership.js";
import {
  goalBarTaskIds,
  landsInCollapsedProjectGroup,
  projectChipIndex,
  projectMemberRowActions,
  projectMemberState,
  sortProjectMembers,
  summarizeProjectGroup,
} from "./projectZone.js";

const NOW = new Date("2026-07-25T10:00:00.000Z");

function task(patch: Partial<Task> & Pick<Task, "id">): Task {
  return {
    title: `任务 ${patch.id}`,
    done: false,
    parentId: null,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    weight: 0,
    ruleId: null,
    sessionId: null,
    skipped: false,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...patch,
  } as Task;
}

function group(patch: Partial<TodoProjectGroup> & Pick<TodoProjectGroup, "goalId">): TodoProjectGroup {
  return { goalTitle: `目标 ${patch.goalId}`, tasks: [], doneCount: 0, recentDoneCount: 0, memberCount: 0, pendingChildByMember: new Map(), ...patch };
}

describe("projectMemberState", () => {
  it("sessionId 命中当前活跃场 → 在手头，优先于时间轴", () => {
    const t = task({ id: "t1", sessionId: "s1", scheduledAt: "2026-07-25T00:00:00.000Z" });
    expect(projectMemberState(t, { handSessionId: "s1", now: NOW })).toEqual({ kind: "at-hand" });
  });

  it("sessionId 是历史指针：不等于当前活跃场就不算在手头", () => {
    const t = task({ id: "t1", sessionId: "旧场" });
    expect(projectMemberState(t, { handSessionId: "s1", now: NOW }).kind).toBe("idle");
    expect(projectMemberState(t, { handSessionId: null, now: NOW }).kind).toBe("idle");
  });

  it("排到今天 → today；过期的一次性任务被 placement 退回收件箱 → idle", () => {
    const today = task({ id: "t1", scheduledAt: "2026-07-25T00:00:00.000Z" });
    const past = task({ id: "t2", scheduledAt: "2026-07-01T00:00:00.000Z" });
    expect(projectMemberState(today, { handSessionId: null, now: NOW })).toEqual({ kind: "today" });
    // placement.ts:68「非重复待办过期不堆在今天，回归收件箱」——项目区成员恒为非重复
    //（归集守卫 recurrence===null && ruleId===null），故项目区**不存在逾期态**。
    expect(projectMemberState(past, { handSessionId: null, now: NOW })).toEqual({ kind: "idle" });
  });

  it("排到未来 → scheduled 并带回原始 scheduledAt", () => {
    const t = task({ id: "t1", scheduledAt: "2026-08-20T00:00:00.000Z" });
    expect(projectMemberState(t, { handSessionId: null, now: NOW })).toEqual({
      kind: "scheduled",
      scheduledAt: "2026-08-20T00:00:00.000Z",
    });
  });

  it("没排期没抓手头 → idle（渲染层据此不画胶囊）", () => {
    expect(projectMemberState(task({ id: "t1" }), { handSessionId: null, now: NOW })).toEqual({ kind: "idle" });
  });

  it("已完成成员 → idle（placement 判 completed，不当成时间轴状态）", () => {
    const t = task({ id: "t1", done: true, completedAt: "2026-07-20T00:00:00.000Z" });
    expect(projectMemberState(t, { handSessionId: null, now: NOW }).kind).toBe("idle");
  });
});

describe("projectMemberRowActions", () => {
  const opts = { handSessionId: "s1", now: NOW };

  it("在手头且已排今天：两根轴各说各的，不互相遮蔽", () => {
    const t = task({ id: "t1", sessionId: "s1", scheduledAt: "2026-07-25T00:00:00.000Z" });
    expect(projectMemberRowActions(t, opts)).toEqual({ atHand: true, pool: "today" });
  });

  it("在手头、没排期：pool 仍是 inbox——抓手关掉但箭头照样指「排进今天」", () => {
    const t = task({ id: "t1", sessionId: "s1" });
    expect(projectMemberRowActions(t, opts)).toEqual({ atHand: true, pool: "inbox" });
  });

  it("没在手头、排了今天：箭头该指「回收件箱」", () => {
    const t = task({ id: "t1", scheduledAt: "2026-07-25T00:00:00.000Z" });
    expect(projectMemberRowActions(t, opts)).toEqual({ atHand: false, pool: "today" });
  });

  it("排到未来：pool=inbox——那条的动作是「排进今天」不是「回收件箱」", () => {
    const t = task({ id: "t1", scheduledAt: "2026-08-20T00:00:00.000Z" });
    expect(projectMemberRowActions(t, opts)).toEqual({ atHand: false, pool: "inbox" });
  });

  it("sessionId 是历史指针：不等于当前活跃场就不算在手头", () => {
    const t = task({ id: "t1", sessionId: "旧场" });
    expect(projectMemberRowActions(t, opts).atHand).toBe(false);
  });

  it("没有活跃场（handSessionId 为 null）：sessionId 非空也不算在手头", () => {
    const t = task({ id: "t1", sessionId: "s1" });
    expect(projectMemberRowActions(t, { handSessionId: null, now: NOW }).atHand).toBe(false);
  });
});

describe("summarizeProjectGroup", () => {
  it("计数直传，allDone 只在未完成为 0 且有已完成成员时成立", () => {
    expect(summarizeProjectGroup(group({ goalId: "g1", tasks: [task({ id: "a" })], doneCount: 1, recentDoneCount: 1 })))
      .toEqual({ remaining: 1, doneCount: 1, recentDoneCount: 1, allDone: false });
    expect(summarizeProjectGroup(group({ goalId: "g1", doneCount: 1, recentDoneCount: 0 })))
      .toEqual({ remaining: 0, doneCount: 1, recentDoneCount: 0, allDone: true });
  });

  it("空组不判 allDone（数据层已保证不会出现，此处是防御）", () => {
    expect(summarizeProjectGroup(group({ goalId: "g1" }))).toEqual({ remaining: 0, doneCount: 0, recentDoneCount: 0, allDone: false });
  });

  it("remaining 计入未完成成员名下的子任务（按成员分桶求和）", () => {
    const summary = summarizeProjectGroup({
      goalId: "g1",
      goalTitle: "P1",
      tasks: [task({ id: "m1" })],
      doneCount: 0,
      recentDoneCount: 0,
      memberCount: 1,
      pendingChildByMember: new Map([["m1", 2]]),
    });
    expect(summary.remaining).toBe(3);
    expect(summary.allDone).toBe(false);
  });

  it("零未完成成员时 pendingChildByMember 恒空，allDone 判据与旧行为等价", () => {
    const summary = summarizeProjectGroup({
      goalId: "g1",
      goalTitle: "P1",
      tasks: [],
      doneCount: 3,
      recentDoneCount: 1,
      memberCount: 3,
      pendingChildByMember: new Map(),
    });
    expect(summary.allDone).toBe(true);
  });

  it("筛选裁剪成员后，remaining 只数可见成员及其子任务", () => {
    // 构造：成员 A（名下 2 条未完成子任务）、成员 B（名下 1 条未完成子任务）。
    const full = {
      goalId: "g1",
      goalTitle: "P1",
      tasks: [task({ id: "A" }), task({ id: "B" })],
      doneCount: 0,
      recentDoneCount: 0,
      memberCount: 2,
      pendingChildByMember: new Map([
        ["A", 2],
        ["B", 1],
      ]),
    };
    expect(summarizeProjectGroup(full).remaining).toBe(5);
    // 模拟筛选把 tasks 裁成只剩 A：remaining 必须跟着裁，不许把看不见的 B 名下子任务算进去。
    const filtered = { ...full, tasks: [task({ id: "A" })] };
    expect(summarizeProjectGroup(filtered).remaining).toBe(3);
  });
});

describe("projectChipIndex", () => {
  it("只索引未完成成员，已完成成员不给 chip", () => {
    const chips = projectChipIndex(
      [group({ goalId: "g1", goalTitle: "装修", tasks: [task({ id: "a" })], doneCount: 1 })],
      new Map([["g1", "var(--color-tint-3)"]]),
    );
    expect(chips.get("a")).toEqual({ goalId: "g1", goalTitle: "装修", tint: "var(--color-tint-3)" });
    expect(chips.has("done")).toBe(false);
  });

  it("把项目色带下来（组件不自己按 goalId 取色——避撞分配只有全集才算得出）", () => {
    const chips = projectChipIndex(
      [
        group({ goalId: "g1", tasks: [task({ id: "a" })] }),
        group({ goalId: "g2", tasks: [task({ id: "b" })] }),
      ],
      new Map([
        ["g1", "var(--color-tint-1)"],
        ["g2", "var(--color-tint-7)"],
      ]),
    );
    expect(chips.get("a")?.tint).toBe("var(--color-tint-1)");
    expect(chips.get("b")?.tint).toBe("var(--color-tint-7)");
  });

  it("色表查不到时给空串，渲染层据此不画圆点", () => {
    const chips = projectChipIndex([group({ goalId: "g1", tasks: [task({ id: "a" })] })], new Map());
    expect(chips.get("a")?.tint).toBe("");
  });
});

describe("sortProjectMembers", () => {
  const opts = { handSessionId: "s1", now: NOW };

  it("四段顺序：在手头 → 今天 → 躺着 → 已排期（未来）", () => {
    const sorted = sortProjectMembers(
      [
        task({ id: "future", scheduledAt: "2026-08-10T00:00:00.000Z" }),
        task({ id: "idle" }),
        task({ id: "today", scheduledAt: "2026-07-25T00:00:00.000Z" }),
        task({ id: "hand", sessionId: "s1" }),
      ],
      opts,
    );
    expect(sorted.map((t) => t.id)).toEqual(["hand", "today", "idle", "future"]);
  });

  it("已排期段内按 scheduledAt 升序，快到期的在上", () => {
    const sorted = sortProjectMembers(
      [
        task({ id: "late", scheduledAt: "2026-09-01T00:00:00.000Z" }),
        task({ id: "soon", scheduledAt: "2026-07-28T00:00:00.000Z" }),
        task({ id: "mid", scheduledAt: "2026-08-15T00:00:00.000Z" }),
      ],
      opts,
    );
    expect(sorted.map((t) => t.id)).toEqual(["soon", "mid", "late"]);
  });

  it("同段内稳定：保持传入顺序（listTasks 的 sortOrder），不按 id / updatedAt 重排", () => {
    const sorted = sortProjectMembers(
      [
        task({ id: "z", updatedAt: "2026-07-01T00:00:00.000Z" }),
        task({ id: "m", updatedAt: "2026-07-20T00:00:00.000Z" }),
        task({ id: "a", updatedAt: "2026-07-10T00:00:00.000Z" }),
      ],
      opts,
    );
    expect(sorted.map((t) => t.id)).toEqual(["z", "m", "a"]);
  });

  it("逾期的一次性成员回落「躺着」段，排在已排期之前", () => {
    const sorted = sortProjectMembers(
      [
        task({ id: "future", scheduledAt: "2026-08-10T00:00:00.000Z" }),
        task({ id: "overdue", scheduledAt: "2026-07-01T00:00:00.000Z" }),
      ],
      opts,
    );
    expect(sorted.map((t) => t.id)).toEqual(["overdue", "future"]);
  });

  it("不改动传入数组（listTasks 传的是 group.tasks 本体）", () => {
    const input = [task({ id: "b", scheduledAt: "2026-08-10T00:00:00.000Z" }), task({ id: "a" })];
    const before = input.map((t) => t.id);
    sortProjectMembers(input, opts);
    expect(input.map((t) => t.id)).toEqual(before);
  });

  it("recentTaskIds 按最新优先把新建的 idle 成员覆盖到 idle 段顶部", () => {
    const sorted = sortProjectMembers(
      [
        task({ id: "old" }),
        task({ id: "newer" }),
        task({ id: "new" }),
        task({ id: "future", scheduledAt: "2026-08-10T00:00:00.000Z" }),
      ],
      { ...opts, recentTaskIds: ["newer", "new"] },
    );
    expect(sorted.map((t) => t.id)).toEqual(["newer", "new", "old", "future"]);
  });
});

describe("goalBarTaskIds", () => {
  it("有项目名 chip 的行不再画绿竖条，只剩 theme 归属", () => {
    const chips = projectChipIndex([group({ goalId: "g1", tasks: [task({ id: "项目成员" })] })], new Map());
    const bars = goalBarTaskIds(new Set(["项目成员", "主题成员"]), chips);
    expect([...bars]).toEqual(["主题成员"]);
  });

  it("chip 为空时原样返回全部（P2 之前的行为）", () => {
    expect([...goalBarTaskIds(new Set(["a", "b"]), new Map())].sort()).toEqual(["a", "b"]);
  });
});

describe("landsInCollapsedProjectGroup", () => {
  const opts = { handSessionId: "s1", now: NOW };

  it("根任务无排期、不在手头 → true（真会落进折叠的组）", () => {
    expect(landsInCollapsedProjectGroup(task({ id: "t1" }), opts)).toBe(true);
  });

  // 本条与《ruleId 非空（occurrence / 混合体行）→ false：同样进不了项目区归集》**各锁一半**：
  // 闸一是 `parentId === null && ruleId === null` 两个析取项（取反后），本条锁 parentId 半边、
  // 那条锁 ruleId 半边。删任一条，另一半立刻裸奔。
  it("子任务 → false：投影层只收根任务，展开的是不含它的组", () => {
    expect(landsInCollapsedProjectGroup(task({ id: "t1", parentId: "p1" }), opts)).toBe(false);
  });

  it("ruleId 非空（occurrence / 混合体行）→ false：同样进不了项目区归集", () => {
    // 与上面《子任务 → false》各锁闸一那两个析取项的一半，见那条的注释。
    expect(landsInCollapsedProjectGroup(task({ id: "t1", ruleId: "r1" }), opts)).toBe(false);
  });

  it("在手头 → false：它在页面最顶上本来就看得见，展开只会把页面滚走", () => {
    expect(landsInCollapsedProjectGroup(task({ id: "t1", sessionId: "s1" }), opts)).toBe(false);
  });

  it("sessionId 是历史指针、不等于当前活跃场 → 仍 true", () => {
    expect(landsInCollapsedProjectGroup(task({ id: "t1", sessionId: "s0" }), opts)).toBe(true);
  });

  it("排到未来 → false：回的是已排期区，本来就看得见", () => {
    const t = task({ id: "t1", scheduledAt: "2026-08-20T00:00:00.000Z" });
    expect(landsInCollapsedProjectGroup(t, opts)).toBe(false);
  });

  it("已完成 → false：已完成成员待在组内另一个默认折叠的子区，展开也看不到，指错更糟", () => {
    const t = task({ id: "t1", done: true, completedAt: "2026-07-25T09:00:00.000Z" });
    expect(landsInCollapsedProjectGroup(t, opts)).toBe(false);
  });
});
