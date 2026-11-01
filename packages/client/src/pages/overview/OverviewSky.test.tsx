// @vitest-environment jsdom
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { OverviewCluster } from "../../lib/overview/overviewModel.js";
import type { OverviewStar } from "../../lib/overview/overviewStars.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { OverviewSky } from "./OverviewSky.js";
import { type OpenStarHandler, OverviewStarList } from "./OverviewStarList.js";

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

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const element = [...host.querySelectorAll("button")].find((button) => button.textContent === text);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`missing button ${text}`);
  return element;
}

async function renderSky(clusters: OverviewCluster[], onOpenStar: OpenStarHandler = vi.fn()) {
  return renderDom(
    <MemoryRouter>
      <OverviewSky clusters={clusters} onOpenStar={onOpenStar} />
    </MemoryRouter>,
  );
}

describe("OverviewSky", () => {
  it("每团默认最多 12 颗，点「还有 3 颗」后全显示", async () => {
    const { host, root } = await renderSky([
      cluster({ key: "goal:g1", kind: "goal", goalId: "g1", title: "发布 v2", litStars: stars("t", 15) }),
    ]);
    expect(starButtons(host, "你丢的").length).toBe(12);
    await click(buttonByText(host, "还有 3 颗"));
    expect(starButtons(host, "你丢的").length).toBe(15);
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "还有 3 颗")).toBe(false);
    await unmount(root);
  });

  it("散着默认最多 24 颗", async () => {
    const { host, root } = await renderSky([looseCluster({ litStars: stars("n", 30) })]);
    expect(starButtons(host, "你丢的").length).toBe(24);
    expect(buttonByText(host, "还有 6 颗") instanceof HTMLButtonElement).toBe(true);
    await unmount(root);
  });

  it("1500 颗暗星默认一颗都不渲染，点开后最多 200 颗并提示用搜索", async () => {
    const { host, root } = await renderSky([
      looseCluster({ litStars: stars("lit", 5), darkStars: stars("dark", 1500) }),
    ]);
    expect(starButtons(host, "你丢的").length).toBe(5);
    const toggle = buttonByText(host, "暗处还有 1500 颗");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("用搜索找");
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(starButtons(host, "你丢的").length).toBe(205);
    expect(host.textContent).toContain("还有 1300 颗，用搜索找");
    await unmount(root);
  });

  it("目标团标题链到 /goals/:id；前缀小团不可点，并标「按标题归的」", async () => {
    const { host, root } = await renderSky([
      cluster({ key: "goal:g1", kind: "goal", goalId: "g1", title: "发布 v2", litStars: stars("t", 1) }),
      cluster({ key: "prefix:跑步", kind: "prefix", title: "跑步", litStars: stars("p", 1, { kind: "done" }) }),
      looseCluster({ litStars: stars("n", 1) }),
    ]);
    const link = host.querySelector('a[aria-label="打开目标「发布 v2」"]');
    expect(link?.getAttribute("href")).toBe("/goals/g1");
    const headings = [...host.querySelectorAll("h2")];
    const prefixHeading = headings.find((heading) => heading.textContent === "跑步");
    if (!prefixHeading) throw new Error("missing prefix heading");
    expect(prefixHeading.querySelector("a, button")).toBeNull();
    expect(prefixHeading.closest("li")?.textContent ?? "").toContain("按标题归的");
    expect(link?.closest("li")?.textContent ?? "").not.toContain("按标题归的");
    const looseHeading = headings.find((heading) => heading.textContent === "还没归到哪件事");
    if (!looseHeading) throw new Error("missing loose heading");
    expect(looseHeading.closest("li")?.textContent ?? "").not.toContain("按标题归的");
    await unmount(root);
  });

  it("点星把那颗星交给 onOpenStar", async () => {
    const target = stars("t", 3);
    const onOpenStar = vi.fn();
    const { host, root } = await renderSky(
      [cluster({ key: "goal:g1", kind: "goal", goalId: "g1", title: "发布 v2", litStars: target })],
      onOpenStar,
    );
    const second = starButtons(host, "你丢的")[1];
    if (!(second instanceof HTMLButtonElement)) throw new Error("missing star");
    await click(second);
    expect(onOpenStar).toHaveBeenCalledTimes(1);
    expect(onOpenStar.mock.calls[0]?.[0]).toBe(target[1]);
    await unmount(root);
  });

  it("没有任何团时显示空状态", async () => {
    const { host, root } = await renderSky([]);
    expect(host.textContent).toContain("天上还没有星星");
    expect(host.textContent).toContain("在上面丢一条进来");
    await unmount(root);
  });

  it("团头写颗数与最近动静日期", async () => {
    const { host, root } = await renderSky([
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
    const headers = [...host.querySelectorAll("h2")].map((heading) => heading.parentElement?.textContent ?? "");
    expect(headers[0]).toContain("3 颗 · 10-30 有动静");
    expect(headers[1]).toContain("6 颗");
    expect(headers[1]).not.toContain("有动静");
    await unmount(root);
  });

  it("清单式每行末尾带日期，网格式不带", async () => {
    const one = cluster({
      key: "goal:g1",
      kind: "goal",
      goalId: "g1",
      title: "发布 v2",
      litStars: [star("t-1", { title: "写周报", at: "2026-10-29T12:00:00.000Z" })],
    });
    const rows = await renderDom(<OverviewStarList cluster={one} layout="rows" onOpenStar={vi.fn()} />);
    expect(starButtons(rows.host, "你丢的")[0]?.textContent).toBe("写周报10-29");
    await unmount(rows.root);
    const flow = await renderDom(<OverviewStarList cluster={one} layout="flow" onOpenStar={vi.fn()} />);
    expect(starButtons(flow.host, "你丢的")[0]?.textContent).toBe("写周报");
    await unmount(flow.root);
  });

  it("亮处展开按钮一直在、带展开态，点开变「收起」，再点收回", async () => {
    const { host, root } = await renderSky([
      cluster({ key: "goal:g1", kind: "goal", goalId: "g1", title: "发布 v2", litStars: stars("t", 15) }),
    ]);
    const toggle = buttonByText(host, "还有 3 颗");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.focus();
    await click(toggle);
    expect(toggle.isConnected).toBe(true);
    expect(toggle.textContent).toBe("收起");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement === toggle).toBe(true);
    expect(starButtons(host, "你丢的").length).toBe(15);
    await click(toggle);
    expect(starButtons(host, "你丢的").length).toBe(12);
    expect(toggle.textContent).toBe("还有 3 颗");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await unmount(root);
  });

  it("亮处点开最多渲染 200 颗，多出来的提示用搜索找", async () => {
    const { host, root } = await renderSky([looseCluster({ litStars: stars("n", 250) })]);
    expect(starButtons(host, "你丢的").length).toBe(24);
    expect(host.textContent ?? "").not.toContain("用搜索找");
    await click(buttonByText(host, "还有 226 颗"));
    expect(starButtons(host, "你丢的").length).toBe(200);
    expect(host.textContent ?? "").toContain("还有 50 颗，用搜索找");
    await unmount(root);
  });

  it("每团恰好 12 颗、散着恰好 24 颗时没有展开按钮，多 1 颗才有", async () => {
    const first = await renderSky([
      cluster({ key: "goal:a", kind: "goal", goalId: "a", litStars: stars("a", 12) }),
      cluster({ key: "goal:b", kind: "goal", goalId: "b", litStars: stars("b", 13) }),
      cluster({ key: "prefix:c", kind: "prefix", litStars: stars("c", 13) }),
      looseCluster({ litStars: stars("n", 24) }),
    ]);
    const overflowButtons = [...first.host.querySelectorAll("button")].filter((b) =>
      (b.textContent ?? "").startsWith("还有"),
    );
    expect(overflowButtons.length).toBe(2);
    expect(overflowButtons[0]?.textContent).toBe("还有 1 颗");
    expect(overflowButtons[1]?.textContent).toBe("还有 1 颗");
    expect(starButtons(first.host, "你丢的").length).toBe(60);
    await unmount(first.root);
    const second = await renderSky([looseCluster({ litStars: stars("n", 25) })]);
    expect(starButtons(second.host, "你丢的").length).toBe(24);
    expect(buttonByText(second.host, "还有 1 颗") instanceof HTMLButtonElement).toBe(true);
    await unmount(second.root);
  });

  it("暗处恰好 200 颗点开后不提示用搜索找，201 颗才提示", async () => {
    const first = await renderSky([
      looseCluster({ litStars: stars("n", 1), darkStars: stars("d", 200) }),
    ]);
    await click(buttonByText(first.host, "暗处还有 200 颗"));
    expect(starButtons(first.host, "你丢的").length).toBe(201);
    expect(first.host.textContent ?? "").not.toContain("用搜索找");
    await unmount(first.root);
    const second = await renderSky([
      looseCluster({ litStars: stars("n", 1), darkStars: stars("d", 201) }),
    ]);
    await click(buttonByText(second.host, "暗处还有 201 颗"));
    expect(second.host.textContent ?? "").toContain("还有 1 颗，用搜索找");
    await unmount(second.root);
  });

  it("每团的星装在以团名命名的分组里", async () => {
    const { host, root } = await renderSky([
      cluster({
        key: "goal:g1",
        kind: "goal",
        goalId: "g1",
        title: "TimeData",
        litStars: [star("t1", { title: "写周报" })],
      }),
      cluster({
        key: "goal:g2",
        kind: "goal",
        goalId: "g2",
        title: "发布 v2",
        litStars: [star("t1", { title: "写周报" })],
      }),
    ]);
    expect(host.querySelector('[role="group"][aria-label="TimeData"] button[aria-label="你丢的：写周报"]')).not.toBeNull();
    expect(host.querySelector('[role="group"][aria-label="发布 v2"] button[aria-label="你丢的：写周报"]')).not.toBeNull();
    await unmount(root);
  });
});
