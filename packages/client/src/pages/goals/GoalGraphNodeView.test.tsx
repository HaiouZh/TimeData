// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { GoalGraphLod } from "../../lib/goalGraphLod.js";
import type { GoalGraphNode } from "../../lib/goalGraphModel.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { GoalGraphNodeView } from "./GoalGraphNodeView.js";

function node(overrides: Partial<GoalGraphNode> = {}): GoalGraphNode {
  return {
    id: "task:t1",
    kind: "task",
    status: "ready",
    title: "完成第一版交互原型",
    ref: { kind: "task", id: "t1" },
    hasDependency: false,
    ...overrides,
  };
}

async function renderNode(options: {
  node?: GoalGraphNode;
  selected?: boolean;
  lod?: GoalGraphLod;
  pinned?: boolean;
  actions?: ReactNode;
}) {
  return renderDom(
    <GoalGraphNodeView
      node={options.node ?? node()}
      selected={options.selected ?? false}
      lod={options.lod ?? "near"}
      pinned={options.pinned}
      actions={options.actions}
    />,
  );
}

describe("GoalGraphNodeView", () => {
  it("near 显示短标题，far 隐藏标题但 aria-label 保留完整标题和状态", async () => {
    const near = await renderNode({ node: node({ title: "完成第一版交互原型并邀请自己复盘" }), lod: "near" });

    expect(near.host.textContent).toContain("完成第一版交互原型");
    expect(near.host.querySelector("[aria-label]")?.getAttribute("aria-label")).toContain(
      "完成第一版交互原型并邀请自己复盘",
    );
    expect(near.host.querySelector("[aria-label]")?.getAttribute("aria-label")).toContain("就绪");
    await unmount(near.root);

    const far = await renderNode({ node: node({ title: "完成第一版交互原型并邀请自己复盘" }), lod: "far" });

    expect(far.host.querySelector("[data-goal-graph-node-shape]")?.textContent).not.toContain("完成第一版交互原型");
    expect(far.host.querySelector("[data-goal-graph-node-label]")).toBeNull();
    expect(far.host.querySelector("[aria-label]")?.getAttribute("aria-label")).toContain(
      "完成第一版交互原型并邀请自己复盘",
    );
    expect(far.host.querySelector("[aria-label]")?.getAttribute("aria-label")).toContain("就绪");
    await unmount(far.root);
  });

  it("输出节点类型、状态和选中态 data attribute", async () => {
    const { host, root } = await renderNode({ node: node({ kind: "track", status: "active" }), selected: true });
    const el = host.firstElementChild;

    expect(el?.getAttribute("data-node-kind")).toBe("track");
    expect(el?.getAttribute("data-node-status")).toBe("active");
    expect(el?.getAttribute("data-selected")).toBe("true");
    await unmount(root);
  });

  it("blocked、completed、parked、ghost 提供非颜色第二线索", async () => {
    const cases: Array<[GoalGraphNode["kind"], GoalGraphNode["status"], string]> = [
      ["task", "blocked", "受阻"],
      ["task", "completed", "已完成"],
      ["track", "parked", "停放"],
      ["ghost", "ghost", "缺失引用"],
    ];

    for (const [kind, status, clue] of cases) {
      const { host, root } = await renderNode({ node: node({ kind, status, title: `${clue}节点` }) });

      expect(host.textContent).toContain(clue);
      await unmount(root);
    }
  });

  it("near 和 far 都渲染 actions 插槽", async () => {
    const near = await renderNode({ lod: "near", actions: <button type="button">操作</button> });
    expect(near.host.querySelector("button")?.textContent).toBe("操作");
    await unmount(near.root);

    const far = await renderNode({ lod: "far", actions: <button type="button">操作</button> });
    expect(far.host.querySelector("button")?.textContent).toBe("操作");
    await unmount(far.root);
  });

  it("shows a pin badge for pinned nodes", async () => {
    const { host, root } = await renderNode({ pinned: true });

    expect(host.querySelector('[aria-label="已固定位置"]')).toBeTruthy();
    await unmount(root);
  });

  it("renders goal anchors as star cores instead of card blocks", async () => {
    const { host, root } = await renderNode({
      node: node({ id: "goal", kind: "goal", status: "anchor", title: "星云视觉验收", ref: null }),
    });

    expect(host.querySelector('[data-node-kind="goal"]')).toBeTruthy();
    expect(host.querySelector('[data-goal-star-core="true"]')).toBeTruthy();
    const shellClass = host.querySelector('[data-goal-star-shell="true"]')?.className;
    expect(shellClass).toContain("rounded-pill");
    expect(shellClass).toContain("h-28");
    expect(shellClass).toContain("w-28");
    expect(shellClass).not.toContain("rounded-card");
    expect(host.textContent).toContain("星云视觉验收");
    expect(host.textContent).toContain("目标锚点");
    await unmount(root);
  });

  it("adds status glow to task and track shapes while keeping their distinct forms", async () => {
    const taskNode = await renderNode({ node: node({ kind: "task", status: "blocked" }) });
    const taskShape = taskNode.host.querySelector("[data-goal-graph-node-shape]");
    expect(taskShape?.getAttribute("data-status-glow")).toBe("blocked");
    expect(taskShape?.className).toContain("rounded-pill");
    expect(taskNode.host.textContent).toContain("受阻");
    await unmount(taskNode.root);

    const trackNode = await renderNode({
      node: node({ id: "track:r1", kind: "track", status: "active", ref: { kind: "track", id: "r1" } }),
    });
    const trackShape = trackNode.host.querySelector("[data-goal-graph-node-shape]");
    expect(trackShape?.getAttribute("data-status-glow")).toBe("active");
    expect(trackShape?.className).toContain("rounded-pill");
    expect(trackShape?.className).toContain("min-w-36");
    expect(trackNode.host.textContent).toContain("进行中");
    await unmount(trackNode.root);
  });

  it("uses an in-app hover tooltip and separates visual shape from task label", async () => {
    const fullTitle = "一个很长很长的任务标题用于悬停查看完整内容";
    const { host, root } = await renderNode({ node: node({ title: fullTitle }) });
    const rootEl = host.firstElementChild;

    expect(rootEl?.getAttribute("title")).toBeNull();
    expect(rootEl?.getAttribute("aria-describedby")).toBeTruthy();
    expect(host.querySelector("[data-goal-graph-node-shape]")).toBeTruthy();
    expect(host.querySelector("[data-goal-graph-node-label]")?.getAttribute("title")).toBeNull();
    expect(host.querySelector("[data-goal-graph-node-label]")?.className).toContain("absolute");
    expect(host.querySelector("[data-goal-graph-node-label]")?.className).toContain("left-full");
    expect(host.querySelector("[data-goal-graph-node-tooltip]")?.textContent).toContain(fullTitle);
    expect(host.querySelector("[data-goal-graph-node-tooltip]")?.className).toContain(
      "group-hover/goal-node:opacity-100",
    );
    expect(host.querySelector("[data-goal-graph-node-shape]")?.textContent).not.toContain(fullTitle.slice(0, 6));
    expect(host.textContent).toContain("一个很长很长的任务标题");
    await unmount(root);
  });
});
