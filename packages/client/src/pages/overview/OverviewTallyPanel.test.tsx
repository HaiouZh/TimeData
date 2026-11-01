// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { OverviewTally } from "../../lib/overview/overviewModel.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { OverviewTallyPanel } from "./OverviewTallyPanel.js";

const tally: OverviewTally = {
  totalStars: 10,
  litStars: 7,
  darkStars: 3,
  starsByKind: { input: 4, done: 3, progress: 2, recurring: 1 },
  exclusions: {
    occurrence: 5,
    child: 6,
    "rule-exhausted": 1,
    "done-old": 12,
    "track-concluded": 2,
    "track-parked": 3,
  },
  danglingMemberRefs: 2,
  archivedGoals: 1,
};

function toggle(host: HTMLElement): HTMLButtonElement {
  const element = [...host.querySelectorAll("button")].find((button) => button.textContent === "怎么算的");
  if (!(element instanceof HTMLButtonElement)) throw new Error("missing toggle");
  return element;
}

function itemTexts(host: HTMLElement): string[] {
  return [...host.querySelectorAll("li")].map((item) => item.textContent ?? "");
}

describe("OverviewTallyPanel", () => {
  it("默认收起，展开前看不到明细", async () => {
    const { host, root } = await renderDom(<OverviewTallyPanel tally={tally} />);
    expect(toggle(host).getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent ?? "").not.toContain("不上天的");
    expect(host.textContent ?? "").not.toContain("天上 10 颗");
    await unmount(root);
  });

  it("展开后逐行列出总数、四种星与六种不上天的去处", async () => {
    const { host, root } = await renderDom(<OverviewTallyPanel tally={tally} />);
    await click(toggle(host));
    expect(toggle(host).getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent ?? "").toContain("天上 10 颗：亮着 7，暗处 3");
    expect(host.textContent ?? "").toContain("不上天的");
    expect(host.textContent ?? "").toContain("目标里指向已删除东西的 2 处");
    expect(host.textContent ?? "").toContain("归档的目标 1 个（不成团）");
    expect(itemTexts(host)).toEqual([
      "你丢的 4 颗",
      "做完的 3 颗",
      "项目进度 2 颗",
      "固定重复 1 颗",
      "重复的某一次：5",
      "子任务（跟着父任务那颗）：6",
      "已结束的重复：1",
      "30 天前做完的：12",
      "已结束的轨道：2",
      "已归档的轨道：3",
    ]);
    await unmount(root);
  });

  it("再点一次收起", async () => {
    const { host, root } = await renderDom(<OverviewTallyPanel tally={tally} />);
    await click(toggle(host));
    await click(toggle(host));
    expect(toggle(host).getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent ?? "").not.toContain("不上天的");
    await unmount(root);
  });
});
