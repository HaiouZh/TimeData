// @vitest-environment jsdom
import { createElement, act as reactAct } from "react";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Root, renderDom, unmount } from "../../../test/domHarness.js";
import DiaryReviewPage from "./DiaryReviewPage.js";

const fetchDiaryBatch = vi.fn();

vi.mock("../../../lib/diary/diaryApi.ts", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/diary/diaryApi.js")>("../../../lib/diary/diaryApi.ts");
  return {
    ...actual,
    fetchDiaryBatch: (...args: unknown[]) => fetchDiaryBatch(...args),
  };
});

// 让某条内容能在渲染期抛异常，用来验证内容区的 ErrorBoundary 真接得住。
vi.mock("./DiaryMarkdown.js", async () => {
  const actual = await vi.importActual<typeof import("./DiaryMarkdown.js")>("./DiaryMarkdown.js");
  return {
    default: ({ content }: { content: string }) => {
      if (content === "BOOM") throw new Error("markdown 炸了");
      return actual.default({ content });
    },
  };
});

// 强制走宽屏分支，模式 A 的左右两列都要渲染出来才能断言。jsdom 无 matchMedia。
vi.mock("../../../lib/useIsWideScreen.js", () => ({ useIsWideScreen: () => true }));

async function act(callback: () => Promise<void> | void) {
  await reactAct(async () => {
    let result: Promise<void> | void;
    flushSync(() => {
      result = callback();
    });
    await result;
    flushSync(() => {});
  });
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

// 每个用例渲染出的 React root 都登记在案，afterEach 统一 unmount——
// document.body.innerHTML = "" 只清 DOM 不清根，根活着会跨用例继续响应定时器/异步回调。
const openRoots: Root[] = [];

async function renderPage(entry = "/diary/review"): Promise<{ host: HTMLElement; root: Root }> {
  const { host, root } = await renderDom(
    createElement(MemoryRouter, { initialEntries: [entry] }, createElement(DiaryReviewPage)),
  );
  openRoots.push(root);
  await flush();
  return { host, root };
}

async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) throw new Error("missing clickable element");
  await act(async () => {
    element.click();
  });
  await flush();
}

beforeEach(() => {
  fetchDiaryBatch.mockReset();
  fetchDiaryBatch.mockResolvedValue({ dates: {}, weeks: {}, weeklyConfigured: true });
  localStorage.clear();
  document.body.innerHTML = "";
  vi.setSystemTime(new Date("2026-07-25T10:00:00+08:00"));
});

afterEach(async () => {
  while (openRoots.length > 0) {
    const root = openRoots.pop();
    if (root) await unmount(root);
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("DiaryReviewPage · 骨架 + 模式 A（那年今日）", () => {
  it("默认模式 A：batch 请求 dates 是左右两列合并去重", async () => {
    await renderPage();

    expect(fetchDiaryBatch).toHaveBeenCalledTimes(1);
    const { dates } = fetchDiaryBatch.mock.calls[0][0] as { dates: string[] };
    // 左栏=昨天(7/24)近5年、右栏=今天(7/25)近5年，各 5 条，年份不重叠，去重后应为 10 条不重复
    expect(dates).toHaveLength(10);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toContain("2026-07-25");
    expect(dates).toContain("2026-07-24");
    expect(dates).toContain("2022-07-25");
    expect(dates).toContain("2022-07-24");
  });

  it("两列各渲染 5 张卡：存在内容的显示正文，不存在的显示「无内容」+ ➕ 链接", async () => {
    fetchDiaryBatch.mockResolvedValue({
      dates: { "2026-07-25": { exists: true, content: "今天写的" } },
      weeks: {},
      weeklyConfigured: true,
    });
    const { host } = await renderPage();

    const cards = host.querySelectorAll('a[aria-label^="打开"], a[aria-label^="创建"]');
    expect(cards).toHaveLength(10);

    const existingLink = host.querySelector('a[aria-label="打开 2026年7月25日 日记"]');
    expect(existingLink).not.toBeNull();
    expect(existingLink?.getAttribute("href")).toBe("/diary?date=2026-07-25");
    expect(host.textContent).toContain("今天写的");

    const missingLink = host.querySelector('a[aria-label="创建 2026年7月24日 日记"]');
    expect(missingLink).not.toBeNull();
    expect(missingLink?.getAttribute("href")).toBe("/diary?date=2026-07-24");
  });

  it("?date=2026-13-99 非法值钳到今天", async () => {
    const { host } = await renderPage("/diary/review?date=2026-13-99");

    const dateInput = host.querySelector('input[aria-label="选择日期"]') as HTMLInputElement;
    expect(dateInput.value).toBe("2026-07-25");
  });

  it("点 ▶ 后 ?date= 前进一天", async () => {
    const { host } = await renderPage("/diary/review?date=2026-07-20");
    fetchDiaryBatch.mockClear();

    await click(host.querySelector('button[aria-label="下一段"]'));

    const dateInput = host.querySelector('input[aria-label="选择日期"]') as HTMLInputElement;
    expect(dateInput.value).toBe("2026-07-21");
    expect(fetchDiaryBatch).toHaveBeenCalled();
  });

  it("batch 失败显示错误条 + 重试按钮，点重试重新发起请求", async () => {
    fetchDiaryBatch.mockRejectedValueOnce(new Error("网络错误"));
    const { host } = await renderPage();

    expect(host.textContent).toContain("网络错误");
    const retryButton = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "重试");
    expect(retryButton).toBeTruthy();

    fetchDiaryBatch.mockResolvedValueOnce({ dates: {}, weeks: {}, weeklyConfigured: true });
    await click(retryButton ?? null);

    expect(fetchDiaryBatch).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("网络错误");
  });
});

describe("DiaryReviewPage · 模式 B（近三日回顾）", () => {
  it("切到模式 B 后 batch 只请求 3 个日期", async () => {
    const { host } = await renderPage("/diary/review?date=2026-07-25");
    fetchDiaryBatch.mockClear();

    await click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "回顾") ?? null);

    expect(fetchDiaryBatch).toHaveBeenCalledTimes(1);
    const { dates } = fetchDiaryBatch.mock.calls[0][0] as { dates: string[] };
    expect(dates).toEqual(["2026-07-24", "2026-07-23", "2026-07-22"]);
  });

  it("宽屏出现布局切换钮，点击互切并写偏好", async () => {
    const { host } = await renderPage("/diary/review?date=2026-07-25");
    await click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "回顾") ?? null);

    const layoutButton = host.querySelector('button[aria-label="切换为列表布局"]');
    expect(layoutButton).not.toBeNull();

    await click(layoutButton);
    expect(host.querySelector('button[aria-label="切换为网格布局"]')).not.toBeNull();
  });

  it("卡片标签是 formatMonthDay(date) + formatWeekday(date) 形态", async () => {
    fetchDiaryBatch.mockResolvedValue({
      dates: { "2026-07-24": { exists: true, content: "写了" } },
      weeks: {},
      weeklyConfigured: true,
    });
    const { host } = await renderPage("/diary/review?date=2026-07-25");
    await click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "回顾") ?? null);

    expect(host.textContent).toContain("7月24日");
  });
});

describe("DiaryReviewPage · 模式 C（周览）", () => {
  async function switchToC(host: HTMLElement) {
    await click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "周览") ?? null);
  }

  it("batch 请求含 14 个日期 + 2 个周号", async () => {
    const { host } = await renderPage("/diary/review?date=2026-07-25");
    fetchDiaryBatch.mockClear();

    await switchToC(host);

    expect(fetchDiaryBatch).toHaveBeenCalledTimes(1);
    const { dates, weeks } = fetchDiaryBatch.mock.calls[0][0] as { dates: string[]; weeks: string[] };
    expect(dates).toHaveLength(14);
    expect(weeks).toHaveLength(2);
  });

  it("weeklyConfigured:false 时两列都显示「未配置周记路径模板」", async () => {
    fetchDiaryBatch.mockResolvedValue({ dates: {}, weeks: {}, weeklyConfigured: false });
    const { host } = await renderPage("/diary/review?date=2026-07-25");

    await switchToC(host);

    const matches = host.textContent?.match(/未配置周记路径模板/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("未来日卡有 opacity-50 且无 ➕ 链接", async () => {
    const { host } = await renderPage("/diary/review?date=2026-07-25");

    await switchToC(host);

    // 2026-07-25 是周六，本周含未来日期（周日 7/26）
    const futureCard = Array.from(host.querySelectorAll(".opacity-50")).find((el) =>
      el.textContent?.includes("7月26日"),
    );
    expect(futureCard).toBeTruthy();
    expect(futureCard?.querySelector('a[aria-label^="创建"]')).toBeNull();
    expect(futureCard?.textContent).toContain("未来");
  });

  it("▶ 步进 7 天", async () => {
    // 起点选比今天早一周以上，避免 +7 撞上"未来钳到今天"的裁决（resolveDiaryDate 契约）。
    const { host } = await renderPage("/diary/review?date=2026-07-11");
    await switchToC(host);

    await click(host.querySelector('button[aria-label="下一段"]'));

    const dateInput = host.querySelector('input[aria-label="选择日期"]') as HTMLInputElement;
    expect(dateInput.value).toBe("2026-07-18");
  });
});

describe("DiaryReviewPage · 显示年份数偏好", () => {
  it("改年份数写入偏好并重发 batch，卡片数量随之变化", async () => {
    const { host } = await renderPage();
    expect(host.querySelectorAll('a[aria-label^="打开"], a[aria-label^="创建"]')).toHaveLength(10);
    fetchDiaryBatch.mockClear();

    const input = host.querySelector('input[aria-label="显示年份数"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("5");

    await act(async () => {
      // 直接赋 value 绕不过 React 的 value tracker，须走原生 setter 再派发 input 事件
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();

    // 关键：改年数必须重发请求（yearRange 曾被无效的 biome-ignore 排除在 effect 依赖外，
    // 结果 UI 列数变了、batch 不重发，新增那几年永远无数据）。
    expect(fetchDiaryBatch).toHaveBeenCalledTimes(1);
    const { dates } = fetchDiaryBatch.mock.calls[0][0] as { dates: string[] };
    expect(dates).toHaveLength(4);
    expect(localStorage.getItem("timedata_diary_review_year_range")).toBe("2");
    expect(host.querySelectorAll('a[aria-label^="打开"], a[aria-label^="创建"]')).toHaveLength(4);
  });
});

describe("DiaryReviewPage · 错误与异常兜底", () => {
  it("batch 失败时错误条叠加在内容之上，已有卡片继续显示", async () => {
    fetchDiaryBatch.mockRejectedValueOnce(new Error("网络错误"));
    const { host } = await renderPage();

    expect(host.textContent).toContain("网络错误");
    // 错误条不得替换整个内容区：卡片骨架仍在（原实现走三元把内容区整个换掉）。
    expect(host.querySelectorAll('a[aria-label^="打开"], a[aria-label^="创建"]')).toHaveLength(10);
  });

  it("单张卡片渲染抛异常时只掀该内容区，页头仍在（ErrorBoundary）", async () => {
    fetchDiaryBatch.mockResolvedValue({
      dates: { "2026-07-25": { exists: true, content: "BOOM" } },
      weeks: {},
      weeklyConfigured: true,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { host } = await renderPage();

    expect(host.textContent).toContain("这段内容渲染失败");
    expect(host.querySelector('button[aria-label="返回"]')).not.toBeNull();
  });
});

describe("DiaryReviewPage · 加载态与卡片高度", () => {
  it("模式 C 请求期间显示加载中，而不是「未配置周记」「无内容」", async () => {
    const { host } = await renderPage("/diary/review?date=2026-07-25");
    fetchDiaryBatch.mockImplementation(() => new Promise(() => {}));

    await click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "周览") ?? null);

    expect(host.textContent).toContain("加载中…");
    expect(host.textContent).not.toContain("未配置周记路径模板");
    expect(host.textContent).not.toContain("无内容");
  });

  it("卡片内容区高度自适应：minHeight 只作下限，maxHeight 更大且超出滚动", async () => {
    const { host } = await renderPage();
    const scroller = host.querySelector(".overflow-y-auto[style]") as HTMLElement;
    expect(scroller).not.toBeNull();
    const min = Number.parseInt(scroller.style.minHeight, 10);
    const max = Number.parseInt(scroller.style.maxHeight, 10);
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThan(min);
  });
});
