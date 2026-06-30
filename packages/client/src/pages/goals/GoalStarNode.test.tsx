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
    const ring = host.querySelector('[data-goal-star-progress-ring="true"]');
    expect(ring?.getAttribute("aria-hidden")).toBe("true");
    expect((ring as HTMLElement | null)?.style.background).toContain("conic-gradient");
    const shellClass = host.querySelector('[data-goal-star-shell="true"]')?.className;
    expect(shellClass).toContain("rounded-pill");
    expect(shellClass).toContain("h-20");
    expect(shellClass).toContain("w-20");
    expect(shellClass).not.toContain("rounded-card");
    await unmount(root);
  });

  it("keeps expanded star labels readable around the orbital core", async () => {
    const { host, root } = await renderDom(
      <GoalStarNode
        data={{
          star: {
            nodeId: "goal:g1",
            goalId: "g1",
            title: "长期项目",
            completed: 1,
            total: 5,
            memberCount: 5,
            lod: "expanded",
          },
        }}
      />,
    );

    expect(host.querySelector('[data-star-title="true"]')?.textContent).toContain("长期项目");
    expect(host.querySelector('[data-star-member-count="true"]')?.textContent).toContain("5 项");
    expect(host.textContent).toContain("20%");
    expect(host.querySelector('[data-progress="20"]')).toBeTruthy();
    expect(host.querySelector('[role="group"]')?.getAttribute("aria-label")).toContain("进度：20%");
    const shellClass = host.querySelector('[data-goal-star-shell="true"]')?.className;
    expect(shellClass).toContain("rounded-pill");
    expect(shellClass).toContain("h-36");
    expect(shellClass).toContain("w-36");
    expect(shellClass).not.toContain("rounded-card");
    await unmount(root);
  });
});
