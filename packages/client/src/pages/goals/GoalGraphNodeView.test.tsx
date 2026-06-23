// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { GoalGraphNodeView } from "./GoalGraphNodeView.js";
import type { GoalGraphNode } from "../../lib/goalGraphModel.js";
import type { GoalGraphLod } from "../../lib/goalGraphLod.js";

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
  actions?: ReactNode;
}) {
  return renderDom(
    <GoalGraphNodeView
      node={options.node ?? node()}
      selected={options.selected ?? false}
      lod={options.lod ?? "near"}
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

    expect(far.host.textContent).not.toContain("完成第一版交互原型");
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
});
