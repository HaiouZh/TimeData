// @vitest-environment jsdom
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { OverviewCluster } from "../../lib/overview/overviewModel.js";
import type { OverviewStar } from "../../lib/overview/overviewStars.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { OverviewList } from "./OverviewList.js";
import type { OpenStarHandler } from "./OverviewStarList.js";

const AT = "2026-10-30T12:00:00.000Z";

function star(key: string, overrides: Partial<OverviewStar> = {}): OverviewStar {
  return {
    key,
    kind: "input",
    title: key,
    searchText: key.toLowerCase(),
    at: AT,
    pinned: false,
    href: "/quick-notes?date=2026-10-30",
    source: { type: "quick_note", note: { id: key, text: key, occurredAt: AT, createdAt: AT, updatedAt: AT } },
    extraEvents: [],
    ...overrides,
  };
}

function stars(prefix: string, count: number, overrides: Partial<OverviewStar> = {}): OverviewStar[] {
  return Array.from({ length: count }, (_, index) => star(`${prefix}-${index + 1}`, overrides));
}

function cluster(overrides: Partial<OverviewCluster> & Pick<OverviewCluster, "key" | "kind">): OverviewCluster {
  return {
    title: overrides.key,
    goalId: null,
    status: "moving",
    lastActivityAt: AT,
    quietDays: 0,
    litStars: [],
    darkStars: [],
    kindCounts: { input: 0, done: 0, progress: 0, recurring: 0 },
    ...overrides,
  };
}

function looseCluster(overrides: Partial<OverviewCluster> = {}): OverviewCluster {
  return cluster({
    key: "loose",
    kind: "loose",
    title: "还没归到哪件事",
    status: null,
    lastActivityAt: null,
    quietDays: null,
    ...overrides,
  });
}

function starButtons(host: HTMLElement, kindLabel: string): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>(`button[aria-label^="${kindLabel}："]`)];
}

function rowButtons(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>("ul > li > button[aria-expanded]")];
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const element = [...host.querySelectorAll("button")].find((button) => button.textContent === text);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`missing button ${text}`);
  return element;
}

async function renderList(clusters: OverviewCluster[], onOpenStar: OpenStarHandler = vi.fn()) {
  return renderDom(
    <MemoryRouter>
      <OverviewList clusters={clusters} onOpenStar={onOpenStar} />
    </MemoryRouter>,
  );
}

describe("OverviewList", () => {
  it("一团一行，默认收起，点开显示星", async () => {
    const { host, root } = await renderList([
      cluster({ key: "goal:g1", kind: "goal", goalId: "g1", title: "发布 v2", litStars: stars("t", 2) }),
      looseCluster({ litStars: stars("n", 1) }),
    ]);
    expect(rowButtons(host).length).toBe(2);
    expect(rowButtons(host)[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(rowButtons(host)[1]?.getAttribute("aria-expanded")).toBe("false");
    expect(starButtons(host, "你丢的").length).toBe(0);
    const row = rowButtons(host)[0];
    if (!(row instanceof HTMLButtonElement)) throw new Error("missing row");
    await click(row);
    expect(rowButtons(host)[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(rowButtons(host)[1]?.getAttribute("aria-expanded")).toBe("false");
    expect(starButtons(host, "你丢的").length).toBe(2);
    expect(starButtons(host, "你丢的")[0]?.textContent ?? "").toMatch(/10-30$/);
    await unmount(root);
  });

  it("星种串按种类计数", async () => {
    const { host, root } = await renderList([
      cluster({
        key: "goal:g1",
        kind: "goal",
        goalId: "g1",
        title: "发布 v2",
        litStars: [...stars("d", 2, { kind: "done" }), ...stars("p", 1, { kind: "progress" })],
        kindCounts: { input: 0, done: 2, progress: 1, recurring: 0 },
      }),
    ]);
    expect(host.querySelector('[aria-label="做完的2 颗"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="项目进度1 颗"]')).not.toBeNull();
    expect(host.querySelector('[aria-label^="你丢的"]')).toBeNull();
    expect(host.querySelector('[aria-label^="固定重复"]')).toBeNull();
    await unmount(root);
  });

  it("目标团展开后有「去目标页」链接，前缀小团没有", async () => {
    const { host, root } = await renderList([
      cluster({ key: "goal:g1", kind: "goal", goalId: "g1", title: "发布 v2", litStars: stars("t", 1) }),
      cluster({ key: "prefix:跑步", kind: "prefix", title: "跑步", litStars: stars("p", 1, { kind: "done" }) }),
    ]);
    for (const row of rowButtons(host)) await click(row);
    const links = [...host.querySelectorAll("a")].filter((link) => link.textContent === "去目标页");
    expect(links.length).toBe(1);
    expect(links[0]?.getAttribute("href")).toBe("/goals/g1");
    expect(links[0]?.closest("button")).toBeNull();
    await unmount(root);
  });

  it("暗处在清单里同样收着，点开才显示", async () => {
    const { host, root } = await renderList([looseCluster({ litStars: stars("n", 2), darkStars: stars("dark", 30) })]);
    const row = rowButtons(host)[0];
    if (!(row instanceof HTMLButtonElement)) throw new Error("missing row");
    await click(row);
    expect(starButtons(host, "你丢的").length).toBe(2);
    expect(buttonByText(host, "暗处还有 30 颗").getAttribute("aria-expanded")).toBe("false");
    await click(buttonByText(host, "暗处还有 30 颗"));
    expect(starButtons(host, "你丢的").length).toBe(32);
    await unmount(root);
  });

  it("没有任何团时显示空状态", async () => {
    const { host, root } = await renderList([]);
    expect(host.textContent).toContain("天上还没有星星");
    expect(host.textContent).toContain("在上面丢一条进来");
    await unmount(root);
  });

  it("行内写颗数与最近动静日期", async () => {
    const { host, root } = await renderList([
      cluster({
        key: "goal:g1",
        kind: "goal",
        goalId: "g1",
        title: "发布 v2",
        lastActivityAt: AT,
        litStars: stars("t", 2),
        darkStars: stars("d", 1),
      }),
      looseCluster({ litStars: stars("n", 4), darkStars: stars("m", 2) }),
    ]);
    expect(rowButtons(host)[0]?.textContent ?? "").toContain("3 颗 · 10-30 有动静");
    expect(rowButtons(host)[1]?.textContent ?? "").toContain("6 颗");
    expect(rowButtons(host)[1]?.textContent ?? "").not.toContain("有动静");
    expect(rowButtons(host)[1]?.textContent ?? "").toContain("还没归到哪件事");
    await unmount(root);
  });

  it("星种串把暗处的星也算上", async () => {
    const { host, root } = await renderList([
      looseCluster({
        litStars: stars("n", 2),
        darkStars: stars("d", 3, { kind: "done" }),
        kindCounts: { input: 2, done: 3, progress: 0, recurring: 0 },
      }),
    ]);
    expect(host.querySelector('[aria-label="你丢的2 颗"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="做完的3 颗"]')).not.toBeNull();
    await unmount(root);
  });
});
