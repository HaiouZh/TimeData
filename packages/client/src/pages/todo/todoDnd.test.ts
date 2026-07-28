import type { Modifier } from "@dnd-kit/core";
import type { Transform } from "@dnd-kit/utilities";
import { describe, expect, it } from "vitest";
import {
  clampTodoIndentPreview,
  containerIdForTask,
  hoveredRootIdFromOver,
  parseTodoContainerId,
  parseTodoDockId,
  preferProjectCollisions,
  resolveTodoDockDrop,
  projectContainerId,
  resolveIndentLevel,
  resolveTodoDragOperation,
  resolveTodoDragWithIndent,
  TODO_CHILD_INDENT_PX,
  TODO_INDENT_RELEASE_PX,
  type TodoContainer,
  todoContainerId,
  todoDockId,
  todoDockTargets,
} from "./todoDnd.js";

/** 只喂 transform 调用 modifier（其余 ModifierArguments 字段本实现用不到）。 */
function applyModifier(modifier: Modifier, transform: Transform): Transform {
  return modifier({ transform } as Parameters<Modifier>[0]);
}

describe("resolveIndentLevel", () => {
  it("root 起手未达 28px 保持 root", () => {
    expect(resolveIndentLevel(27, "root")).toBe("root");
  });

  it("root 起手达到 28px 变 child", () => {
    expect(resolveIndentLevel(TODO_CHILD_INDENT_PX, "root")).toBe("child");
  });

  it("child 态回落到 12px 以内才回 root", () => {
    expect(resolveIndentLevel(TODO_INDENT_RELEASE_PX + 1, "child")).toBe("child");
    expect(resolveIndentLevel(TODO_INDENT_RELEASE_PX, "child")).toBe("root");
  });

  it("负向位移恒为 root", () => {
    expect(resolveIndentLevel(-1, "root")).toBe("root");
    expect(resolveIndentLevel(-1, "child")).toBe("root");
  });
});

describe("resolveIndentLevel（子任务基线 base=child）", () => {
  it("子任务竖直拖（deltaX≈0）保持 child，不被误升级为 root", () => {
    expect(resolveIndentLevel(0, "child", "child")).toBe("child");
    expect(resolveIndentLevel(5, "child", "child")).toBe("child");
  });

  it("子任务正向位移（向右）恒为 child", () => {
    expect(resolveIndentLevel(80, "child", "child")).toBe("child");
    expect(resolveIndentLevel(80, "root", "child")).toBe("child");
  });

  it("子任务向左未越 -28 仍是 child", () => {
    expect(resolveIndentLevel(-(TODO_CHILD_INDENT_PX - 1), "child", "child")).toBe("child");
  });

  it("子任务向左越过 -28 升级为 root", () => {
    expect(resolveIndentLevel(-TODO_CHILD_INDENT_PX, "child", "child")).toBe("root");
  });

  it("子任务升级 root 后滞回到 -12 内才回落 child", () => {
    expect(resolveIndentLevel(-(TODO_INDENT_RELEASE_PX + 1), "root", "child")).toBe("root");
    expect(resolveIndentLevel(-TODO_INDENT_RELEASE_PX, "root", "child")).toBe("child");
  });
});

describe("clampTodoIndentPreview", () => {
  it("保留向右缩进预览但夹到一个缩进宽度", () => {
    expect(applyModifier(clampTodoIndentPreview, { x: 80, y: 12, scaleX: 1, scaleY: 1 })).toEqual({
      x: TODO_CHILD_INDENT_PX,
      y: 12,
      scaleX: 1,
      scaleY: 1,
    });
  });

  it("向左预览夹回 0,避免横向滚动条", () => {
    expect(applyModifier(clampTodoIndentPreview, { x: -20, y: 12, scaleX: 1, scaleY: 1 }).x).toBe(0);
  });

  it("拖子任务时向左升级预览夹到 -28，向右夹回 0", () => {
    const childActive = { data: { current: { containerId: "parent:root-1" } } };
    const left = clampTodoIndentPreview({
      transform: { x: -80, y: 0, scaleX: 1, scaleY: 1 },
      active: childActive,
    } as Parameters<Modifier>[0]);
    const right = clampTodoIndentPreview({
      transform: { x: 40, y: 0, scaleX: 1, scaleY: 1 },
      active: childActive,
    } as Parameters<Modifier>[0]);
    expect(left.x).toBe(-TODO_CHILD_INDENT_PX);
    expect(right.x).toBe(0);
  });
});

describe("parseTodoContainerId", () => {
  it.each<[string, TodoContainer]>([
    ["pool:today", { kind: "pool", pool: "today" }],
    ["pool:inbox", { kind: "pool", pool: "inbox" }],
    ["parent:root-1", { kind: "parent", parentId: "root-1" }],
    ["parent:abc-def-123", { kind: "parent", parentId: "abc-def-123" }],
  ])("解析 %s", (input, expected) => {
    expect(parseTodoContainerId(input)).toEqual(expected);
  });

  it.each(["", null, undefined, "parent:", "pool:upcoming", "pool:completed", "random"])("拒绝 %s", (value) => {
    expect(parseTodoContainerId(value as string | null | undefined)).toBeNull();
  });
});

describe("resolveTodoDragOperation", () => {
  it("active 与 target 同一池容器 → reorder", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "pool:today",
        targetContainerId: "pool:today",
        activeParentId: null,
      }),
    ).toEqual({ kind: "reorder", containerId: "pool:today" });
  });

  it("active 与 target 同一 parent 容器 → reorder", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "parent:root-1",
        targetContainerId: "parent:root-1",
        activeParentId: "root-1",
      }),
    ).toEqual({ kind: "reorder", containerId: "parent:root-1" });
  });

  it("child（parent 容器）→ 池容器 → promote-to-root", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "parent:root-1",
        targetContainerId: "pool:today",
        activeParentId: "root-1",
      }),
    ).toEqual({ kind: "promote-to-root", pool: "today" });
    expect(
      resolveTodoDragOperation({
        activeContainerId: "parent:root-1",
        targetContainerId: "pool:inbox",
        activeParentId: "root-1",
      }),
    ).toEqual({ kind: "promote-to-root", pool: "inbox" });
  });

  it("root（池容器）→ parent 容器 → move-to-parent", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "pool:today",
        targetContainerId: "parent:root-2",
        activeParentId: null,
      }),
    ).toEqual({ kind: "move-to-parent", parentId: "root-2" });
  });

  it("root today → inbox → schedule-root pool=inbox", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "pool:today",
        targetContainerId: "pool:inbox",
        activeParentId: null,
      }),
    ).toEqual({ kind: "schedule-root", pool: "inbox" });
  });

  it("root inbox → today → schedule-root pool=today", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "pool:inbox",
        targetContainerId: "pool:today",
        activeParentId: null,
      }),
    ).toEqual({ kind: "schedule-root", pool: "today" });
  });

  it("child 跨 parent 容器 → move-to-parent", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "parent:root-1",
        targetContainerId: "parent:root-2",
        activeParentId: "root-1",
      }),
    ).toEqual({ kind: "move-to-parent", parentId: "root-2" });
  });

  it("非法 container id → null", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "pool:upcoming",
        targetContainerId: "pool:today",
        activeParentId: null,
      }),
    ).toBeNull();
    expect(
      resolveTodoDragOperation({
        activeContainerId: "pool:today",
        targetContainerId: "parent:",
        activeParentId: null,
      }),
    ).toBeNull();
  });

  it("收件箱同容器 → null（显示序按 createdAt，落库只会白写 sortOrder + 重置重力时钟）", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "pool:inbox",
        targetContainerId: "pool:inbox",
        activeParentId: null,
      }),
    ).toBeNull();
  });
});

describe("hoveredRootIdFromOver", () => {
  it("over 是池中的根行 → over 自身就是 root id", () => {
    expect(hoveredRootIdFromOver("pool:today", "task-1")).toBe("task-1");
    expect(hoveredRootIdFromOver("pool:inbox", "task-2")).toBe("task-2");
  });

  it("over 落在 parent 容器（子任务行或落点区）→ root = parentId", () => {
    expect(hoveredRootIdFromOver("parent:root-1", "child-9")).toBe("root-1");
    expect(hoveredRootIdFromOver("parent:root-1", "parent-zone:root-1")).toBe("root-1");
  });

  it("非法 / 缺失容器 → null", () => {
    expect(hoveredRootIdFromOver("", "x")).toBeNull();
    expect(hoveredRootIdFromOver("parent:", "x")).toBeNull();
    expect(hoveredRootIdFromOver("pool:upcoming", "x")).toBeNull();
  });

  it("同父子任务排序时 over 缺 containerId，兜底使用 active 的 parent 容器", () => {
    expect(hoveredRootIdFromOver("", "child-2", "parent:root-1")).toBe("root-1");
  });
});

const baseIndentInput = {
  activeContainerId: "pool:today",
  activeParentId: null,
  activeId: "active",
  activeHasChildren: false,
  indentLevel: "root",
  rootAboveId: "parent",
  targetContainer: { kind: "pool", pool: "today" },
} as const;

describe("resolveTodoDragWithIndent", () => {
  it("root 无 children + child 缩进 + 候选父 -> move-to-parent", () => {
    expect(resolveTodoDragWithIndent({ ...baseIndentInput, indentLevel: "child" })).toEqual({
      kind: "move-to-parent",
      parentId: "parent",
    });
  });

  it("root 有 children 时 child 缩进失效,同池仍是 reorder", () => {
    expect(
      resolveTodoDragWithIndent({
        ...baseIndentInput,
        activeHasChildren: true,
        indentLevel: "child",
      }),
    ).toEqual({ kind: "reorder", containerId: "pool:today" });
  });

  it("root 无 child 缩进、跨 today/inbox -> schedule-root", () => {
    expect(resolveTodoDragWithIndent({ ...baseIndentInput, targetContainer: { kind: "pool", pool: "inbox" } })).toEqual(
      {
        kind: "schedule-root",
        pool: "inbox",
      },
    );
  });

  it("child 左回 root -> promote-to-root", () => {
    expect(
      resolveTodoDragWithIndent({
        ...baseIndentInput,
        activeContainerId: "parent:old",
        activeParentId: "old",
        indentLevel: "root",
        targetContainer: { kind: "pool", pool: "inbox" },
      }),
    ).toEqual({ kind: "promote-to-root", pool: "inbox" });
  });

  it("child 保持 child 且候选父为原父 -> reorder 原 parent 容器", () => {
    expect(
      resolveTodoDragWithIndent({
        ...baseIndentInput,
        activeContainerId: "parent:old",
        activeParentId: "old",
        indentLevel: "child",
        rootAboveId: "old",
      }),
    ).toEqual({ kind: "reorder", containerId: "parent:old" });
  });

  it("child 保持 child 且候选父变化 -> move-to-parent 新父", () => {
    expect(
      resolveTodoDragWithIndent({
        ...baseIndentInput,
        activeContainerId: "parent:old",
        activeParentId: "old",
        indentLevel: "child",
        rootAboveId: "new",
      }),
    ).toEqual({ kind: "move-to-parent", parentId: "new" });
  });

  it("候选父为自己或为空时不降级,退回 root 级判定", () => {
    // **承重单位在这里是断言不是测试**：下面两条断言各锁 canBecomeChild 的一个条件——
    // 第一条锁 `rootAboveId !== activeId`（拖到自己头上不该把自己接成自己的子任务），
    // 第二条锁 `rootAboveId !== null`（没有候选父时不该拼出 `parent:null`）。
    // 删掉任一条，被它守的那个条件就裸奔了；两条看着像重复，实际不是。
    expect(
      resolveTodoDragWithIndent({
        ...baseIndentInput,
        indentLevel: "child",
        rootAboveId: "active",
      }),
    ).toEqual({ kind: "reorder", containerId: "pool:today" });
    expect(
      resolveTodoDragWithIndent({
        ...baseIndentInput,
        indentLevel: "child",
        rootAboveId: null,
      }),
    ).toEqual({ kind: "reorder", containerId: "pool:today" });
  });

  it("无法得到目标池且没有合法候选父时返回 null", () => {
    expect(resolveTodoDragWithIndent({ ...baseIndentInput, rootAboveId: null, targetContainer: null })).toBeNull();
  });

  it("收件箱内竖直重排 -> null，不落 persistTaskOrder", () => {
    expect(
      resolveTodoDragWithIndent({
        ...baseIndentInput,
        activeContainerId: "pool:inbox",
        targetContainer: { kind: "pool", pool: "inbox" },
      }),
    ).toBeNull();
  });

  it("收件箱内缩进成子任务不受短路影响 -> move-to-parent", () => {
    expect(
      resolveTodoDragWithIndent({
        ...baseIndentInput,
        activeContainerId: "pool:inbox",
        targetContainer: { kind: "pool", pool: "inbox" },
        indentLevel: "child",
      }),
    ).toEqual({ kind: "move-to-parent", parentId: "parent" });
  });
});

describe("containerIdForTask", () => {
  it("child 任务返回 parent:<id>", () => {
    expect(containerIdForTask({ parentId: "root-1", scheduledAt: null }, "2026-06-19")).toBe("parent:root-1");
  });

  it("无 scheduledAt 的 root → pool:inbox", () => {
    expect(containerIdForTask({ parentId: null, scheduledAt: null }, "2026-06-19")).toBe("pool:inbox");
  });

  it("scheduledAt 是今天 → pool:today", () => {
    expect(containerIdForTask({ parentId: null, scheduledAt: "2026-06-19T00:00:00.000Z" }, "2026-06-19")).toBe(
      "pool:today",
    );
  });

  it("scheduledAt 是别的日期 → 空字符串（upcoming 不参与拖拽）", () => {
    expect(containerIdForTask({ parentId: null, scheduledAt: "2026-07-01T00:00:00.000Z" }, "2026-06-19")).toBe("");
  });
});

describe("project 容器（P3 拖拽归入）", () => {
  it("parseTodoContainerId 认 project:<goalId>", () => {
    expect(parseTodoContainerId("project:g1")).toEqual({ kind: "project", goalId: "g1" });
  });

  it("空 goalId 的 project: 视为非法", () => {
    expect(parseTodoContainerId("project:")).toBeNull();
  });

  it("projectContainerId / todoContainerId 与解析互为逆", () => {
    const id = projectContainerId("g1");
    expect(id).toBe("project:g1");
    expect(todoContainerId(parseTodoContainerId(id) as TodoContainer)).toBe(id);
    expect(todoContainerId({ kind: "pool", pool: "inbox" })).toBe("pool:inbox");
    expect(todoContainerId({ kind: "parent", parentId: "p1" })).toBe("parent:p1");
  });

  it("收件箱根任务 → 项目组 = assign-to-project", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "pool:inbox",
        targetContainerId: "project:g1",
        activeParentId: null,
      }),
    ).toEqual({ kind: "assign-to-project", goalId: "g1" });
  });

  it("今天区根任务 → 项目组 = assign-to-project（时间轴与归属轴正交）", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "pool:today",
        targetContainerId: "project:g1",
        activeParentId: null,
      }),
    ).toEqual({ kind: "assign-to-project", goalId: "g1" });
  });

  it("子任务 → 项目组 = null：不做「先升根再入组」的复合动作", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "parent:p1",
        targetContainerId: "project:g1",
        activeParentId: "p1",
      }),
    ).toBeNull();
  });

  it("池容器里但 activeParentId 非空（数据不自洽）→ null", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "pool:inbox",
        targetContainerId: "project:g1",
        activeParentId: "p1",
      }),
    ).toBeNull();
  });

  it("active 是项目容器 → null：项目区的行不注册 draggable，这是防御闸", () => {
    // 注意：本例当前**不**能证明那道防御闸存在——把 resolveTodoDragOperation 里
    // `if (active.kind === "project") return null;` 整行删掉，本文件照样全绿（下面四个分支都要求
    // active 是 pool/parent，落到函数末尾同样 return null）。它锁的是**返回值契约**，
    // 将来给项目容器新增分支时才会变成真闸。
    expect(
      resolveTodoDragOperation({
        activeContainerId: "project:g1",
        targetContainerId: "pool:inbox",
        activeParentId: null,
      }),
    ).toBeNull();
  });

  it("hoveredRootIdFromOver 对项目容器恒返回 null（项目区无可作缩进父的根行）", () => {
    expect(hoveredRootIdFromOver("project:g1", "g1")).toBeNull();
  });
});

describe("resolveTodoDragWithIndent × 项目容器", () => {
  const base = {
    activeContainerId: "pool:inbox",
    activeParentId: null,
    activeId: "t1",
    activeHasChildren: false,
  };

  it("手指带横向位移（indentLevel=child）拖进项目组，仍是 assign-to-project", () => {
    expect(
      resolveTodoDragWithIndent({
        ...base,
        indentLevel: "child",
        rootAboveId: null,
        targetContainer: { kind: "project", goalId: "g1" },
      }),
    ).toEqual({ kind: "assign-to-project", goalId: "g1" });
  });

  it("即使调用方错传了非空 rootAboveId，项目容器也不得被判成 move-to-parent", () => {
    expect(
      resolveTodoDragWithIndent({
        ...base,
        indentLevel: "child",
        rootAboveId: "t9",
        targetContainer: { kind: "project", goalId: "g1" },
      }),
    ).toEqual({ kind: "assign-to-project", goalId: "g1" });
  });

  it("目标容器为 null 时行为不变，仍返回 null", () => {
    expect(
      resolveTodoDragWithIndent({ ...base, indentLevel: "root", rootAboveId: null, targetContainer: null }),
    ).toBeNull();
  });
});

describe("preferProjectCollisions", () => {
  const hit = (id: string) => ({ id }) as never;

  it("指针落在项目组内 → 只保留项目组，不让 closestCenter 的近邻抢走", () => {
    const result = preferProjectCollisions({
      pointerHits: [hit("project:g1"), hit("t9")],
      fallback: () => [hit("t9")],
    });
    expect(result.map((c) => c.id)).toEqual(["project:g1"]);
  });

  it("指针没落在任何项目组 → 原样退回 closestCenter 的结果（既有行为一字不变）", () => {
    const fallback = [hit("t9"), hit("t8")];
    expect(preferProjectCollisions({ pointerHits: [hit("t9")], fallback: () => fallback })).toBe(fallback);
  });

  it("指针命中为空（如键盘拖拽）→ 退回 closestCenter", () => {
    const fallback = [hit("t9")];
    expect(preferProjectCollisions({ pointerHits: [], fallback: () => fallback })).toBe(fallback);
  });

  it("同时命中多个项目组时全部保留，交给 dnd-kit 定序", () => {
    const result = preferProjectCollisions({
      pointerHits: [hit("project:g1"), hit("project:g2")],
      fallback: () => [],
    });
    expect(result.map((c) => c.id)).toEqual(["project:g1", "project:g2"]);
  });

  it("命中项目组时 fallback 一次都不求值：closestCenter 每帧遍历全部 droppable，结果注定被丢弃", () => {
    let calls = 0;
    const result = preferProjectCollisions({
      pointerHits: [hit("project:g1")],
      fallback: () => {
        calls += 1;
        return [hit("t9")];
      },
    });
    expect(result.map((c) => c.id)).toEqual(["project:g1"]);
    expect(calls).toBe(0);
  });

  it("只认 project: 前缀，不认 id 里恰好含 project 的近似落点", () => {
    // 判据若从 startsWith 松成 includes，这类 id 会被当成项目落点、把真正的落点顶掉。
    const fallback = [hit("parent:my-project-notes"), hit("project-ideas")];
    expect(
      preferProjectCollisions({
        pointerHits: [hit("parent:my-project-notes"), hit("project-ideas")],
        fallback: () => fallback,
      }),
    ).toBe(fallback);
  });

  it("数字型 UniqueIdentifier 不炸（dnd-kit 的 id 是 string | number）", () => {
    const fallback = [hit("t9")];
    expect(preferProjectCollisions({ pointerHits: [{ id: 42 } as never], fallback: () => fallback })).toBe(fallback);
  });
});

describe("todoDock id 域", () => {
  it("todoDockId ↔ parseTodoDockId 往返一致", () => {
    const targets = [
      { kind: "pool", pool: "today" },
      { kind: "pool", pool: "inbox" },
      { kind: "hand" },
      { kind: "project", goalId: "g1" },
    ] as const;
    for (const target of targets) {
      expect(parseTodoDockId(todoDockId(target))).toEqual(target);
    }
  });

  it("非法 id 返回 null", () => {
    for (const bad of ["", "dock:", "dock:project:", "pool:today", "project:g1", "dock:pool:done"]) {
      expect(parseTodoDockId(bad)).toBeNull();
    }
  });
});

describe("resolveTodoDockDrop", () => {
  it("非 dock id → not-dock", () => {
    expect(
      resolveTodoDockDrop({ dockId: "pool:today", activeContainerId: "pool:inbox", activeParentId: null }),
    ).toEqual({ kind: "not-dock" });
  });

  it("任意来源 → dock:hand = grab-to-hand", () => {
    expect(
      resolveTodoDockDrop({ dockId: "dock:hand", activeContainerId: "pool:inbox", activeParentId: null }),
    ).toEqual({ kind: "grab-to-hand" });
  });

  it("inbox 根任务 → dock:pool:today = schedule-root today", () => {
    expect(
      resolveTodoDockDrop({ dockId: "dock:pool:today", activeContainerId: "pool:inbox", activeParentId: null }),
    ).toEqual({ kind: "op", op: { kind: "schedule-root", pool: "today" } });
  });

  it("today 根任务 → dock:pool:inbox = schedule-root inbox", () => {
    expect(
      resolveTodoDockDrop({ dockId: "dock:pool:inbox", activeContainerId: "pool:today", activeParentId: null }),
    ).toEqual({ kind: "op", op: { kind: "schedule-root", pool: "inbox" } });
  });

  it("子任务 → dock 池药丸 = promote-to-root(与拖进池容器同义)", () => {
    expect(
      resolveTodoDockDrop({ dockId: "dock:pool:inbox", activeContainerId: "parent:p1", activeParentId: "p1" }),
    ).toEqual({ kind: "op", op: { kind: "promote-to-root", pool: "inbox" } });
  });

  it("根任务 → dock 项目药丸 = assign-to-project", () => {
    expect(
      resolveTodoDockDrop({ dockId: "dock:project:g1", activeContainerId: "pool:inbox", activeParentId: null }),
    ).toEqual({ kind: "op", op: { kind: "assign-to-project", goalId: "g1" } });
  });

  it("子任务 → dock 项目药丸 = invalid(与项目卡准入同口径)", () => {
    expect(
      resolveTodoDockDrop({ dockId: "dock:project:g1", activeContainerId: "parent:p1", activeParentId: "p1" }),
    ).toEqual({ kind: "invalid", target: { kind: "project", goalId: "g1" } });
  });

  it("同池投递(today→dock:pool:today)= invalid,坞不做重排", () => {
    expect(
      resolveTodoDockDrop({ dockId: "dock:pool:today", activeContainerId: "pool:today", activeParentId: null }),
    ).toEqual({ kind: "invalid", target: { kind: "pool", pool: "today" } });
  });
});

describe("todoDockTargets", () => {
  const projects = [{ goalId: "g1" }, { goalId: "g2" }];

  it("拖 inbox 行:无收件箱药丸,顺序为 今天/手头/项目", () => {
    expect(todoDockTargets("pool:inbox", projects)).toEqual([
      { kind: "pool", pool: "today" },
      { kind: "hand" },
      { kind: "project", goalId: "g1" },
      { kind: "project", goalId: "g2" },
    ]);
  });

  it("拖 today 行:无今天药丸", () => {
    expect(todoDockTargets("pool:today", projects)).toEqual([
      { kind: "hand" },
      { kind: "pool", pool: "inbox" },
      { kind: "project", goalId: "g1" },
      { kind: "project", goalId: "g2" },
    ]);
  });

  it("拖子任务(parent:):今天/收件箱都在(升根语义)", () => {
    expect(todoDockTargets("parent:p1", [])).toEqual([
      { kind: "pool", pool: "today" },
      { kind: "hand" },
      { kind: "pool", pool: "inbox" },
    ]);
  });
});

describe("dock 对既有判定的守卫", () => {
  it("hoveredRootIdFromOver:over 是 dock id 时恒 null,即便 fallback 是池容器", () => {
    // 不加守卫时:parseTodoContainerId("dock:hand")=null → fall 到 activeContainerId("pool:inbox")
    // → kind=pool → 返回 overId("dock:hand") ≠ null,下游会拼出 parent:dock:hand 的垃圾落点。
    expect(hoveredRootIdFromOver("dock:hand", "dock:hand", "pool:inbox")).toBeNull();
    expect(hoveredRootIdFromOver("dock:project:g1", "dock:project:g1", "pool:today")).toBeNull();
  });

  it("preferProjectCollisions:pointer 同时命中 dock 与行/项目时只认 dock", () => {
    const hit = (id: string) => ({ id }) as never;
    const result = preferProjectCollisions({
      pointerHits: [hit("t1"), hit("dock:project:g1"), hit("project:g2")],
      fallback: () => [],
    });
    expect((result as { id: string }[]).map((c) => c.id)).toEqual(["dock:project:g1"]);
    // 无 dock 命中时行为一字不变
    const noDock = preferProjectCollisions({ pointerHits: [hit("t1"), hit("project:g2")], fallback: () => [] });
    expect((noDock as { id: string }[]).map((c) => c.id)).toEqual(["project:g2"]);
  });
});
