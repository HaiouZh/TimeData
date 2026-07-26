import { describe, expect, it } from "vitest";
import { GoalSchema, type Goal, type Task } from "@timedata/shared";
import {
  buildTodoProjectGroups,
  exceedsGoalMemberCap,
  goalLinkedTaskIds,
  ownedProjectTaskIds,
  projectAssignBlock,
  projectAssignBlockMessage,
  projectMemberIndex,
  releasedProjectTaskIds,
  taskAssignBlock,
  GOAL_MEMBERS_MAX,
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
  it("已完成成员只进 doneTasks 不进 tasks", () => {
    const goals = [goal({ id: "g1", title: "装修", members: [{ kind: "task", id: "t1" }, { kind: "task", id: "t2" }] })];
    const index = projectMemberIndex(goals);
    const groups = buildTodoProjectGroups(goals, index, [task({ id: "t1" }), task({ id: "t2", done: true })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(groups[0]?.doneTasks.map((t) => t.id)).toEqual(["t2"]);
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

describe("projectAssignBlock", () => {
  const ok = { parentId: null, recurrence: null, ruleId: null };

  it("根任务 + 非重复 + 未满 → null（可以入组）", () => {
    expect(projectAssignBlock(ok, 0)).toBeNull();
    expect(projectAssignBlock(ok, GOAL_MEMBERS_MAX - 1)).toBeNull();
  });

  it("子任务 → subtask", () => {
    expect(projectAssignBlock({ ...ok, parentId: "p1" }, 0)).toBe("subtask");
  });

  // 本条与《occurrence → recurring（与模板同文案，不分两支）》**各锁一半**：
  // recurring 那句是 `recurrence !== null || ruleId !== null` 两个析取项，本条锁 recurrence 半边、
  // 那条锁 ruleId 半边。两条标题都断言 "recurring"、看着像重复用例，实际不是——
  // 未来精简重复用例时最容易被误删的一组。
  //（另有《准入不合格优先于满员：满员的组收到重复待办》同时压着两半，但它锁的是**优先级**，
  // 一旦哪天为收窄它而只留一个入参，这两半就只剩本条与那条各守一边。）
  it("重复模板 → recurring", () => {
    expect(projectAssignBlock({ ...ok, recurrence: { kind: "daily", interval: 1 } as never }, 0)).toBe("recurring");
  });

  it("occurrence → recurring（与模板同文案，不分两支）", () => {
    // 与上面《重复模板 → recurring》各锁一半，见那条的注释。
    expect(projectAssignBlock({ ...ok, ruleId: "r1" }, 0)).toBe("recurring");
  });

  it("成员已满 → full", () => {
    expect(projectAssignBlock(ok, GOAL_MEMBERS_MAX)).toBe("full");
  });

  it("准入不合格优先于满员：满员的组收到子任务，报的是 subtask 不是 full", () => {
    expect(projectAssignBlock({ ...ok, parentId: "p1" }, GOAL_MEMBERS_MAX)).toBe("subtask");
  });

  it("准入不合格优先于满员：满员的组收到重复待办，报的是 recurring 不是 full", () => {
    // full 若被插到 subtask 与 recurring 之间，重复待办撞满员的组会被告知「成员已满 500」，
    // 用户会去删成员腾位置，回来照样失败——报的原因换个组也一样成立才对。
    expect(projectAssignBlock({ ...ok, ruleId: "r1" }, GOAL_MEMBERS_MAX)).toBe("recurring");
    expect(projectAssignBlock({ ...ok, recurrence: { kind: "daily", interval: 1 } as never }, GOAL_MEMBERS_MAX)).toBe(
      "recurring",
    );
  });

  it("既是子任务又是重复待办时报 subtask：子任务是更根本的那个原因", () => {
    expect(projectAssignBlock({ ...ok, parentId: "p1", ruleId: "r1" }, 0)).toBe("subtask");
  });

  it("裸行缺 parentId 字段（undefined）不当成子任务", () => {
    // assignTaskToProject 喂进来的是 db.tasks.get 的裸行，不过 TaskSchema.parse，老行缺字段就是
    // undefined。少了 `?? null`，这些行会被永久判成 subtask、再也归不了组。
    expect(projectAssignBlock({ recurrence: null, ruleId: null } as never, 0)).toBeNull();
  });

  it("裸行缺 ruleId / recurrence 字段（undefined）不当成重复待办", () => {
    // 与上一条对称：`recurrence !== null || ruleId !== null` 少了 `?? null` 防护时，
    // 缺这两个字段的裸行会被永久判成 recurring。
    expect(projectAssignBlock({ parentId: null, recurrence: null } as never, 0)).toBeNull();
    expect(projectAssignBlock({ parentId: null, ruleId: null } as never, 0)).toBeNull();
  });

  it("GOAL_MEMBERS_MAX 与 GoalSchema 的实际上限一致（钉死两处 500 漂移）", () => {
    const base = {
      id: "g1",
      title: "装修",
      kind: "project",
      status: "active",
      prerequisites: [],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };
    const full = Array.from({ length: GOAL_MEMBERS_MAX }, (_, i) => ({ kind: "task", id: `t${i}` }));
    expect(() => GoalSchema.parse({ ...base, members: full })).not.toThrow();
    expect(() => GoalSchema.parse({ ...base, members: [...full, { kind: "task", id: "overflow" }] })).toThrow();
  });
});

describe("projectAssignBlockMessage", () => {
  it("四支各有自己的话，涉及目标组的两支带组名", () => {
    expect(projectAssignBlockMessage("subtask", "装修")).toBe("子任务不能单独归入项目，先把它拽成独立任务");
    expect(projectAssignBlockMessage("recurring", "装修")).toBe("重复待办本期不能归入项目");
    expect(projectAssignBlockMessage("full", "装修")).toBe("「装修」的成员已满 500，无法再加入");
    expect(projectAssignBlockMessage("inactive", "装修")).toBe("「装修」已归档或不再是项目，无法加入");
  });
});

describe("taskAssignBlock / exceedsGoalMemberCap", () => {
  const ok = { parentId: null, recurrence: null, ruleId: null };

  it("任务侧三支：子任务、重复模板、occurrence", () => {
    expect(taskAssignBlock(ok)).toBeNull();
    expect(taskAssignBlock({ ...ok, parentId: "p1" })).toBe("subtask");
    expect(taskAssignBlock({ ...ok, recurrence: { freq: "daily", interval: 1, basis: "due" } })).toBe("recurring");
    expect(taskAssignBlock({ ...ok, ruleId: "r1" })).toBe("recurring");
  });

  it("裸行缺字段（undefined）不被误判成 subtask / recurring", () => {
    // db.tasks.get 返回的是不过 TaskSchema.parse 的裸行，老行这三个字段可能整个缺失。
    // 少一个 `?? null`，缺字段的行就永远归不了组，且没有任何提示指向真因。
    expect(taskAssignBlock({} as Parameters<typeof taskAssignBlock>[0])).toBeNull();
  });

  it("上限判在整批之上：memberCount + addCount > 500 才算满", () => {
    expect(exceedsGoalMemberCap(499, 1)).toBe(false);
    expect(exceedsGoalMemberCap(500, 1)).toBe(true);
    expect(exceedsGoalMemberCap(495, 5)).toBe(false);
    expect(exceedsGoalMemberCap(496, 5)).toBe(true);
    expect(exceedsGoalMemberCap(0, 501)).toBe(true);
    expect(exceedsGoalMemberCap(0, 500)).toBe(false);
  });

  it("单条口径与批量口径在 addCount=1 上等价", () => {
    // projectAssignBlock 原本判的是 `memberCount >= 500`。重构后它走 exceedsGoalMemberCap(n, 1)，
    // 两者必须在边界上逐点相等——这条用例是那次改写的唯一回归保证。
    for (const memberCount of [0, 1, 498, 499, 500, 501]) {
      expect(projectAssignBlock(ok, memberCount) === "full").toBe(memberCount >= 500);
    }
  });
});
