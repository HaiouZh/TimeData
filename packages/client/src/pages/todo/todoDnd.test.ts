import type { Modifier } from "@dnd-kit/core";
import type { Transform } from "@dnd-kit/utilities";
import { describe, expect, it } from "vitest";
import {
  clampTodoIndentPreview,
  containerIdForTask,
  hoveredRootIdFromOver,
  parseTodoContainerId,
  resolveIndentLevel,
  resolveTodoDragOperation,
  resolveTodoDragWithIndent,
  TODO_CHILD_INDENT_PX,
  TODO_INDENT_RELEASE_PX,
  type TodoContainer,
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
  targetPool: "today",
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
    expect(resolveTodoDragWithIndent({ ...baseIndentInput, targetPool: "inbox" })).toEqual({
      kind: "schedule-root",
      pool: "inbox",
    });
  });

  it("child 左回 root -> promote-to-root", () => {
    expect(
      resolveTodoDragWithIndent({
        ...baseIndentInput,
        activeContainerId: "parent:old",
        activeParentId: "old",
        indentLevel: "root",
        targetPool: "inbox",
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
    expect(resolveTodoDragWithIndent({ ...baseIndentInput, rootAboveId: null, targetPool: null })).toBeNull();
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
