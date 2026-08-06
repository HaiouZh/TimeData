import type { Collision, Modifier } from "@dnd-kit/core";
import type { Transform } from "@dnd-kit/utilities";
import { describe, expect, it } from "vitest";
import {
  clampTodoIndentPreview,
  containerIdForTask,
  hoveredRootIdFromOver,
  laneToIndentLevel,
  parseTodoContainerId,
  parseTodoDockId,
  preferProjectCollisions,
  resolveTodoDockDrop,
  projectContainerId,
  resolveIndentLevel,
  resolveTodoDragLane,
  resolveTodoDragLaneAtPointer,
  resetTodoDragRefs,
  type ResolveTodoDragLaneAtPointerInput,
  resolveTodoDragOperation,
  resolveTodoDragWithIndent,
  TODO_CHILD_INDENT_PX,
  TODO_INDENT_RELEASE_PX,
  type TodoContainer,
  type TodoDockRect,
  type TodoDragLane,
  type TodoIndentLevel,
  todoContainerId,
  todoDockId,
  todoDockTargets,
  todoProjectRowId,
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

describe("resolveTodoDragLane（三档车道）", () => {
  it("root 起手左拉未达 -28 保持 root", () => {
    expect(resolveTodoDragLane(-(TODO_CHILD_INDENT_PX - 1), "root")).toBe("root");
  });

  it("root 起手左拉达到 -28 进 dock", () => {
    expect(resolveTodoDragLane(-TODO_CHILD_INDENT_PX, "root")).toBe("dock");
  });

  it("dock 态回撤到 -12 以内才释放回 root（滞回）", () => {
    expect(resolveTodoDragLane(-(TODO_INDENT_RELEASE_PX + 1), "dock")).toBe("dock");
    expect(resolveTodoDragLane(-TODO_INDENT_RELEASE_PX, "dock")).toBe("root");
  });

  it("dock 态一帧横跳到右侧缩进阈值外直接换到 child 档", () => {
    expect(resolveTodoDragLane(TODO_CHILD_INDENT_PX + 2, "dock")).toBe("child");
  });

  it("右移与缩进判定与 resolveIndentLevel 逐值一致（root/child 两档不动）", () => {
    expect(resolveTodoDragLane(TODO_CHILD_INDENT_PX, "root")).toBe("child");
    expect(resolveTodoDragLane(TODO_INDENT_RELEASE_PX + 1, "child")).toBe("child");
    expect(resolveTodoDragLane(TODO_INDENT_RELEASE_PX, "child")).toBe("root");
  });

  it("base=child：-28 只升根，绝不一步进 dock", () => {
    expect(resolveTodoDragLane(-TODO_CHILD_INDENT_PX, "child", "child")).toBe("root");
  });

  it("base=child：升根后继续左拉到 -56 才进 dock", () => {
    expect(resolveTodoDragLane(-(TODO_CHILD_INDENT_PX * 2 - 1), "root", "child")).toBe("root");
    expect(resolveTodoDragLane(-TODO_CHILD_INDENT_PX * 2, "root", "child")).toBe("dock");
  });

  it("base=child：dock 态回撤到 -40 释放回 root（升根点左移 12 的滞回）", () => {
    const release = -(TODO_CHILD_INDENT_PX + TODO_INDENT_RELEASE_PX); // -40
    expect(resolveTodoDragLane(release - 1, "dock", "child")).toBe("dock");
    expect(resolveTodoDragLane(release, "dock", "child")).toBe("root");
  });

  it("键盘拖拽恒基线档：大幅负位移也不进 dock、不换档", () => {
    expect(resolveTodoDragLane(-300, "root", "root", true)).toBe("root");
    expect(resolveTodoDragLane(-300, "child", "child", true)).toBe("child");
    expect(resolveTodoDragLane(300, "root", "root", true)).toBe("root");
  });

  it("dock 释放后落 root 档，不掉进 child（释放线右侧的中间带）", () => {
    // 终审实测：把 fall-through 的 resolveIndentLevel(deltaX, "root", base) 写成
    // (deltaX, "child", base) 或 (deltaX, base, base)，只探释放阈值那一个点的用例全绿。
    // 拖根任务出坞后右甩到 +20（未到 +28 缩进线）应回 root；变异下会进 child 档，
    // 缩进高亮亮起、松手静默收纳成子任务（真写库）。
    expect(resolveTodoDragLane(20, "dock")).toBe("root");
    // 拖子任务出坞后回撤到 -20（已过 -40 释放线）应停在 root（已升根，滞回保持）。
    expect(resolveTodoDragLane(-20, "dock", "child")).toBe("root");
  });

  it("base=child：单帧大位移可一步从 child 直达 dock（快速左甩不卡档）", () => {
    expect(resolveTodoDragLane(-TODO_CHILD_INDENT_PX * 2, "child", "child")).toBe("dock");
  });

  it("base=child：dock 态右甩越过缩进阈值直接落 child 档", () => {
    expect(resolveTodoDragLane(TODO_CHILD_INDENT_PX, "dock", "child")).toBe("child");
  });

  it("holdDock 短路释放：同一位移，指针在坞矩形内就保持 dock、不在就释放", () => {
    // 释放线是相对起手点的位移，坞却画在绝对位置；起手点贴近栏左缘时，指针一进坞就已满足
    // 释放条件——坞会在够到药丸前自己关掉。holdDock 是把"坞开着时指针在坞内永不释放"补成硬保证。
    expect(resolveTodoDragLane(-5, "dock", "root", false, true)).toBe("dock");
    expect(resolveTodoDragLane(-5, "dock", "root", false, false)).toBe("root");
  });

  it("holdDock 不制造 dock：未进坞档时它一律不改判定", () => {
    // 只短路释放、不短路进档——否则指针恰好扫过坞矩形就会凭空开坞。
    expect(resolveTodoDragLane(-5, "root", "root", false, true)).toBe("root");
    expect(resolveTodoDragLane(TODO_CHILD_INDENT_PX, "root", "root", false, true)).toBe("child");
  });

  it("键盘守卫压过 holdDock：键盘拖拽恒基线档", () => {
    expect(resolveTodoDragLane(-300, "dock", "root", true, true)).toBe("root");
  });
});

describe("laneToIndentLevel（车道 → 缩进语义）", () => {
  it("dock 档按 root 解析——左拉出坞绝不是收纳", () => {
    // 终审实测：页面里这行三元被合并成 `lane !== "root" ? "child" : "root"`，197 条测试全绿，
    // 而真机上左拉出坞后松手落在某行会静默收纳落库。提成纯函数才锁得住。
    expect(laneToIndentLevel("dock")).toBe("root");
    expect(laneToIndentLevel("root")).toBe("root");
    expect(laneToIndentLevel("child")).toBe("child");
  });
});

describe("resolveTodoDragLaneAtPointer（按指针真实坐标解车道）", () => {
  const START = { x: 300, y: 400 };
  // 坞:横向 [100,276]（左缘锚区块、宽 w-44=176）,纵向 [300,500]（垂直居中、高随药丸数）。
  const DOCK: TodoDockRect = { left: 100, right: 276, top: 300, bottom: 500 };
  const input = (
    over: Partial<ResolveTodoDragLaneAtPointerInput>,
  ): ResolveTodoDragLaneAtPointerInput => ({
    pointer: START,
    startPoint: START,
    dockRect: DOCK,
    dockAnchored: true,
    previous: "root",
    base: "root",
    keyboard: false,
    ...over,
  });

  it("根任务左拉过阈值进 dock", () => {
    expect(resolveTodoDragLaneAtPointer(input({ pointer: { x: START.x - 200, y: START.y } }))).toBe("dock");
  });

  it("子任务左拉两段：-28 只升根，-56 才出坞", () => {
    const at = (dx: number, previous: TodoDragLane) =>
      resolveTodoDragLaneAtPointer(
        input({ pointer: { x: START.x + dx, y: START.y }, base: "child", previous }),
      );
    expect(at(-TODO_CHILD_INDENT_PX, "child")).toBe("root");
    expect(at(-TODO_CHILD_INDENT_PX * 2, "root")).toBe("dock");
  });

  it("holdDock 两轴都判：同一位移，指针在坞矩形内保持 dock、只是横向带内则释放", () => {
    // 位移 -10 已过释放线(-12)：坞开着时靠 holdDock 才留得住。
    // 坞垂直居中且只有药丸那么高,只判 x 会让整条纵向带都算"在坞上"——起手点几乎总在坞的横向带内
    //(拖柄贴着区块左缘),那样一旦进档就再也释放不掉,右移回去坞也不关。
    const at = (y: number) =>
      resolveTodoDragLaneAtPointer(input({ pointer: { x: START.x - 10, y }, previous: "dock" }));
    expect(at(START.y)).toBe("dock"); // y 落在坞纵向范围内
    expect(at(100)).toBe("root"); // x 同在带内、y 在坞上方 → 不该 hold
  });

  it("量不到锚点（坞退视口右缘）时不进 dock 档", () => {
    // 坞落右缘而出坞手势向左,方向互斥、指针结构性够不到药丸——与其开在够不着的地方,不如不开。
    expect(
      resolveTodoDragLaneAtPointer(input({ pointer: { x: START.x - 200, y: START.y }, dockAnchored: false })),
    ).toBe("root");
  });

  it("键盘拖拽恒基线档，不吃指针坐标", () => {
    expect(
      resolveTodoDragLaneAtPointer(
        input({ pointer: { x: START.x - 200, y: START.y }, previous: "dock", keyboard: true }),
      ),
    ).toBe("root");
  });

  it("坐标缺失（首帧未动 / 异常路径）保持原档，不乱跳", () => {
    expect(resolveTodoDragLaneAtPointer(input({ pointer: null, previous: "child" }))).toBe("child");
    expect(resolveTodoDragLaneAtPointer(input({ startPoint: null, previous: "dock" }))).toBe("dock");
  });

  it("防回潮：dnd-kit 的 event.delta 接回车道判定就会坏，那条路已废", () => {
    // 2026-08-03 真机验收退回的根因。dnd-kit 6.3.1 的 onDragMove 里 delta 不是原始手势位移:
    //   core.esm.js:2959 modifiedTranslate = applyModifiers(modifiers, { transform: 原始 translate })
    //   core.esm.js:2983 scrollAdjustedTranslate = add(modifiedTranslate, scrollAdjustment)
    //   core.esm.js:3229 onDragMove 的 event.delta = scrollAdjustedTranslate
    // 页面当时喂给车道判定的就是它,而 clampTodoIndentPreview 把根任务的 x 夹进 [0,28]、子任务夹进
    // [-28,0]——出坞阈值(-28/-56)落在钳制值域之外,dock 档结构性不可达,坞左拉多远都只停在细条态。
    // 两侧各自的单元测试都不会红:纯函数层直接喂 -28 当然进 dock,modifier 层只断言自己钳得对。
    // 缩进档当时没跟着坏是边界巧合:钳制上限与缩进阈值同为 TODO_CHILD_INDENT_PX。
    const clampedX = (containerId: string) =>
      clampTodoIndentPreview({
        transform: { x: -200, y: 0, scaleX: 1, scaleY: 1 },
        active: { data: { current: { containerId } } },
      } as Parameters<Modifier>[0]).x;
    expect(resolveTodoDragLane(clampedX("pool:today"), "root", "root")).not.toBe("dock");
    expect(resolveTodoDragLane(clampedX("parent:root-1"), "child", "child")).not.toBe("dock");
    // 同一个手势走真实坐标就判得出来。
    expect(resolveTodoDragLaneAtPointer(input({ pointer: { x: START.x - 200, y: START.y } }))).toBe("dock");
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

  it.each(["", null, undefined, "parent:", "pool:upcoming", "pool:completed", "random", "hand:", "hand:anything"])(
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

  it("项目容器：同组来源才认，跨组返回 null", () => {
    expect(hoveredRootIdFromOver("project:g1", "member-b", "project:g1")).toBe("member-b");
    // 只比 kind 不比 goalId 的写法在这一条上原样通过——必须比 goalId
    expect(hoveredRootIdFromOver("project:g1", "member-b", "project:g2")).toBeNull();
  });

  it("项目容器：外区来源不认（收纳只在组内成立）", () => {
    expect(hoveredRootIdFromOver("project:g1", "member-b", "pool:inbox")).toBeNull();
    expect(hoveredRootIdFromOver("project:g1", "member-b", "hand")).toBeNull();
    expect(hoveredRootIdFromOver("project:g1", "member-b")).toBeNull();
  });

  it("组卡片本身不是根行：overTaskId 为空时返回 null", () => {
    // 组卡片自己就是 droppable，指针落在卡片空白处时它的 data 里没有 taskId。
    // 不早退的话会把 "project:g1" 这个容器 id 当成根行 id 返回，下游拼出 parent:project:g1。
    expect(hoveredRootIdFromOver("project:g1", "", "project:g1")).toBeNull();
    expect(hoveredRootIdFromOver("pool:today", "", "pool:today")).toBeNull();
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
        activeParentProjectGoalId: null, // 父不属于任何 active project → 仍是跨区复合动作，仍拒绝
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

  it("hoveredRootIdFromOver 对项目容器恒返回 null（项目区无可作缩进父的根行）", () => {
    expect(hoveredRootIdFromOver("project:g1", "g1")).toBeNull();
  });

  it("项目区的行 → 同组某行的 parent 容器 = 组内收纳", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "project:g1",
        targetContainerId: "parent:member-a",
        activeParentId: null,
      }),
    ).toEqual({ kind: "move-to-parent", parentId: "member-a" });
  });

  // 这条同时是「新分支没被哨兵短路」的定向闸：把 `if (active.kind === "project") return null`
  // 挪回两条 project 分支之前，本例立刻红。没有它，那次挪动零成本（行为没变、整套测试照绿），
  // 真机上只表现为「项目区的行拖了没反应」。
  it("组内收纳分支必须排在 project 哨兵之前", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "project:g1",
        targetContainerId: "parent:member-a",
        activeParentId: null,
      }),
    ).not.toBeNull();
  });

  it("组内子任务 → 本组 = 升根回组", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "parent:member-a",
        targetContainerId: "project:g1",
        activeParentId: "member-a",
        activeParentProjectGoalId: "g1",
      }),
    ).toEqual({ kind: "promote-to-project", goalId: "g1" });
  });

  it("子任务的父属于**别的**组 → null：跨组不做升根入组", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "parent:member-a",
        targetContainerId: "project:g2",
        activeParentId: "member-a",
        activeParentProjectGoalId: "g1",
      }),
    ).toBeNull();
  });

  it("项目容器作 active 的其余组合仍 null（哨兵还在挡）", () => {
    expect(
      resolveTodoDragOperation({
        activeContainerId: "project:g1",
        targetContainerId: "pool:today",
        activeParentId: null,
      }),
    ).toBeNull();
    expect(
      resolveTodoDragOperation({
        activeContainerId: "project:g1",
        targetContainerId: "project:g2",
        activeParentId: null,
      }),
    ).toBeNull();
    expect(
      resolveTodoDragOperation({
        activeContainerId: "project:g1",
        targetContainerId: "hand",
        activeParentId: null,
      }),
    ).toBeNull();
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

  it("同组内可缩进成 child", () => {
    expect(
      resolveTodoDragWithIndent({
        activeContainerId: "project:g1",
        activeParentId: null,
        activeId: "member-a",
        activeHasChildren: false,
        indentLevel: "child",
        rootAboveId: "member-b",
        targetContainer: { kind: "project", goalId: "g1" },
      }),
    ).toEqual({ kind: "move-to-parent", parentId: "member-b" });
  });

  it("跨组不可缩进成 child：第二道保险独立成立，不靠上游过滤", () => {
    expect(
      resolveTodoDragWithIndent({
        activeContainerId: "project:g1",
        activeParentId: null,
        activeId: "member-a",
        activeHasChildren: false,
        indentLevel: "child",
        // 上游被绕过、rootAboveId 被错传进来时，这一层仍不许把它变成拆/接父子关系
        rootAboveId: "other-member",
        targetContainer: { kind: "project", goalId: "g2" },
      }),
    ).toBeNull();
  });
});

describe("preferProjectCollisions", () => {
  const hit = (id: string) => ({ id }) as never;

  it("指针落在项目组内 → 只保留项目组，不让 closestCenter 的近邻抢走", () => {
    const result = preferProjectCollisions({
      pointerHits: [hit("project:g1"), hit("t9")],
      fallback: () => [hit("t9")],
      dockAllowed: true,
    });
    expect(result.map((c) => c.id)).toEqual(["project:g1"]);
  });

  it("指针没落在任何项目组 → 原样退回 closestCenter 的结果（既有行为一字不变）", () => {
    const fallback = [hit("t9"), hit("t8")];
    expect(preferProjectCollisions({ pointerHits: [hit("t9")], fallback: () => fallback, dockAllowed: true })).toBe(
      fallback,
    );
  });

  it("指针命中为空（如键盘拖拽）→ 退回 closestCenter", () => {
    const fallback = [hit("t9")];
    expect(preferProjectCollisions({ pointerHits: [], fallback: () => fallback, dockAllowed: true })).toBe(fallback);
  });

  it("同时命中多个项目组时全部保留，交给 dnd-kit 定序", () => {
    const result = preferProjectCollisions({
      pointerHits: [hit("project:g1"), hit("project:g2")],
      fallback: () => [],
      dockAllowed: true,
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
      dockAllowed: true,
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
        dockAllowed: true,
      }),
    ).toBe(fallback);
  });

  it("数字型 UniqueIdentifier 不炸（dnd-kit 的 id 是 string | number）", () => {
    const fallback = [hit("t9")];
    expect(
      preferProjectCollisions({ pointerHits: [{ id: 42 } as never], fallback: () => fallback, dockAllowed: true }),
    ).toBe(fallback);
  });

  it("dockAllowed 决定同一份 pointer 命中是投坞还是让给下面的行", () => {
    // 非 dock 档坞不接投递的机制保证落在这一层（此前挂在药丸的 droppable disabled 上，
    // 那是 state 驱动、比车道慢两跳提交）。同一份输入只改 dockAllowed：
    // true → 只认坞；false → 坞被剔除，落点按既有契约退回 closestCenter（下面那行）。
    const args = { pointerHits: [hit("dock:hand"), hit("t1")], fallback: () => [hit("t1")] };
    expect(preferProjectCollisions({ ...args, dockAllowed: true }).map((c) => c.id)).toEqual(["dock:hand"]);
    expect(preferProjectCollisions({ ...args, dockAllowed: false }).map((c) => c.id)).toEqual(["t1"]);
  });

  it("dockAllowed=false:fallback（closestCenter）里的 dock 药丸同样被剔除", () => {
    // 只滤 pointerHits 不够：closestCenter 把坞药丸的矩形也算进去，兜底路会把坞重新放回来。
    const result = preferProjectCollisions({
      pointerHits: [],
      fallback: () => [hit("dock:pool:today"), hit("t1")],
      dockAllowed: false,
    });
    expect(result.map((c) => c.id)).toEqual(["t1"]);
  });

  it("dockAllowed=false:项目组仍照常优先（只剔坞，不动项目判定）", () => {
    const result = preferProjectCollisions({
      pointerHits: [hit("dock:hand"), hit("project:g1"), hit("t1")],
      fallback: () => [],
      dockAllowed: false,
    });
    expect(result.map((c) => c.id)).toEqual(["project:g1"]);
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

  it("根任务 → dock:hand = grab-to-hand", () => {
    expect(
      resolveTodoDockDrop({ dockId: "dock:hand", activeContainerId: "pool:inbox", activeParentId: null }),
    ).toEqual({ kind: "grab-to-hand" });
  });

  it("子任务 → dock:hand = promote-to-hand（升根并站到手头）", () => {
    expect(
      resolveTodoDockDrop({ dockId: "dock:hand", activeContainerId: "parent:p1", activeParentId: "p1" }),
    ).toEqual({ kind: "op", op: { kind: "promote-to-hand" } });
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

  it("拖子任务(parent:):今天/收件箱都在(升根语义),手头也在(投上去升根到手头)", () => {
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

  it("preferProjectCollisions:dock 档下 pointer 同时命中 dock 与行/项目时只认 dock", () => {
    const hit = (id: string) => ({ id }) as never;
    const result = preferProjectCollisions({
      pointerHits: [hit("t1"), hit("dock:project:g1"), hit("project:g2")],
      fallback: () => [],
      dockAllowed: true,
    });
    expect((result as { id: string }[]).map((c) => c.id)).toEqual(["dock:project:g1"]);
    // 无 dock 命中时行为一字不变
    const noDock = preferProjectCollisions({
      pointerHits: [hit("t1"), hit("project:g2")],
      fallback: () => [],
      dockAllowed: true,
    });
    expect((noDock as { id: string }[]).map((c) => c.id)).toEqual(["project:g2"]);
  });
});

describe("hand 容器（手头区拖拽排序）", () => {
  it("parseTodoContainerId 认 hand", () => {
    expect(parseTodoContainerId("hand")).toEqual({ kind: "hand" });
  });

  it("todoContainerId(hand) 与解析互为逆", () => {
    const id = todoContainerId({ kind: "hand" });
    expect(id).toBe("hand");
    expect(todoContainerId(parseTodoContainerId(id) as TodoContainer)).toBe(id);
  });

  it("active 与 target 同一 hand 容器 → reorder", () => {
    expect(
      resolveTodoDragOperation({ activeContainerId: "hand", targetContainerId: "hand", activeParentId: null }),
    ).toEqual({ kind: "reorder", containerId: "hand" });
  });

  it("手头行拖到池容器 → null（不开放拖出手头）", () => {
    expect(
      resolveTodoDragOperation({ activeContainerId: "hand", targetContainerId: "pool:today", activeParentId: null }),
    ).toBeNull();
    expect(
      resolveTodoDragOperation({ activeContainerId: "hand", targetContainerId: "pool:inbox", activeParentId: null }),
    ).toBeNull();
  });

  it("手头行拖到项目组 → null（不开放拖出手头）", () => {
    expect(
      resolveTodoDragOperation({ activeContainerId: "hand", targetContainerId: "project:g1", activeParentId: null }),
    ).toBeNull();
  });

  it("手头行拖到 parent 容器 → move-to-parent（区内收纳）", () => {
    expect(
      resolveTodoDragOperation({ activeContainerId: "hand", targetContainerId: "parent:r1", activeParentId: null }),
    ).toEqual({ kind: "move-to-parent", parentId: "r1" });
  });

  it("手头行带 child 缩进手势 → move-to-parent（收纳到悬停的根行底下）", () => {
    // 原用例锁的是「手头行恒不缩进」，批 1 已推翻该行为；现在锁的是缩进手势真的落成收纳。
    expect(
      resolveTodoDragWithIndent({
        activeContainerId: "hand",
        activeParentId: null,
        activeId: "h1",
        activeHasChildren: false,
        indentLevel: "child",
        rootAboveId: "t1",
        targetContainer: { kind: "pool", pool: "today" },
      }),
    ).toEqual({ kind: "move-to-parent", parentId: "t1" });
  });

  it("子任务拖到 hand 容器 → promote-to-hand（升根并站到手头）", () => {
    expect(
      resolveTodoDragOperation({ activeContainerId: "parent:p1", targetContainerId: "hand", activeParentId: "p1" }),
    ).toEqual({ kind: "promote-to-hand" });
  });

  it("hoveredRootIdFromOver 对 hand 容器只认手头区来源", () => {
    // 手头区内：手头行可作收纳父
    expect(hoveredRootIdFromOver("hand", "t1", "hand")).toBe("t1");
    // 外区来源：不作收纳父——收纳只在手头区内成立，跨区拖不亮高亮也不落库
    expect(hoveredRootIdFromOver("hand", "t1", "pool:inbox")).toBeNull();
    expect(hoveredRootIdFromOver("hand", "t1", "pool:today")).toBeNull();
    // 来源缺失时保守拒绝
    expect(hoveredRootIdFromOver("hand", "t1")).toBeNull();
  });

  it("todoDockTargets 对 hand 源返回空数组（坞不显示）", () => {
    expect(todoDockTargets("hand", [{ goalId: "g1" }])).toEqual([]);
  });

  it("todoDockTargets 对子任务源包含手头药丸", () => {
    expect(todoDockTargets("parent:p1", [])).toContainEqual({ kind: "hand" });
  });

  it("todoDockTargets 第三参 activeParentInHand=true 时,子任务源坞不出任何药丸(父在手头,与父行一致)", () => {
    expect(todoDockTargets("parent:p1", [{ goalId: "g1" }], true)).toEqual([]);
  });

  it("todoDockTargets 不传第三参(默认 false)时,子任务源坞行为不变(收件箱子任务坞不受影响)", () => {
    expect(todoDockTargets("parent:p1", [])).toEqual([
      { kind: "pool", pool: "today" },
      { kind: "hand" },
      { kind: "pool", pool: "inbox" },
    ]);
    expect(todoDockTargets("parent:p1", [], false)).toEqual(todoDockTargets("parent:p1", []));
  });

  it("todoDockTargets 第三参对非子任务源无影响(池/手头源本就各自恒定)", () => {
    expect(todoDockTargets("pool:inbox", [], true)).toEqual(todoDockTargets("pool:inbox", []));
    expect(todoDockTargets("hand", [{ goalId: "g1" }], true)).toEqual([]);
  });

  it("resolveTodoDockDrop 对 hand 源 → invalid（防御层：坞隐藏规则漏了也不能放怪异操作过去）", () => {
    expect(
      resolveTodoDockDrop({ dockId: "dock:pool:today", activeContainerId: "hand", activeParentId: null }),
    ).toEqual({ kind: "invalid", target: { kind: "pool", pool: "today" } });
    expect(
      resolveTodoDockDrop({ dockId: "dock:hand", activeContainerId: "hand", activeParentId: null }),
    ).toEqual({ kind: "invalid", target: { kind: "hand" } });
    // dock:project 药丸同拦（坞全部药丸对 hand 源都无效，不只是池药丸）。
    expect(
      resolveTodoDockDrop({ dockId: "dock:project:g1", activeContainerId: "hand", activeParentId: null }),
    ).toEqual({ kind: "invalid", target: { kind: "project", goalId: "g1" } });
  });

  it("clampTodoIndentPreview 对 hand 容器按 root 基线夹 [0, 28]", () => {
    const handActive = { data: { current: { containerId: "hand" } } };
    const result = clampTodoIndentPreview({
      transform: { x: 40, y: 5, scaleX: 1, scaleY: 1 },
      active: handActive,
    } as Parameters<Modifier>[0]);
    expect(result.x).toBe(TODO_CHILD_INDENT_PX);

    const leftward = clampTodoIndentPreview({
      transform: { x: -40, y: 5, scaleX: 1, scaleY: 1 },
      active: handActive,
    } as Parameters<Modifier>[0]);
    expect(leftward.x).toBe(0);
  });
});

describe("resetTodoDragRefs（拖拽状态 ref 组复位单点）", () => {
  function dirtyRefs() {
    return {
      lane: { current: "dock" as TodoDragLane },
      indentBase: { current: "child" as TodoIndentLevel },
      keyboard: { current: true },
      dragStartPoint: { current: { x: 12, y: 34 } },
      pointerPos: { current: { x: 56, y: 78 } },
      activeProjectGoalId: { current: "g1" },
    };
  }

  it("六个 ref 全部回到初始值（lane/indentBase=root,其余 null/false）", () => {
    const refs = dirtyRefs();
    resetTodoDragRefs(refs);
    expect(refs.lane.current).toBe("root");
    expect(refs.indentBase.current).toBe("root");
    expect(refs.keyboard.current).toBe(false);
    expect(refs.dragStartPoint.current).toBeNull();
    expect(refs.pointerPos.current).toBeNull();
    expect(refs.activeProjectGoalId.current).toBeNull();
  });

  it("初始值上再调一次也稳定（幂等）", () => {
    const refs = dirtyRefs();
    resetTodoDragRefs(refs);
    resetTodoDragRefs(refs);
    expect(refs.lane.current).toBe("root");
    expect(refs.pointerPos.current).toBeNull();
    expect(refs.activeProjectGoalId.current).toBeNull();
  });
});

describe("项目区行 id 域", () => {
  it("前缀不与 project: 容器域相撞", () => {
    const id = todoProjectRowId("g1", "t1");
    expect(id).toBe("project-row:g1:t1");
    // 关键：若写成 `project:g1:t1`，下面这句会解析出 goalId="g1:t1" 的假容器
    expect(parseTodoContainerId(id)).toBeNull();
    expect(id.startsWith("project:")).toBe(false);
  });
});

describe("preferProjectCollisions · 项目区来源", () => {
  // 本文件既有的 preferProjectCollisions 用例已有同款碰撞构造 helper——复用它，别并排再造一个。
  const hit = (id: string) => ({ id }) as unknown as Collision;

  it("来源是本组时同组行优先于组卡片", () => {
    const result = preferProjectCollisions({
      pointerHits: [hit("project:g1"), hit("project-row:g1:t2")],
      fallback: () => [],
      dockAllowed: false,
      activeProjectGoalId: "g1",
    });
    expect(result.map((c) => String(c.id))).toEqual(["project-row:g1:t2"]);
  });

  it("隔壁组的行不进优先档（跨组不认的第二处落点）", () => {
    const result = preferProjectCollisions({
      pointerHits: [hit("project:g2"), hit("project-row:g2:t9")],
      fallback: () => [],
      dockAllowed: false,
      activeProjectGoalId: "g1",
    });
    expect(result.map((c) => String(c.id))).toEqual(["project:g2"]);
  });

  it("组内没命中行时仍认本组卡片（子任务往左拖落在卡片空白处）", () => {
    const result = preferProjectCollisions({
      pointerHits: [hit("project:g1")],
      fallback: () => [],
      dockAllowed: false,
      activeProjectGoalId: "g1",
    });
    expect(result.map((c) => String(c.id))).toEqual(["project:g1"]);
  });

  it("外区来源行为一字不变：卡片优先，行不参与", () => {
    const result = preferProjectCollisions({
      pointerHits: [hit("project:g1"), hit("project-row:g1:t2")],
      fallback: () => [],
      dockAllowed: false,
    });
    expect(result.map((c) => String(c.id))).toEqual(["project:g1"]);
  });
});

describe("投递坞对项目区整区关闭", () => {
  it("项目区源不出任何药丸", () => {
    expect(todoDockTargets("project:g1", [{ goalId: "g1" }, { goalId: "g2" }])).toEqual([]);
  });

  it("父在项目组的子任务同样不出坞", () => {
    expect(todoDockTargets("parent:member-a", [{ goalId: "g1" }], true)).toEqual([]);
  });

  it("父不在任何不出坞区的子任务，坞照常", () => {
    expect(todoDockTargets("parent:p1", [{ goalId: "g1" }]).length).toBeGreaterThan(0);
  });

  it("项目区源投坞一律 invalid（隐藏规则漏了时的兜底）", () => {
    expect(
      resolveTodoDockDrop({ dockId: "dock:pool:today", activeContainerId: "project:g1", activeParentId: null }),
    ).toEqual({ kind: "invalid", target: { kind: "pool", pool: "today" } });
  });
});
