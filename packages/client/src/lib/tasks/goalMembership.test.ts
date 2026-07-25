import { describe, expect, it } from "vitest";
import type { Goal, Task } from "@timedata/shared";
import {
  buildTodoProjectGroups,
  goalLinkedTaskIds,
  ownedProjectTaskIds,
  projectMemberIndex,
  releasedProjectTaskIds,
} from "./goalMembership.js";

function goal(patch: Partial<Goal> & Pick<Goal, "id">): Goal {
  return {
    title: `目标 ${patch.id}`,
    kind: "project",
    status: "active",
    members: [],
    prerequisites: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...patch,
  } as Goal;
}

function task(patch: Partial<Task> & Pick<Task, "id">): Task {
  return {
    title: `任务 ${patch.id}`,
    done: false,
    parentId: null,
    scheduledAt: null,
    recurrence: null,
    ruleId: null,
    skipped: false,
    sessionId: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...patch,
  } as Task;
}

describe("goalLinkedTaskIds", () => {
  it("收全部 kind 的 active 目标成员，跳过 archived 与 track 成员", () => {
    const ids = goalLinkedTaskIds([
      goal({ id: "g1", kind: "project", members: [{ kind: "task", id: "t1" }] }),
      goal({ id: "g2", kind: "theme", members: [{ kind: "task", id: "t2" }] }),
      goal({ id: "g3", status: "archived", members: [{ kind: "task", id: "t3" }] }),
      goal({ id: "g4", members: [{ kind: "track", id: "tr1" }] }),
    ]);
    expect([...ids].sort()).toEqual(["t1", "t2"]);
  });

  it("容忍缺 members 字段的裸行", () => {
    expect(goalLinkedTaskIds([{ id: "g1", status: "active", kind: "project" } as Goal]).size).toBe(0);
  });
});

describe("projectMemberIndex", () => {
  it("只认 active project，theme 成员不进索引", () => {
    const index = projectMemberIndex([
      goal({ id: "g1", kind: "project", title: "装修", members: [{ kind: "task", id: "t1" }] }),
      goal({ id: "g2", kind: "theme", members: [{ kind: "task", id: "t2" }] }),
      goal({ id: "g3", status: "archived", members: [{ kind: "task", id: "t3" }] }),
    ]);
    expect(index.get("t1")).toEqual({ goalId: "g1", goalTitle: "装修" });
    expect(index.has("t2")).toBe(false);
    expect(index.has("t3")).toBe(false);
  });

  it("多重归属取 updatedAt 最新者，且与传入顺序无关", () => {
    const older = goal({ id: "a", updatedAt: "2026-07-01T00:00:00.000Z", members: [{ kind: "task", id: "t1" }] });
    const newer = goal({ id: "b", updatedAt: "2026-07-09T00:00:00.000Z", members: [{ kind: "task", id: "t1" }] });
    expect(projectMemberIndex([older, newer]).get("t1")?.goalId).toBe("b");
    expect(projectMemberIndex([newer, older]).get("t1")?.goalId).toBe("b");
  });

  it("updatedAt 并列时取 goal.id 字典序小者", () => {
    const zed = goal({ id: "zed", members: [{ kind: "task", id: "t1" }] });
    const abc = goal({ id: "abc", members: [{ kind: "task", id: "t1" }] });
    expect(projectMemberIndex([zed, abc]).get("t1")?.goalId).toBe("abc");
    expect(projectMemberIndex([abc, zed]).get("t1")?.goalId).toBe("abc");
  });
});

describe("buildTodoProjectGroups", () => {
  it("已完成成员只计 doneCount 不进 tasks", () => {
    const goals = [goal({ id: "g1", title: "装修", members: [{ kind: "task", id: "t1" }, { kind: "task", id: "t2" }] })];
    const index = projectMemberIndex(goals);
    const groups = buildTodoProjectGroups(goals, index, [task({ id: "t1" }), task({ id: "t2", done: true })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(groups[0]?.doneCount).toBe(1);
    expect(groups[0]?.goalTitle).toBe("装修");
  });

  it("零可解析成员的目标不出现（纯 track 目标 / 成员全被删）", () => {
    const goals = [goal({ id: "g1", members: [{ kind: "track", id: "tr1" }, { kind: "task", id: "gone" }] })];
    expect(buildTodoProjectGroups(goals, projectMemberIndex(goals), [])).toEqual([]);
  });

  it("组间按成员 max(updatedAt) 倒序，已完成成员也参与排序键", () => {
    const goals = [
      goal({ id: "g1", members: [{ kind: "task", id: "t1" }] }),
      goal({ id: "g2", members: [{ kind: "task", id: "t2" }] }),
    ];
    const groups = buildTodoProjectGroups(goals, projectMemberIndex(goals), [
      task({ id: "t1", updatedAt: "2026-07-02T00:00:00.000Z" }),
      task({ id: "t2", updatedAt: "2026-07-20T00:00:00.000Z", done: true }),
    ]);
    expect(groups.map((g) => g.goalId)).toEqual(["g2", "g1"]);
  });
});

describe("releasedProjectTaskIds", () => {
  it("归档释放全部 task 成员", () => {
    const before = goal({ id: "g1", members: [{ kind: "task", id: "t1" }, { kind: "track", id: "tr1" }] });
    expect(releasedProjectTaskIds(before, { ...before, status: "archived" })).toEqual(["t1"]);
  });

  it("kind 从 project 改成 theme 也释放", () => {
    const before = goal({ id: "g1", members: [{ kind: "task", id: "t1" }] });
    expect(releasedProjectTaskIds(before, { ...before, kind: "theme" })).toEqual(["t1"]);
  });

  it("members 整包替换只释放被移除的那些", () => {
    const before = goal({ id: "g1", members: [{ kind: "task", id: "t1" }, { kind: "task", id: "t2" }] });
    const after = { ...before, members: [{ kind: "task" as const, id: "t2" }] };
    expect(releasedProjectTaskIds(before, after)).toEqual(["t1"]);
  });

  it("改标题这类无关更新不释放任何任务", () => {
    const before = goal({ id: "g1", members: [{ kind: "task", id: "t1" }] });
    expect(releasedProjectTaskIds(before, { ...before, title: "新名字" })).toEqual([]);
  });

  it("archived → active 是获得归属不是释放", () => {
    const before = goal({ id: "g1", status: "archived", members: [{ kind: "task", id: "t1" }] });
    expect(releasedProjectTaskIds(before, { ...before, status: "active" })).toEqual([]);
  });
});

describe("ownedProjectTaskIds", () => {
  it("非 active 或非 project 一律空", () => {
    const members = [{ kind: "task" as const, id: "t1" }];
    expect(ownedProjectTaskIds(goal({ id: "g1", members }))).toEqual(["t1"]);
    expect(ownedProjectTaskIds(goal({ id: "g1", members, status: "archived" }))).toEqual([]);
    expect(ownedProjectTaskIds(goal({ id: "g1", members, kind: "theme" }))).toEqual([]);
  });
});
