// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { GoalIndexPanel } from "./GoalIndexPanel.js";

describe("GoalIndexPanel", () => {
  it("lists goals and focuses one on click", async () => {
    const onFocus = vi.fn();
    const { host, root } = await renderDom(
      <GoalIndexPanel
        items={[
          { goalId: "g1", title: "健康", completed: 1, total: 2, weekActiveMembers: 1 },
          { goalId: "g2", title: "写作", completed: 0, total: 0, weekActiveMembers: 0 },
        ]}
        onFocus={onFocus}
      />,
    );

    expect(host.querySelector('[data-index-goal="g1"]')?.textContent).toContain("健康");
    expect(host.querySelector('[data-index-goal="g1"]')?.textContent).toContain("50%");
    await click(host.querySelector('[data-index-goal="g2"]'));

    expect(onFocus).toHaveBeenCalledWith("g2");
    await unmount(root);
  });
});
