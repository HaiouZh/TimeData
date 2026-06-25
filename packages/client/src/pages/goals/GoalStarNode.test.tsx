// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { GoalStarNode } from "./GoalStarNode.js";

describe("GoalStarNode", () => {
  it("shows the title, progress ratio, and member count", async () => {
    const { host, root } = await renderDom(
      <GoalStarNode
        data={{
          star: {
            nodeId: "goal:g1",
            goalId: "g1",
            title: "优化体验",
            completed: 2,
            total: 4,
            memberCount: 4,
            lod: "collapsed",
          },
        }}
      />,
    );

    expect(host.textContent).toContain("优化体验");
    expect(host.textContent).toContain("50%");
    expect(host.textContent).toContain("4 项");
    expect(host.querySelector('[data-progress="50"]')).toBeTruthy();
    await unmount(root);
  });
});
