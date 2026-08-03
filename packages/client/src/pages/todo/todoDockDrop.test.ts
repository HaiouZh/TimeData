import { describe, expect, it, vi } from "vitest";
import { applyTodoDockDrop, type TodoDockDropDeps } from "./todoDockDrop.js";

function makeDeps(overrides: Partial<TodoDockDropDeps> = {}): TodoDockDropDeps & {
  grabToHand: ReturnType<typeof vi.fn>;
  showToast: ReturnType<typeof vi.fn>;
  hapticDrop: ReturnType<typeof vi.fn>;
} {
  return {
    grabToHand: vi.fn(async () => undefined),
    showToast: vi.fn(),
    subtaskBlockMessage: (goalTitle: string) => `子任务不能归入「${goalTitle}」`,
    findGoalTitle: (goalId: string) => (goalId === "g1" ? "装修房子" : null),
    hapticDrop: vi.fn(),
    ...overrides,
  };
}

describe("applyTodoDockDrop", () => {
  it("非 dock 落点返回 null,不做任何副作用", async () => {
    const deps = makeDeps();
    const result = await applyTodoDockDrop(deps, {
      dockId: "pool:today",
      activeContainerId: "pool:inbox",
      activeParentId: null,
      activeId: "t1",
    });
    expect(result).toBeNull();
    expect(deps.grabToHand).not.toHaveBeenCalled();
    expect(deps.showToast).not.toHaveBeenCalled();
  });

  it("手头药丸:调 grabToHand(activeId),成功不弹 toast", async () => {
    const deps = makeDeps();
    const result = await applyTodoDockDrop(deps, {
      dockId: "dock:hand",
      activeContainerId: "pool:inbox",
      activeParentId: null,
      activeId: "t1",
    });
    expect(result).toBe("handled");
    expect(deps.grabToHand).toHaveBeenCalledWith("t1");
    expect(deps.showToast).not.toHaveBeenCalled();
  });

  it("手头投递失败:toast 抛错里的用户文案,不再向上抛", async () => {
    const deps = makeDeps({
      grabToHand: vi.fn(async () => {
        throw new Error("子任务不能单独抓到手头");
      }),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await applyTodoDockDrop(deps, {
      dockId: "dock:hand",
      activeContainerId: "pool:inbox",
      activeParentId: null,
      activeId: "t1",
    });
    errorSpy.mockRestore();
    expect(result).toBe("handled");
    expect(deps.showToast).toHaveBeenCalledWith("子任务不能单独抓到手头");
  });

  it("子任务(parent:)投手头:透传 promote-to-hand,不调 grabToHand", async () => {
    const deps = makeDeps();
    const result = await applyTodoDockDrop(deps, {
      dockId: "dock:hand",
      activeContainerId: "parent:p1",
      activeParentId: "p1",
      activeId: "c1",
    });
    expect(result).toEqual({ kind: "promote-to-hand" });
    expect(deps.grabToHand).not.toHaveBeenCalled();
    expect(deps.showToast).not.toHaveBeenCalled();
  });

  it("子任务投项目药丸:toast 拒绝文案(口径与项目卡一致),消化不透传", async () => {
    const deps = makeDeps();
    const result = await applyTodoDockDrop(deps, {
      dockId: "dock:project:g1",
      activeContainerId: "parent:p1",
      activeParentId: "p1",
      activeId: "c1",
    });
    expect(result).toBe("handled");
    expect(deps.showToast).toHaveBeenCalledWith("子任务不能归入「装修房子」");
  });

  it("子任务投项目但组已不可见:静默消化,不弹空标题 toast", async () => {
    const deps = makeDeps();
    const result = await applyTodoDockDrop(deps, {
      dockId: "dock:project:gone",
      activeContainerId: "parent:p1",
      activeParentId: "p1",
      activeId: "c1",
    });
    expect(result).toBe("handled");
    expect(deps.showToast).not.toHaveBeenCalled();
  });

  it("根任务投池/项目药丸:折算成既有 op 透传给页面 switch", async () => {
    const deps = makeDeps();
    const toToday = await applyTodoDockDrop(deps, {
      dockId: "dock:pool:today",
      activeContainerId: "pool:inbox",
      activeParentId: null,
      activeId: "t1",
    });
    expect(toToday).toEqual({ kind: "schedule-root", pool: "today" });
    const toProject = await applyTodoDockDrop(deps, {
      dockId: "dock:project:g1",
      activeContainerId: "pool:inbox",
      activeParentId: null,
      activeId: "t1",
    });
    expect(toProject).toEqual({ kind: "assign-to-project", goalId: "g1" });
    expect(deps.grabToHand).not.toHaveBeenCalled();
    expect(deps.showToast).not.toHaveBeenCalled();
  });
});

// design-language §4 第 13 条：`hapticDrop` = 拖拽吸附落位。坞的「抓到手头」是落位成功却被坞消化掉、
// 不走页面的 op switch，于是曾经绕过了那边唯一的 hapticDrop——同一个动作在药丸上不震、在池子里震。
describe("坞落位的触感", () => {
  it("抓到手头成功时震一次", async () => {
    const deps = makeDeps();
    await applyTodoDockDrop(deps, {
      dockId: "dock:hand",
      activeContainerId: "pool:inbox",
      activeParentId: null,
      activeId: "t1",
    });
    expect(deps.hapticDrop).toHaveBeenCalledTimes(1);
  });

  it("抓到手头失败时不震（没落成位就不是落位）", async () => {
    const deps = makeDeps({
      grabToHand: vi.fn(async () => {
        throw new Error("子任务不能单独抓到手头");
      }),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await applyTodoDockDrop(deps, {
      dockId: "dock:hand",
      activeContainerId: "pool:inbox",
      activeParentId: null,
      activeId: "t1",
    });
    errorSpy.mockRestore();
    expect(deps.hapticDrop).not.toHaveBeenCalled();
  });

  it("invalid 拒绝（子任务投项目）不震", async () => {
    const deps = makeDeps();
    await applyTodoDockDrop(deps, {
      dockId: "dock:project:g1",
      activeContainerId: "parent:p1",
      activeParentId: "p1",
      activeId: "c1",
    });
    expect(deps.showToast).toHaveBeenCalled();
    expect(deps.hapticDrop).not.toHaveBeenCalled();
  });

  it("折算成 op 透传的那支这里不震，交给页面统一震（否则一次落位震两下）", async () => {
    const deps = makeDeps();
    await applyTodoDockDrop(deps, {
      dockId: "dock:pool:today",
      activeContainerId: "pool:inbox",
      activeParentId: null,
      activeId: "t1",
    });
    expect(deps.hapticDrop).not.toHaveBeenCalled();
  });
});
