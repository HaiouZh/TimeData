// @vitest-environment jsdom
import { createElement, act as reactAct } from "react";
import { flushSync } from "react-dom";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
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
  // 本地 flushSync 版 act 只包住回调的同步部分：mock 的 saveDiary/fetchDiary 等 Promise
  // 在此之后的 resolve/continuation 落在它的作用域之外，React 会报
  // "not wrapped in act(...)"。套一层 React 真正的 act（reactAct）让这段异步收尾也算数。
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

async function renderPage(): Promise<{ host: HTMLElement; root: Root; router: ReturnType<typeof createMemoryRouter> }> {
  // 必须是 data router：DiaryPage 现在用 useUnsavedChangesGuard（内部 useBlocker），
  // 在 <MemoryRouter> 下会抛 "useBlocker must be used within a data router."
  // initialIndex 指向 /diary，让 navigate(-1) 有处可退（退到 /todo）。
  const router = createMemoryRouter(
    [
      { path: "/todo", element: createElement("span", null, "待办页") },
      { path: "/diary", element: createElement(DiaryPage) },
    ],
    { initialEntries: ["/todo", "/diary"], initialIndex: 1 },
  );
  const { host, root } = await renderDom(createElement(RouterProvider, { router }));
  await flush();
  return { host, root, router };
}

// 只有 /diary 一个 entry：模拟书签 / PWA 快捷方式 / 硬刷新直接落地，没有 app 内历史。
// createMemoryRouter 下首个 entry 的 location.key 实测为 "default"（DiaryPage 的
// handleBack 据此判断要不要兜底，而不是盲调 navigate(-1) 落空）。
async function renderPageNoHistory(): Promise<{
  host: HTMLElement;
  root: Root;
  router: ReturnType<typeof createMemoryRouter>;
}> {
  const router = createMemoryRouter(
    [
      { path: "/quick-notes", element: createElement("span", null, "速记页") },
      { path: "/diary", element: createElement(DiaryPage) },
    ],
    { initialEntries: ["/diary"] },
  );
  const { host, root } = await renderDom(createElement(RouterProvider, { router }));
  await flush();
  return { host, root, router };
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

  it("enabled=false 显示未配置提示、无 textarea、不调用 fetchDiary", async () => {
    fetchDiaryConfig.mockResolvedValue({ enabled: false, template: "" });
    const { host, root } = await renderPage();

    expect(host.textContent).toContain("DIARY_VAULT_DIR");
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).not.toContain("正在加载");
    expect(fetchDiary).not.toHaveBeenCalled();

    await unmount(root);
  });

  it("enabled=true 但 template 为空 显示去配模板提示、不调用 fetchDiary", async () => {
    fetchDiaryConfig.mockResolvedValue({ enabled: true, template: "" });
    const { host, root } = await renderPage();

    expect(host.textContent).toContain("还没有配置日记模板");
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).not.toContain("正在加载");
    expect(fetchDiary).not.toHaveBeenCalled();

    await unmount(root);
  });

  it("fetchDiaryConfig reject（离线）显示加载失败态、不卡 loading", async () => {
    fetchDiaryConfig.mockRejectedValue(new Error("网络断开"));
    const { host, root } = await renderPage();

    expect(host.textContent).not.toContain("正在加载");
    expect(host.textContent).toContain("加载失败");
    expect(host.querySelector("textarea")).toBeNull();

    await unmount(root);
  });

  it("脏状态点返回被 blocker 拦下，点取消不导航、编辑内容仍在", async () => {
    fetchDiaryConfig.mockResolvedValue({ enabled: true, template: "日记/{yyyy}/{MM}-{dd}.md" });
    fetchDiary.mockResolvedValue({ content: "原文", mtime: 100 });
    const { host, root, router } = await renderPage();

    await typeInto(textarea(host), "改过的内容");

    const back = host.querySelector('button[aria-label="返回"]');
    if (!(back instanceof HTMLButtonElement)) throw new Error("missing back button");
    await click(back);

    const cancel = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === "继续编辑");
    if (!(cancel instanceof HTMLButtonElement)) throw new Error("missing cancel button");
    await click(cancel);

    expect(router.state.location.pathname).toBe("/diary");
    expect(textarea(host).value).toBe("改过的内容");
    await unmount(root);
  });

  it("无 app 内历史（书签/直接落地）点返回，兜底跳速记页而非 navigate(-1) 空操作", async () => {
    const { host, root, router } = await renderPageNoHistory();

    const back = host.querySelector('button[aria-label="返回"]');
    if (!(back instanceof HTMLButtonElement)) throw new Error("missing back button");
    await click(back);

    expect(router.state.location.pathname).toBe("/quick-notes");
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

  it("脏状态按 Ctrl+S 触发保存并阻止浏览器默认行为", async () => {
    saveDiary.mockResolvedValue({ mtime: 200 });
    const { host, root } = await renderPage();

    await typeInto(textarea(host), "1. y");
    let defaultPrevented = false;
    await act(async () => {
      const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });
    await flush();

    expect(defaultPrevented).toBe(true);
    expect(saveDiary).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), {
      content: "1. y",
      baseMtime: 100,
    });

    await unmount(root);
  });

  it("非脏状态按 Cmd+S 不触发保存但仍阻止默认行为", async () => {
    const { host, root } = await renderPage();

    let defaultPrevented = false;
    await act(async () => {
      const event = new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });
    await flush();

    expect(defaultPrevented).toBe(true);
    expect(saveDiary).not.toHaveBeenCalled();
    expect(host.querySelector("textarea")).not.toBeNull();

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

  it("execCommand 不可用时回车续号仍把文档标脏（保存按钮亮起）", async () => {
    // jsdom 没有 execCommand ⇒ applyEdit 判 unsupported ⇒ 走 setValue 降级路径，
    // 而降级不经 onChange，dirty 只能由 runEditAction 显式补。漏了它保存按钮永远是灰的。
    const { host, root } = await renderPage();
    const el = textarea(host);
    const save = host.querySelector('button[aria-label="保存"]');
    if (!(save instanceof HTMLButtonElement)) throw new Error("missing save button");

    expect(save.disabled).toBe(true); // 刚加载完，未改动

    await act(async () => {
      el.setSelectionRange(4, 4);
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await flush();

    expect(el.value).toBe("1. x\n2. ");
    expect(save.disabled).toBe(false);

    await unmount(root);
  });

  it("IME 组合态按 Tab 不触发缩进（守卫在 handleKeyDown 顶部，Enter/Tab/未来键位共用）", async () => {
    const { host, root } = await renderPage();
    const el = textarea(host);

    let defaultPrevented = false;
    await act(async () => {
      el.setSelectionRange(4, 4);
      const event = new KeyboardEvent("keydown", { key: "Tab", isComposing: true, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });
    await flush();

    expect(defaultPrevented).toBe(false);
    expect(el.value).toBe("1. x"); // 未被 applyIndent 处理，值原样不动

    await unmount(root);
  });

  it("顶层列表行按 Shift+Tab 返回 null，交还浏览器焦点跳走（唯一逃生口，不 preventDefault）", async () => {
    const { host, root } = await renderPage();
    const el = textarea(host);

    let defaultPrevented = false;
    await act(async () => {
      el.setSelectionRange(4, 4); // "1. x" 顶层，光标在行尾
      const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });
    await flush();

    expect(defaultPrevented).toBe(false);
    expect(el.value).toBe("1. x");

    await unmount(root);
  });

  it("回车出新项后按 Tab 真的缩进（Enter→Tab 最高频路径，接线闸）", async () => {
    // 上面两条 jsdom 接线测试断言的都是"什么都没发生"（IME 不触发 / 顶层 Shift+Tab 不
    // preventDefault），把 handleKeyDown 里整个 Tab 分支删掉这两条依然成立——接线可以完全
    // 断线而这两条测试测不出来。这条正测走一次真实会落地的 Enter→Tab 编辑，断言最终 DOM 值。
    const { host, root } = await renderPage();
    const el = textarea(host);
    const save = host.querySelector('button[aria-label="保存"]');
    if (!(save instanceof HTMLButtonElement)) throw new Error("missing save button");

    await act(async () => {
      el.setSelectionRange(4, 4);
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await flush();
    expect(el.value).toBe("1. x\n2. ");

    let prevented = false;
    await act(async () => {
      el.setSelectionRange(8, 8);
      const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      prevented = ev.defaultPrevented;
    });
    await flush();

    expect(prevented).toBe(true);
    expect(el.value).toBe("1. x\n\t1. ");
    expect(save.disabled).toBe(false);

    await unmount(root);
  });

  it("IME 组合态按 Ctrl+K 不触发补链接（守卫在 handleKeyDown 顶部，与 Tab/Enter 共用）", async () => {
    const { host, root } = await renderPage();
    const el = textarea(host);

    let defaultPrevented = false;
    await act(async () => {
      el.setSelectionRange(4, 4);
      const event = new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });
    await flush();

    expect(defaultPrevented).toBe(false);
    expect(el.value).toBe("1. x"); // 未被 applyLinkShortcut 处理，值原样不动

    await unmount(root);
  });

  it("无选区按 Ctrl+K 插入 markdown 链接骨架并置 dirty（接线正测：真按键、真产出、真变脏）", async () => {
    // 上面的 IME 测试断言的是"什么都没发生"——把 DiaryPage.tsx 里整个 Ctrl+K 分支删掉，
    // 那条测试依然成立，接线可以完全断线而测不出来。这条正测走一次真实会落地的编辑，
    // 断言最终 DOM 值与 dirty 态，是本任务"接线必须有正测"的硬要求。
    const { host, root } = await renderPage();
    const el = textarea(host);
    const save = host.querySelector('button[aria-label="保存"]');
    if (!(save instanceof HTMLButtonElement)) throw new Error("missing save button");

    expect(save.disabled).toBe(true); // 刚加载完，未改动

    let prevented = false;
    await act(async () => {
      el.setSelectionRange(4, 4); // "1. x" 行尾，无选区
      const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      prevented = event.defaultPrevented;
    });
    await flush();

    expect(prevented).toBe(true);
    expect(el.value).toBe("1. x[]()");
    expect(save.disabled).toBe(false);

    // 光标经 requestAnimationFrame 恢复到方括号之间（jsdom 无 execCommand，走 setValue 降级路径）
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(el.selectionStart).toBe(5);
    expect(el.selectionEnd).toBe(5);

    await unmount(root);
  });

  it("光标落在已有链接上按 Ctrl+K 只挪光标去 URL 段，不调 applyEdit、不置 dirty（select 分支）", async () => {
    fetchDiary.mockResolvedValue({ content: "[标题](https://a.com)", mtime: 100 });
    const { host, root } = await renderPage();
    const el = textarea(host);
    const save = host.querySelector('button[aria-label="保存"]');
    if (!(save instanceof HTMLButtonElement)) throw new Error("missing save button");

    expect(save.disabled).toBe(true);

    let prevented = false;
    await act(async () => {
      el.setSelectionRange(2, 2); // 光标落在链接文本"标题"里
      const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      prevented = event.defaultPrevented;
    });
    await flush();

    expect(prevented).toBe(true);
    expect(el.value).toBe("[标题](https://a.com)"); // 一字未变
    expect(save.disabled).toBe(true); // 不置 dirty：用户只是想改地址，一个字没改不该变脏
    // select 分支同步调用 setSelectionRange，不经 requestAnimationFrame 降级路径
    expect(el.selectionStart).toBe(5);
    expect(el.selectionEnd).toBe(18);

    await unmount(root);
  });

  it("Ctrl+Alt+K 不触发补链接（AltGr 在部分键盘布局等价 Ctrl+Alt，必须放行）", async () => {
    const { host, root } = await renderPage();
    const el = textarea(host);

    let defaultPrevented = false;
    await act(async () => {
      el.setSelectionRange(4, 4);
      const event = new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });
    await flush();

    expect(defaultPrevented).toBe(false);
    expect(el.value).toBe("1. x");

    await unmount(root);
  });

  it("Ctrl+Shift+K 不触发补链接", async () => {
    const { host, root } = await renderPage();
    const el = textarea(host);

    let defaultPrevented = false;
    await act(async () => {
      el.setSelectionRange(4, 4);
      const event = new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });
    await flush();

    expect(defaultPrevented).toBe(false);
    expect(el.value).toBe("1. x");

    await unmount(root);
  });

  it("Cmd+K（metaKey）与 Ctrl+K 同结果：mac 上功能唯一可用的路径，不能只靠 ctrlKey 判定", async () => {
    const { host, root } = await renderPage();
    const el = textarea(host);

    let prevented = false;
    await act(async () => {
      el.setSelectionRange(4, 4);
      const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      prevented = event.defaultPrevented;
    });
    await flush();

    expect(prevented).toBe(true);
    expect(el.value).toBe("1. x[]()");

    await unmount(root);
  });
});
