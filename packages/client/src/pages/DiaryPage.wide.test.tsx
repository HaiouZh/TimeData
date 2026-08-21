// @vitest-environment jsdom
// 宽屏参考栏测试：需 mock useIsWideScreen（脏标记），有意留在 isolate:true 的 unit 桶，勿收编 fast-jsdom。
import { createElement, act as reactAct } from "react";
import { flushSync } from "react-dom";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Root, renderDom, unmount } from "../test/domHarness.js";
import DiaryPage from "./DiaryPage.js";

const fetchDiaryConfig = vi.fn();
const fetchDiary = vi.fn();
const saveDiary = vi.fn();

vi.mock("../lib/diary/diaryApi.ts", async () => {
  const actual = await vi.importActual<typeof import("../lib/diary/diaryApi.js")>("../lib/diary/diaryApi.ts");
  return {
    ...actual,
    fetchDiaryConfig: (...args: unknown[]) => fetchDiaryConfig(...args),
    fetchDiary: (...args: unknown[]) => fetchDiary(...args),
    saveDiary: (...args: unknown[]) => saveDiary(...args),
  };
});

vi.mock("../hooks/useAppResumeRefresh.ts", () => ({ useAppResumeRefresh: () => {} }));

// 本文件的主角：强制走宽屏分支。jsdom 无 matchMedia，不打桩的话 useIsWideScreen 恒 false。
vi.mock("../lib/useIsWideScreen.js", () => ({ useIsWideScreen: () => true }));

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

async function renderPage(
  entry = "/diary",
): Promise<{ host: HTMLElement; root: Root; router: ReturnType<typeof createMemoryRouter> }> {
  // 必须是 data router：DiaryPage 用 useUnsavedChangesGuard（内部 useBlocker），
  // 在 <MemoryRouter> 下会抛 "useBlocker must be used within a data router."
  const router = createMemoryRouter(
    [
      { path: "/todo", element: createElement("span", null, "待办页") },
      { path: "/diary", element: createElement(DiaryPage) },
    ],
    { initialEntries: ["/todo", entry], initialIndex: 1 },
  );
  const { host, root } = await renderDom(createElement(RouterProvider, { router }));
  await flush();
  return { host, root, router };
}

async function navigateTo(router: ReturnType<typeof createMemoryRouter>, to: string) {
  await act(async () => {
    await router.navigate(to);
  });
  await flush();
}

beforeEach(() => {
  fetchDiaryConfig.mockReset();
  fetchDiary.mockReset();
  saveDiary.mockReset();
  fetchDiaryConfig.mockResolvedValue({ enabled: true, template: "1. ", guideItems: "" });
  fetchDiary.mockResolvedValue({ content: "1. x", mtime: 100 });
  document.body.innerHTML = "";
  // 固定"今天"，日期断言才能写死。绝不能 vi.useFakeTimers()——flush() 靠真实
  // setTimeout(0) 推进，开假时钟它们永不触发，整个文件挂死（超时不是变红）。
  vi.setSystemTime(new Date("2026-07-25T10:00:00+08:00"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("DiaryPage 宽屏参考栏", () => {
  it("宽屏渲染参考栏，且编辑区与分隔条都在", async () => {
    const { host, root } = await renderPage();

    expect(host.querySelector('[data-testid="diary-reference-panel"]')).not.toBeNull();
    expect(host.querySelector("textarea")).not.toBeNull();
    expect(host.querySelector('[role="separator"]')).not.toBeNull();

    await unmount(root);
  });

  it("看历史日期时分组标题写该日期，不写「今天」", async () => {
    const { host, root } = await renderPage("/diary?date=2026-07-20");

    const panel = host.querySelector('[data-testid="diary-reference-panel"]') as HTMLElement;
    expect(panel.textContent).toContain("7月20日");
    expect(panel.textContent).not.toContain("今天");

    await unmount(root);
  });

  it("空白日记预填后，宽屏把光标送到 “1. ” 之后，直接开打", async () => {
    fetchDiary.mockResolvedValue({ content: "", mtime: null });
    const { host, root } = await renderPage();

    const field = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(field.value).toBe("1. ");
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(3);
    expect(field.selectionEnd).toBe(3);

    await unmount(root);
  });

  it("已有正文的一天不抢焦点（只有真预填才聚焦）", async () => {
    fetchDiary.mockResolvedValue({ content: "昨天写的", mtime: 100 });
    const { host, root } = await renderPage();

    expect(document.activeElement).not.toBe(host.querySelector("textarea"));
    await unmount(root);
  });

  it("连着切到第二个空日记，光标同样归位（预填标志是计数器不是布尔）", async () => {
    fetchDiary.mockResolvedValue({ content: "", mtime: null });
    const { host, root, router } = await renderPage();
    expect(document.activeElement).toBe(host.querySelector("textarea"));

    // 切日期会把 loading 置回 true、整个分栏连 textarea 一起卸载重挂，焦点自然掉回 body。
    // 预填标志若是布尔（true→true 不变），归位 effect 不重跑，第二天就只能自己去点一下。
    await navigateTo(router, "/diary?date=2026-01-05");

    const field = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(field.value).toBe("1. ");
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(3);
    await unmount(root);
  });
});
