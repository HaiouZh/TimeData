// @vitest-environment jsdom
// 窄屏专用测试：本文件不打桩 useIsWideScreen，jsdom 无 matchMedia 时它恒 false。
// 有意跟 wide 场景分文件，避免同文件里 vi.mock 顶层声明互相打架。
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

describe("DiaryReviewPage 窄屏 · 模式 B", () => {
  it("窄屏不出现布局切换钮，且卡片为单列列表", async () => {
    const { host } = await renderPage("/diary/review?date=2026-07-25");
    await click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "回顾") ?? null);

    expect(host.querySelector('button[aria-label^="切换为"]')).toBeNull();
  });
});

describe("DiaryReviewPage 窄屏 · 模式 C", () => {
  // spec：「窄屏单栏、本周在前」——是排序要求，不是「只留本周」。原用例把
  // not.toContain("上周") 钉死了错误行为，移动端等于丢掉周览一半的价值。
  it("窄屏两段都在，单栏纵向且本周排在上周之前", async () => {
    const { host } = await renderPage("/diary/review?date=2026-07-25");
    await click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "周览") ?? null);

    const headings = Array.from(host.querySelectorAll("h2")).map((h) => h.textContent);
    expect(headings).toEqual(["本周", "上周"]);
  });

  it("窄屏两段的 7 天日卡都渲染（共 14 张）", async () => {
    const { host } = await renderPage("/diary/review?date=2026-07-25");
    await click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "周览") ?? null);

    expect(host.querySelectorAll("[data-week-key]")).toHaveLength(2);
    const dayCards = host.querySelectorAll('[data-week-key] > div');
    expect(dayCards).toHaveLength(14);
  });
});
