import type { Modifier } from "@dnd-kit/core";
import type { Transform } from "@dnd-kit/utilities";
import { describe, expect, it } from "vitest";
import {
  armTargetFromDragOver,
  containerIdForTask,
  hoveredRootIdFromOver,
  parseTodoContainerId,
  resolveTodoDragOperation,
  resolveTodoDragWithArm,
  restrictToVerticalAxis,
  type TodoContainer,
} from "./todoDnd.js";

/** 只喂 transform 调用 modifier（其余 ModifierArguments 字段本实现用不到）。 */
function applyModifier(modifier: Modifier, transform: Transform): Transform {
  return modifier({ transform } as Parameters<Modifier>[0]);
}

describe("parseTodoContainerId", () => {
  it.each<[string, TodoContainer]>([
    ["pool:today", { kind: "pool", pool: "today" }],
    ["pool:inbox", { kind: "pool", pool: "inbox" }],
    ["parent:root-1", { kind: "parent", parentId: "root-1" }],
    ["parent:abc-def-123", { kind: "parent", parentId: "abc-def-123" }],
  ])("解析 %s", (input, expected) => {
    expect(parseTodoContainerId(input)).toEqual(expected);
  });

  it.each(["", null, undefined, "parent:", "pool:upcoming", "pool:completed", "random"])(
    "拒绝 %s",
    (value) => {
      expect(parseTodoContainerId(value as string | null | undefined)).toBeNull();
    },
  );
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
});

describe("armTargetFromDragOver", () => {
  it("根任务悬停在另一根任务行上 → 该根为可激活目标", () => {
    expect(
      armTargetFromDragOver({
        overContainerId: "pool:today",
        overId: "root-2",
        activeId: "root-1",
        activeParentId: null,
      }),
    ).toBe("root-2");
  });

  it("悬停在自己身上 → null（不能嵌入自身）", () => {
    expect(
      armTargetFromDragOver({
        overContainerId: "pool:today",
        overId: "root-1",
        activeId: "root-1",
        activeParentId: null,
      }),
    ).toBeNull();
  });

  it("子任务悬停在自己的父行/父容器上 → null（已展开，无需激活）", () => {
    expect(
      armTargetFromDragOver({
        overContainerId: "parent:p1",
        overId: "child-x",
        activeId: "child-a",
        activeParentId: "p1",
      }),
    ).toBeNull();
  });

  it("子任务悬停在另一个根上 → 该根为可激活目标（跨父）", () => {
    expect(
      armTargetFromDragOver({
        overContainerId: "parent:root-2",
        overId: "child-y",
        activeId: "child-a",
        activeParentId: "p1",
      }),
    ).toBe("root-2");
  });

  it("无效 over → null", () => {
    expect(
      armTargetFromDragOver({
        overContainerId: "",
        overId: "x",
        activeId: "root-1",
        activeParentId: null,
      }),
    ).toBeNull();
  });
});

describe("resolveTodoDragWithArm", () => {
  it("未激活：同池根任务互拖仍是 reorder", () => {
    expect(
      resolveTodoDragWithArm({
        activeContainerId: "pool:today",
        overContainerId: "pool:today",
        overId: "root-2",
        activeId: "root-1",
        activeParentId: null,
        armedParentId: null,
      }),
    ).toEqual({ kind: "reorder", containerId: "pool:today" });
  });

  it("未激活：today → inbox 根任务仍是 schedule-root", () => {
    expect(
      resolveTodoDragWithArm({
        activeContainerId: "pool:today",
        overContainerId: "pool:inbox",
        overId: "root-9",
        activeId: "root-1",
        activeParentId: null,
        armedParentId: null,
      }),
    ).toEqual({ kind: "schedule-root", pool: "inbox" });
  });

  it("已激活目标 A，松手仍落在 A 行（池容器）→ move-to-parent A", () => {
    expect(
      resolveTodoDragWithArm({
        activeContainerId: "pool:today",
        overContainerId: "pool:today",
        overId: "root-A",
        activeId: "root-1",
        activeParentId: null,
        armedParentId: "root-A",
      }),
    ).toEqual({ kind: "move-to-parent", parentId: "root-A" });
  });

  it("已激活目标 A，松手落在 A 的展开落点区（parent 容器）→ move-to-parent A", () => {
    expect(
      resolveTodoDragWithArm({
        activeContainerId: "pool:today",
        overContainerId: "parent:root-A",
        overId: "parent-zone:root-A",
        activeId: "root-1",
        activeParentId: null,
        armedParentId: "root-A",
      }),
    ).toEqual({ kind: "move-to-parent", parentId: "root-A" });
  });

  it("激活的是 A，但松手时指针已移到别处 B → 不强行嵌入，按常规判定", () => {
    expect(
      resolveTodoDragWithArm({
        activeContainerId: "pool:today",
        overContainerId: "pool:today",
        overId: "root-B",
        activeId: "root-1",
        activeParentId: null,
        armedParentId: "root-A",
      }),
    ).toEqual({ kind: "reorder", containerId: "pool:today" });
  });

  it("激活目标恰为自身（异常）→ 不强行嵌入", () => {
    // armed 不该等于 activeId，但即便发生也不能把自己嵌进自己。
    const op = resolveTodoDragWithArm({
      activeContainerId: "pool:today",
      overContainerId: "pool:today",
      overId: "root-1",
      activeId: "root-1",
      activeParentId: null,
      armedParentId: "root-1",
    });
    expect(op).not.toEqual({ kind: "move-to-parent", parentId: "root-1" });
  });

  it("子任务被拖到已激活的另一根 A 落点 → move-to-parent A（跨父）", () => {
    expect(
      resolveTodoDragWithArm({
        activeContainerId: "parent:p1",
        overContainerId: "parent:root-A",
        overId: "parent-zone:root-A",
        activeId: "child-a",
        activeParentId: "p1",
        armedParentId: "root-A",
      }),
    ).toEqual({ kind: "move-to-parent", parentId: "root-A" });
  });
});

describe("containerIdForTask", () => {
  it("child 任务返回 parent:<id>", () => {
    expect(
      containerIdForTask({ parentId: "root-1", scheduledAt: null }, "2026-06-19"),
    ).toBe("parent:root-1");
  });

  it("无 scheduledAt 的 root → pool:inbox", () => {
    expect(containerIdForTask({ parentId: null, scheduledAt: null }, "2026-06-19")).toBe("pool:inbox");
  });

  it("scheduledAt 是今天 → pool:today", () => {
    expect(
      containerIdForTask({ parentId: null, scheduledAt: "2026-06-19T00:00:00.000Z" }, "2026-06-19"),
    ).toBe("pool:today");
  });

  it("scheduledAt 是别的日期 → 空字符串（upcoming 不参与拖拽）", () => {
    expect(
      containerIdForTask({ parentId: null, scheduledAt: "2026-07-01T00:00:00.000Z" }, "2026-06-19"),
    ).toBe("");
  });
});

describe("restrictToVerticalAxis", () => {
  it("把横向位移归零（向右拉不再顶出横向滚动条）", () => {
    expect(applyModifier(restrictToVerticalAxis, { x: 120, y: 40, scaleX: 1, scaleY: 1 })).toEqual({
      x: 0,
      y: 40,
      scaleX: 1,
      scaleY: 1,
    });
  });

  it("保留纵向位移与缩放（纵向重排照常）", () => {
    expect(applyModifier(restrictToVerticalAxis, { x: -80, y: -12, scaleX: 1, scaleY: 1.5 })).toEqual({
      x: 0,
      y: -12,
      scaleX: 1,
      scaleY: 1.5,
    });
  });
});