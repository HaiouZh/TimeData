import { describe, expect, it } from "vitest";
import {
  containerIdForTask,
  parseTodoContainerId,
  resolveTodoDragOperation,
  type TodoContainer,
} from "./todoDnd.js";

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