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
});
