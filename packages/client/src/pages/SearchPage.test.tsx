// @vitest-environment jsdom
import type { TimeEntry } from "@timedata/shared";
import { act, createElement } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../test/dbReset.js";
import { cleanupRoots, click, renderDom, type Root, unmount } from "../test/domHarness.js";
import { db } from "../db/index.ts";
import SearchPage from "./SearchPage.js";

function entry(
  id: string,
  categoryId: string,
  startLocal: string,
  endLocal: string,
  note: string | null = null,
): TimeEntry {
  return {
    id,
    categoryId,
    // 断言全部按 +08:00 书写，转成 UTC 存储
    startTime: new Date(`${startLocal}+08:00`).toISOString(),
    endTime: new Date(`${endLocal}+08:00`).toISOString(),
    note,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** 从 2026-01-01 起每天一条 09:00~09:10 的记录，全部落在默认年档区间内。 */
function dailyEntries(count: number, categoryId: string): TimeEntry[] {
  const base = new Date("2026-01-01T09:00:00+08:00").getTime();
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(base + index * 86_400_000);
    return {
      id: `bulk-${String(index).padStart(3, "0")}`,
      categoryId,
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 10 * 60_000).toISOString(),
      note: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  });
}

async function seed(): Promise<void> {
  await db.categories.bulkPut([
    {
      id: "cat-sleep", name: "睡眠", parentId: null, color: "#3355aa", icon: null, sortOrder: 0,
      isArchived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "cat-sleep-nap", name: "小睡", parentId: "cat-sleep", color: "#3355aa", icon: null, sortOrder: 0,
      isArchived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "cat-work", name: "工作", parentId: null, color: "#aa5533", icon: null, sortOrder: 1,
      isArchived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  await db.timeEntries.bulkPut([
    entry("e1", "cat-sleep-nap", "2026-02-14T16:51:00", "2026-02-14T17:22:00"),
  ]);
}

/** 把当前路由渲染出来（供断言「URL 何时被写」），并给一个返回上一页的按钮量 replace/push 语义。 */
function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return createElement(
    "div",
    null,
    createElement("span", { "data-url-search": "" }, location.search),
    createElement("span", { "data-url-path": "" }, location.pathname),
    createElement("button", { type: "button", "data-go-back": "", onClick: () => navigate(-1) }, "__back__"),
  );
}

async function renderPage(
  initialEntry: string | string[],
  initialIndex?: number,
): Promise<{ host: HTMLElement; root: Root }> {
  return renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: Array.isArray(initialEntry) ? initialEntry : [initialEntry], initialIndex },
      createElement(SearchPage),
      createElement(LocationProbe),
    ),
  );
}

/** 只取 SearchPage 子树的文本，别把 LocationProbe 的 query string 混进文案断言。 */
function pageText(host: HTMLElement): string {
  return host.firstElementChild?.textContent ?? "";
}

function urlSearch(host: HTMLElement): string {
  return host.querySelector("[data-url-search]")?.textContent ?? "";
}

function urlPath(host: HTMLElement): string {
  return host.querySelector("[data-url-path]")?.textContent ?? "";
}

/** 汇总条的四个数，顺序为 天数 / 时长 / 日均时长 / 次数。 */
function summaryValues(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("dd")).map((cell) => cell.textContent ?? "");
}

function entryIds(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLElement>("[data-entry-id]")).map(
    (row) => row.dataset.entryId ?? "",
  );
}

function buttonByText(host: HTMLElement, text: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>("button")).find(
    (button) => button.textContent?.trim() === text,
  );
  if (!found) throw new Error(`button "${text}" not found`);
  return found;
}

/** 顶栏的分类 chip（弹层触发器），可访问名就是当前分类文案，故按 aria-haspopup 定位。 */
function categoryChip(host: HTMLElement): HTMLElement {
  const found = host.querySelector<HTMLElement>('button[aria-haspopup="dialog"]');
  if (!found) throw new Error("category chip not found");
  return found;
}

function byLabel(host: HTMLElement, label: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`element labelled "${label}" not found`);
  return found;
}

function searchInput(host: HTMLElement): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('input[type="search"]');
}

/**
 * 推进去抖计时器，并把事件循环让出去让 fake-indexeddb 的事务回调跑完。
 * 页面上有两条 useLiveQuery（记录 + 分类），单轮 advance 只够喂饱其中一条。
 * 必须裹在 act 里：MemoryRouter 的 location setState 走 React.startTransition，
 * 不进 act 就只排队不提交，location 相关断言会读到上一帧。
 */
async function settle(rounds = 3): Promise<void> {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await vi.advanceTimersByTimeAsync(300);
    }
  });
}

/** 走原生 value setter + input 事件，让 React 的 onChange 真的收到这次输入。 */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  // fake-indexeddb 用真实 setImmediate 驱动事务完成回调；若把它也伪造掉，resetDb/useLiveQuery
  // 的底层事务永远等不到回调，beforeEach 会直接卡到 hook 超时。这里只伪造 Date/setTimeout 系列。
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-02-14T12:00:00+08:00"));
  await resetDb();
  await seed();
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanupRoots();
});

describe("SearchPage", () => {
  it("默认年档列出当年记录并给出四项汇总", async () => {
    const { host, root } = await renderPage("/search");
    await settle();

    expect(pageText(host)).toContain("睡眠 · 小睡");
    expect(entryIds(host)).toEqual(["e1"]);
    // 天数 / 时长 / 日均时长 / 次数：一条 31 分钟的记录
    expect(summaryValues(host)).toEqual(["1", "31分钟", "31分钟", "1"]);
    await unmount(root);
  });

  it("URL 带的筛选状态被还原", async () => {
    const { host, root } = await renderPage("/search?range=year&anchor=2020-01-01");
    await settle();

    expect(pageText(host)).toContain("2020");
    expect(pageText(host)).toContain("这个范围里没有匹配的记录");
    expect(summaryValues(host)).toEqual(["0", "0分钟", "0分钟", "0"]);
    await unmount(root);
  });

  it("还在查库的那一帧不渲染空态文案", async () => {
    const { host, root } = await renderPage("/search?range=year&anchor=2020-01-01");
    // 尚未推进计时器：useLiveQuery 还是 undefined，此时不能先甩一句「没有匹配的记录」
    expect(pageText(host)).not.toContain("这个范围里没有匹配的记录");

    await settle();
    expect(pageText(host)).toContain("这个范围里没有匹配的记录");
    await unmount(root);
  });

  it("URL 里的未知分类 id 回落成不过滤，chip 显示全部分类", async () => {
    const { host, root } = await renderPage("/search?cat=cat-ghost");
    await settle();

    expect(entryIds(host)).toEqual(["e1"]);
    expect(pageText(host)).not.toContain("这个范围里没有匹配的记录");
    expect(categoryChip(host).textContent?.trim()).toBe("全部分类");
    expect(pageText(host)).not.toContain("未知");
    await unmount(root);
  });

  it("选父分类时整棵子树的记录都命中", async () => {
    await db.timeEntries.bulkPut([
      entry("on-parent", "cat-sleep", "2026-02-12T09:00:00", "2026-02-12T09:30:00"),
      entry("on-other", "cat-work", "2026-02-13T09:00:00", "2026-02-13T09:30:00"),
    ]);

    const { host, root } = await renderPage("/search?cat=cat-sleep");
    await settle();

    // e1 挂子分类 cat-sleep-nap，on-parent 直接挂父分类；cat-work 的那条要被排除
    expect(entryIds(host)).toEqual(["e1", "on-parent"]);
    expect(categoryChip(host).textContent?.trim()).toBe("睡眠");
    await unmount(root);
  });

  it("超过一页时汇总按完整匹配集算，显示更多不改四个数", async () => {
    await db.timeEntries.clear();
    await db.timeEntries.bulkPut(dailyEntries(105, "cat-sleep"));

    const { host, root } = await renderPage("/search");
    await settle();

    expect(entryIds(host)).toHaveLength(100);
    expect(pageText(host)).toContain("还有 5 条 · 显示更多");
    // 105 条 × 10 分钟 = 1050 分钟，分布在 105 个不同的本地日
    const summaryBefore = summaryValues(host);
    expect(summaryBefore).toEqual(["105", "17小时30分钟", "10分钟", "105"]);

    await click(buttonByText(host, "还有 5 条 · 显示更多"));
    expect(entryIds(host)).toHaveLength(105);
    expect(pageText(host)).not.toContain("显示更多");
    expect(summaryValues(host)).toEqual(summaryBefore);

    // 切筛子（年 → 全）后分页游标要回到第一页
    await click(buttonByText(host, "全"));
    await settle();
    expect(entryIds(host)).toHaveLength(100);
    expect(pageText(host)).toContain("还有 5 条 · 显示更多");
    expect(summaryValues(host)).toEqual(summaryBefore);
    await unmount(root);
  });

  it("年档取数含起点当刻、不含终点当刻（Dexie 半开区间接线）", async () => {
    await db.timeEntries.clear();
    await db.timeEntries.bulkPut([
      entry("edge-start", "cat-sleep", "2026-01-01T00:00:00", "2026-01-01T00:30:00"),
      entry("edge-end", "cat-sleep", "2026-12-31T23:59:00", "2027-01-01T00:29:00"),
      entry("next-year", "cat-sleep", "2027-01-01T00:00:00", "2027-01-01T00:30:00"),
    ]);

    const { host, root } = await renderPage("/search");
    await settle();

    // Dexie 层漏掉的记录 filterSearchEntries 补不回来（它只做减法），所以起点这条必须靠整页断言守
    expect(entryIds(host)).toEqual(["edge-end", "edge-start"]);
    await unmount(root);
  });

  it("凌晨记录按本地日分组，不落到 UTC 的前一天", async () => {
    await db.timeEntries.clear();
    // 本地 02-10 01:00(+08) 的 UTC 是 02-09T17:00Z
    await db.timeEntries.bulkPut([entry("dawn", "cat-sleep", "2026-02-10T01:00:00", "2026-02-10T02:00:00")]);

    const { host, root } = await renderPage("/search");
    await settle();

    expect(host.querySelector("h3")?.textContent).toContain("2026-02-10");
    expect(pageText(host)).not.toContain("2026-02-09");
    expect(summaryValues(host)[0]).toBe("1");
    await unmount(root);
  });

  it("关键词大小写不敏感，且只在去抖落定后才写 URL", async () => {
    await db.timeEntries.clear();
    await db.timeEntries.bulkPut([
      entry("hit", "cat-sleep", "2026-02-12T09:00:00", "2026-02-12T09:30:00", "午后 NAP 很沉"),
      entry("miss", "cat-sleep", "2026-02-13T09:00:00", "2026-02-13T09:30:00", "午后散步"),
    ]);

    const { host, root } = await renderPage("/search");
    await settle();
    expect(entryIds(host)).toHaveLength(2);

    await click(byLabel(host, "搜索备注"));
    const input = searchInput(host);
    expect(input).not.toBeNull();
    if (!input) throw new Error("search input missing");

    await typeInto(input, "Nap");
    // 本地 state 即刻回显，URL 这一刻还不能被写（逐键写 URL 正是要修的缺陷）
    expect(input.value).toBe("Nap");
    expect(urlSearch(host)).toBe("");

    await settle();
    expect(urlSearch(host)).toBe("?q=Nap");
    expect(entryIds(host)).toEqual(["hit"]);
    await unmount(root);
  });

  it("纯空白关键词照写进 URL，不被 trim 掉", async () => {
    const { host, root } = await renderPage("/search");
    await settle();

    await click(byLabel(host, "搜索备注"));
    const input = searchInput(host);
    if (!input) throw new Error("search input missing");

    await typeInto(input, " ");
    await settle();
    expect(input.value).toBe(" ");
    expect(urlSearch(host)).toBe("?q=+");
    // 空白不构成关键词筛子，记录照旧全在
    expect(entryIds(host)).toEqual(["e1"]);
    await unmount(root);
  });

  it("带 ?q= 深链进来搜索框展开并回显，点 X 收起后清空 query", async () => {
    const { host, root } = await renderPage("/search?q=NAP");
    await settle();

    const input = searchInput(host);
    if (!input) throw new Error("search input missing");
    expect(input.value).toBe("NAP");

    await click(byLabel(host, "收起搜索"));
    expect(searchInput(host)).toBeNull();
    expect(urlSearch(host)).toBe("");
    // 旧词的去抖再落定时不能把它写回来
    await settle();
    expect(urlSearch(host)).toBe("");
    await unmount(root);
  });

  it("改筛子用 replace 写回，返回键一次就退出搜索页", async () => {
    const { host, root } = await renderPage(["/", "/search"], 1);
    await settle();

    await click(buttonByText(host, "月"));
    await settle();
    expect(urlSearch(host)).toBe("?range=month");

    // push 的话历史里会多一条 /search?range=month，返回键只退回到没带参数的 /search
    await click(host.querySelector("[data-go-back]"));
    await settle();
    expect(urlPath(host)).toBe("/");
    await unmount(root);
  });

  it("分类弹层是条件渲染：关闭时 DOM 里查不到它", async () => {
    const { host, root } = await renderPage("/search");
    await settle();
    expect(host.querySelector("[data-category-row]")).toBeNull();

    const chip = categoryChip(host);
    await click(chip);
    expect(host.querySelectorAll("[data-category-row]").length).toBeGreaterThan(0);
    expect(chip.getAttribute("aria-expanded")).toBe("true");

    await click(byLabel(host, "全部分类"));
    expect(host.querySelector("[data-category-row]")).toBeNull();
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    await unmount(root);
  });
});
