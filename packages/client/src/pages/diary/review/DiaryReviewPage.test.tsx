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

async function renderPage(entry = "/diary/review"): Promise<{ host: HTMLElement; root: Root }> {
  const { host, root } = await renderDom(
    createElement(MemoryRouter, { initialEntries: [entry] }, createElement(DiaryReviewPage)),
  );
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

afterEach(() => {
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
