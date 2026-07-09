// @vitest-environment jsdom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Root, renderDom, unmount } from "../test/domHarness.js";
import DiaryPage from "./DiaryPage.js";

const { DiaryConflictError } = await import("../lib/diary/diaryApi.js");

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

async function act(callback: () => Promise<void> | void) {
  let result: Promise<void> | void;
  flushSync(() => {
    result = callback();
  });
  await result;
  flushSync(() => {});
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function renderPage(): Promise<{ host: HTMLElement; root: Root }> {
  const { host, root } = await renderDom(
    createElement(MemoryRouter, { initialEntries: ["/diary"] }, createElement(DiaryPage)),
  );
  await flush();
  return { host, root };
}

function textarea(host: HTMLElement): HTMLTextAreaElement {
  const element = host.querySelector("textarea");
  if (!(element instanceof HTMLTextAreaElement)) throw new Error("missing textarea");
  return element;
}

async function typeInto(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) throw new Error("missing clickable element");
  await act(async () => {
    element.click();
  });
  await flush();
}

beforeEach(() => {
  fetchDiaryConfig.mockReset();
  fetchDiary.mockReset();
  saveDiary.mockReset();
  fetchDiaryConfig.mockResolvedValue({ enabled: true, template: "1. " });
  fetchDiary.mockResolvedValue({ content: "1. x", mtime: 100 });
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DiaryPage", () => {
  it("加载后 textarea 显示 fetchDiary 返回的 content", async () => {
    const { host, root } = await renderPage();

    expect(textarea(host).value).toBe("1. x");

    await unmount(root);
  });

  it("改动后点保存，saveDiary 收到 { content, baseMtime }", async () => {
    saveDiary.mockResolvedValue({ mtime: 200 });
    const { host, root } = await renderPage();

    await typeInto(textarea(host), "1. y");
    await click(host.querySelector('button[aria-label="保存"]'));

    expect(saveDiary).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), {
      content: "1. y",
      baseMtime: 100,
    });

    await unmount(root);
  });

  it("saveDiary 抛 DiaryConflictError，点“仍然覆盖”带 force:true 重试", async () => {
    saveDiary.mockRejectedValueOnce(new DiaryConflictError(150));
    saveDiary.mockResolvedValueOnce({ mtime: 300 });
    const { host, root } = await renderPage();

    await typeInto(textarea(host), "1. y");
    await click(host.querySelector('button[aria-label="保存"]'));

    const overwriteButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "仍然覆盖",
    );
    expect(overwriteButton).toBeInstanceOf(HTMLButtonElement);

    await click(overwriteButton ?? null);

    expect(saveDiary).toHaveBeenCalledTimes(2);
    expect(saveDiary).toHaveBeenLastCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), {
      content: "1. y",
      baseMtime: 100,
      force: true,
    });

    await unmount(root);
  });

  it("enabled=false 显示未配置提示、无 textarea", async () => {
    fetchDiaryConfig.mockResolvedValue({ enabled: false, template: "" });
    const { host, root } = await renderPage();

    expect(host.textContent).toContain("DIARY_VAULT_DIR");
    expect(host.querySelector("textarea")).toBeNull();

    await unmount(root);
  });

  it("脏状态点返回弹 ConfirmSheet，点取消不导航、编辑内容仍在", async () => {
    const { host, root } = await renderPage();

    await typeInto(textarea(host), "1. dirty");
    await click(host.querySelector('button[aria-label="返回"]'));

    // ConfirmSheet 出现
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(host.textContent).toContain("有未保存的修改");

    const cancelButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "取消");
    await click(cancelButton ?? null);

    // 未导航：编辑页与本地编辑内容原样保留
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(textarea(host).value).toBe("1. dirty");

    await unmount(root);
  });

  it("冲突条点「刷新重载」弹 ConfirmSheet，点取消保留本地编辑且不再次 fetchDiary", async () => {
    saveDiary.mockRejectedValueOnce(new DiaryConflictError(150));
    const { host, root } = await renderPage();

    await typeInto(textarea(host), "1. local edit");
    await click(host.querySelector('button[aria-label="保存"]'));

    // 进入冲突态后点「刷新重载」
    const reloadButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "刷新重载",
    );
    expect(reloadButton).toBeInstanceOf(HTMLButtonElement);
    const fetchCallsBefore = fetchDiary.mock.calls.length;
    await click(reloadButton ?? null);

    // ConfirmSheet 出现，点取消
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain("将丢弃当前修改");
    const cancelButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "取消");
    await click(cancelButton ?? null);

    // 本地编辑内容原样保留，fetchDiary 未被再次调用
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(textarea(host).value).toBe("1. local edit");
    expect(fetchDiary.mock.calls.length).toBe(fetchCallsBefore);

    await unmount(root);
  });

  it("有序列表行末按 Enter 续号", async () => {
    const { host, root } = await renderPage();
    const el = textarea(host);

    await act(async () => {
      el.setSelectionRange(4, 4);
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await flush();

    expect(el.value).toBe("1. x\n2. ");

    // 光标经 requestAnimationFrame 恢复到新 marker 之后
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(el.selectionStart).toBe("1. x\n2. ".length);
    expect(el.selectionEnd).toBe("1. x\n2. ".length);

    await unmount(root);
  });
});
