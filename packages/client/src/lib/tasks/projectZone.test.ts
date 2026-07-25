import { describe, expect, it } from "vitest";
import type { Task } from "@timedata/shared";
import type { TodoProjectGroup } from "./goalMembership.js";
import { goalBarTaskIds, projectChipIndex, projectMemberState, summarizeProjectGroup } from "./projectZone.js";

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
  return { goalTitle: `目标 ${patch.goalId}`, tasks: [], doneTasks: [], ...patch };
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

describe("summarizeProjectGroup", () => {
  it("total 含已完成成员，allDone 只在未完成为 0 且有成员时成立", () => {
    expect(summarizeProjectGroup(group({ goalId: "g1", tasks: [task({ id: "a" })], doneTasks: [task({ id: "b" })] })))
      .toEqual({ remaining: 1, total: 2, allDone: false });
    expect(summarizeProjectGroup(group({ goalId: "g1", doneTasks: [task({ id: "b" })] })))
      .toEqual({ remaining: 0, total: 1, allDone: true });
  });

  it("空组不判 allDone（数据层已保证不会出现，此处是防御）", () => {
    expect(summarizeProjectGroup(group({ goalId: "g1" }))).toEqual({ remaining: 0, total: 0, allDone: false });
  });
});

describe("projectChipIndex", () => {
  it("只索引未完成成员，已完成成员不给 chip", () => {
    const chips = projectChipIndex([
      group({ goalId: "g1", goalTitle: "装修", tasks: [task({ id: "a" })], doneTasks: [task({ id: "done" })] }),
    ]);
    expect(chips.get("a")).toEqual({ goalId: "g1", goalTitle: "装修" });
    expect(chips.has("done")).toBe(false);
  });
});

describe("goalBarTaskIds", () => {
  it("有项目名 chip 的行不再画绿竖条，只剩 theme 归属", () => {
    const chips = projectChipIndex([group({ goalId: "g1", tasks: [task({ id: "项目成员" })] })]);
    const bars = goalBarTaskIds(new Set(["项目成员", "主题成员"]), chips);
    expect([...bars]).toEqual(["主题成员"]);
  });

  it("chip 为空时原样返回全部（P2 之前的行为）", () => {
    expect([...goalBarTaskIds(new Set(["a", "b"]), new Map())].sort()).toEqual(["a", "b"]);
  });
});
