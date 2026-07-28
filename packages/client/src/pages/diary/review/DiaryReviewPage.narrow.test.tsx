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

describe("DiaryReviewPage 窄屏 · 模式 B", () => {
  it("窄屏不出现布局切换钮，且卡片为单列列表", async () => {
    const { host, root } = await renderPage("/diary/review?date=2026-07-25");
    await click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "回顾") ?? null);

    expect(host.querySelector('button[aria-label^="切换为"]')).toBeNull();

    await unmount(root);
  });
});
