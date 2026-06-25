// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { GoalGalaxyHud } from "./GoalGalaxyHud.js";

describe("GoalGalaxyHud", () => {
  it("shows global progress, weekly momentum, and active goal count", async () => {
    const { host, root } = await renderDom(
      <GoalGalaxyHud rollup={{ completed: 3, total: 6, ratio: 0.5, weekActiveMembers: 4, activeGoals: 2 }} />,
    );

    expect(host.textContent).toContain("50%");
    expect(host.textContent).toContain("4");
    expect(host.textContent).toContain("2");
    await unmount(root);
  });
});
