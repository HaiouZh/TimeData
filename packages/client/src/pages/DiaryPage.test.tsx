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

async function renderPage(
  entry = "/diary",
): Promise<{ host: HTMLElement; root: Root; router: ReturnType<typeof createMemoryRouter> }> {
  // 必须是 data router：DiaryPage 现在用 useUnsavedChangesGuard（内部 useBlocker），
  // 在 <MemoryRouter> 下会抛 "useBlocker must be used within a data router."
  // initialIndex 指向 /diary，让 navigate(-1) 有处可退（退到 /todo）。
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

// 冲突条、ConfirmSheet、DateNav 的「回到今天」都是无 aria-label 的文本按钮
function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
  const found = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === text);
  return found instanceof HTMLButtonElement ? found : null;
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
  // 固定"今天"，日期断言才能写死。绝不能用 vi.useFakeTimers()——本文件的 flush()
  // 靠 10 个真实 setTimeout(0) 推进，开假时钟它们永不触发，整个文件挂死（超时不是变红）。
  // 实测 vitest 4.1.8 下 setSystemTime 无需 useFakeTimers，且 setTimeout 保持真实。
  vi.setSystemTime(new Date("2026-07-25T10:00:00+08:00"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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

  it("保存成功且期间无编辑：脏标记照常清除，保存按钮变灰", async () => {
    // 与下一条互为反面：没有这条，"永不清脏"式的假修复也能让下一条变绿。
    saveDiary.mockResolvedValue({ mtime: 200 });
    const { host, root } = await renderPage();
    const save = host.querySelector('button[aria-label="保存"]');
    if (!(save instanceof HTMLButtonElement)) throw new Error("missing save button");

    await typeInto(textarea(host), "1. y");
    expect(save.disabled).toBe(false);

    await click(save);

    expect(save.disabled).toBe(true);

    await unmount(root);
  });

  it("保存在途中继续打字：回来不清脏标记，那段内容仍能保存出去", async () => {
    // 无条件 setDirty(false) 会把这段从未上传的内容的脏标记一起抹掉——保存按钮变灰、
    // useUnsavedChangesGuard 也不再拦截，换页即静默丢数据。
    let resolveSave!: (value: { mtime: number }) => void;
    saveDiary.mockImplementationOnce(
      () =>
        new Promise<{ mtime: number }>((resolve) => {
          resolveSave = resolve;
        }),
    );
    saveDiary.mockResolvedValueOnce({ mtime: 300 });
    const { host, root } = await renderPage();
    const el = textarea(host);
    const save = host.querySelector('button[aria-label="保存"]');
    if (!(save instanceof HTMLButtonElement)) throw new Error("missing save button");

    await typeInto(el, "1. 第一版");
    await click(save);
    expect(saveDiary).toHaveBeenCalledTimes(1);

    // 请求还挂在途中，用户继续打字
    await typeInto(el, "1. 第一版\n2. 在途中补的");
    await act(async () => {
      resolveSave({ mtime: 200 });
    });
    await flush();

    expect(save.disabled).toBe(false);
    expect(el.value).toBe("1. 第一版\n2. 在途中补的");

    // 再点一次保存，这段内容真的上传得出去（baseMtime 用上一发返回的新值）
    await click(save);
    expect(saveDiary).toHaveBeenLastCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), {
      content: "1. 第一版\n2. 在途中补的",
      baseMtime: 200,
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

  it("刷新重载失败：出条状错误提示，保留本地编辑与冲突条，不打成全屏加载失败态", async () => {
    // 没有 try/catch 时这里除了"页面毫无反应"，还会真产生一条 unhandled rejection（vitest 会抓）。
    saveDiary.mockRejectedValueOnce(new DiaryConflictError(150));
    const { host, root } = await renderPage();

    await typeInto(textarea(host), "1. local edit");
    await click(host.querySelector('button[aria-label="保存"]'));

    const reloadButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "刷新重载",
    );
    expect(reloadButton).toBeInstanceOf(HTMLButtonElement);

    fetchDiary.mockRejectedValue(new Error("网络断开"));
    await click(reloadButton ?? null);
    const confirmDiscard = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "确认",
    );
    expect(confirmDiscard).toBeInstanceOf(HTMLButtonElement);
    await click(confirmDiscard ?? null);

    expect(host.textContent).toContain("网络断开");
    expect(host.textContent).not.toContain("加载失败，请检查网络后重试");
    expect(textarea(host).value).toBe("1. local edit");
    expect(host.textContent).toContain("日记已被其他窗口修改");

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

  it("加载路径：CRLF 文件保存时按探测到的行尾还原，不静默改写成 LF", async () => {
    // jsdom 忠实实现 HTML 规范：textarea.value 会把 CRLF 归一成 LF，本条断言的是
    // handleSave 组装请求体时是否把它转回去——不是"什么都没发生"式的裸奔测试。
    fetchDiary.mockResolvedValue({ content: "1. a\r\n2. b", mtime: 100 });
    saveDiary.mockResolvedValue({ mtime: 200 });
    const { host, root } = await renderPage();
    const el = textarea(host);

    // textarea 读回的是归一后的 LF 版本：\r 已经不在了，证明丢失点确实在这里
    expect(el.value).toBe("1. a\n2. b");

    await typeInto(el, "1. a\n2. b\n3. c");
    await click(host.querySelector('button[aria-label="保存"]'));

    expect(saveDiary).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), {
      content: "1. a\r\n2. b\r\n3. c",
      baseMtime: 100,
    });

    await unmount(root);
  });

  it("handleReload 路径：刷新重载拿到新文件的行尾后，再保存按新行尾还原（最容易漏的写入点）", async () => {
    // 先以 LF 文件加载并触发一次冲突态（进入 handleReload 分支需要冲突条 UI），
    // 点「刷新重载」后 fetchDiary 改为返回 CRLF 内容——若 eolRef 没有在 handleReload
    // 里更新，会仍按 LF（旧值）写回，这条断言就会假绿地失败。
    saveDiary.mockRejectedValueOnce(new DiaryConflictError(150));
    saveDiary.mockResolvedValueOnce({ mtime: 300 });
    const { host, root } = await renderPage();
    const el = textarea(host);

    await typeInto(el, "1. y");
    await click(host.querySelector('button[aria-label="保存"]'));

    const reloadButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "刷新重载",
    );
    expect(reloadButton).toBeInstanceOf(HTMLButtonElement);

    // 「刷新重载」会先弹脏态确认（ConfirmSheet 默认 confirmLabel="确认"）
    fetchDiary.mockResolvedValue({ content: "1. p\r\n2. q", mtime: 400 });
    await click(reloadButton ?? null);
    const confirmDiscard = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "确认",
    );
    expect(confirmDiscard).toBeInstanceOf(HTMLButtonElement);
    await click(confirmDiscard ?? null);

    expect(el.value).toBe("1. p\n2. q");

    await typeInto(el, "1. p\n2. q\n3. r");
    await click(host.querySelector('button[aria-label="保存"]'));

    expect(saveDiary).toHaveBeenLastCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), {
      content: "1. p\r\n2. q\r\n3. r",
      baseMtime: 400,
    });

    await unmount(root);
  });

  it("URL 带 ?date= 时加载并保存到该日期，而不是今天", async () => {
    const { host, root } = await renderPage("/diary?date=2026-07-20");

    expect(fetchDiary).toHaveBeenCalledWith("2026-07-20");

    await typeInto(textarea(host), "补写 7/20");
    await click(host.querySelector('button[aria-label="保存"]'));

    expect(saveDiary).toHaveBeenCalledWith("2026-07-20", expect.objectContaining({ content: "补写 7/20" }));
    await unmount(root);
  });

  it("?date= 非法时落回今天，并把 URL 上的坏参数归一掉", async () => {
    // 2026-02-31 正则挡不住、V8 会静默滚动到 3 月 3 日，必须落回今天而不是"3月3日"
    const { root, router } = await renderPage("/diary?date=2026-02-31");

    expect(fetchDiary).toHaveBeenCalledWith("2026-07-25");
    expect(router.state.location.search).toBe("");
    await unmount(root);
  });

  it("?date= 恰是今天时归一成无参 URL，与裸 /diary 完全一致", async () => {
    const { root, router } = await renderPage("/diary?date=2026-07-25");

    expect(router.state.location.search).toBe("");
    expect(fetchDiary).toHaveBeenCalledWith("2026-07-25");
    // 归一用的是 { replace: true }，不应新增历史条目：用变异验证过——把实现改成默认 push，
    // 这条断言会从 "REPLACE" 变成 "PUSH" 而变红（见 Task 报告的证伪记录）。
    expect(router.state.historyAction).toBe("REPLACE");
    await unmount(root);
  });

  it("切日期只重拉正文，不重拉 config", async () => {
    const { root, router } = await renderPage();
    expect(fetchDiaryConfig).toHaveBeenCalledTimes(1);

    await navigateTo(router, "/diary?date=2026-07-20");

    expect(fetchDiary).toHaveBeenLastCalledWith("2026-07-20");
    // config 与日期无关。不拆 effect 的话这里是 2，且每切一天都多一次"config 失败→整页挂掉"的机会
    expect(fetchDiaryConfig).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("上一天加载失败后切日期，新一天正常显示正文而不是继续卡在全屏失败态", async () => {
    // loadFailed 全文只有置 true 的地方，从没有置 false 的——不重置的话一次失败就永久全屏失败
    fetchDiary.mockRejectedValueOnce(new Error("离线"));
    const { host, root, router } = await renderPage();
    expect(host.textContent).toContain("加载失败");

    fetchDiary.mockResolvedValue({ content: "7/20 的正文", mtime: 200 });
    await navigateTo(router, "/diary?date=2026-07-20");

    expect(textarea(host).value).toBe("7/20 的正文");
    expect(host.textContent).not.toContain("加载失败");
    await unmount(root);
  });

  it("上一天的冲突条不会带进新一天（否则「仍然覆盖」会 force 掉新一天的文件）", async () => {
    const { host, root, router } = await renderPage();
    await typeInto(textarea(host), "本地改动");
    saveDiary.mockRejectedValueOnce(new DiaryConflictError(300));
    await click(host.querySelector('button[aria-label="保存"]'));
    expect(host.textContent).toContain("日记已被其他窗口修改");

    await navigateTo(router, "/diary?date=2026-07-20");

    expect(host.textContent).not.toContain("日记已被其他窗口修改");
    await unmount(root);
  });

  it("切日期期间不把上一天的正文留在编辑器里（loading 必须重新亮起）", async () => {
    // 不置 loading=true 的话，旧内容原地留着直到新内容到达，
    // 用户可能对着上一天的正文打字，然后被 setContent 静默覆盖
    const { host, root, router } = await renderPage();
    expect(textarea(host).value).toBe("1. x");

    let releaseFetch: (value: { content: string; mtime: number }) => void = () => {};
    fetchDiary.mockImplementationOnce(
      () => new Promise((resolve) => { releaseFetch = resolve; }),
    );
    await navigateTo(router, "/diary?date=2026-07-20");

    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).toContain("正在加载");

    await act(async () => { releaseFetch({ content: "7/20 的正文", mtime: 200 }); });
    await flush();
    expect(textarea(host).value).toBe("7/20 的正文");
    await unmount(root);
  });

  it("切日期期间（loading 未落地）按 Ctrl+S 不写入——B 日的 loading 窗口期不能把 A 日残留内容存进 B 日文件", async () => {
    // 复现的失败场景：A 日打字未保存 → 切到 B 日 → B 日 fetchDiary 还在飞（loading=true，
    // textarea 已卸载）→ 此时按 Ctrl+S。Ctrl+S 挂在 window 上不经过 textarea，"textarea 已
    // 卸载所以用户碰不到"是错的假设。此前 handleSave 没有 loading 早退，会把 content 里 A 日
    // 残留的正文，连同已被日期 effect 清成 null 的 baseMtime，一起写进 B 日的文件——服务端
    // mtime 并发守卫拿 null 当"文件不存在"直接放行，不报冲突，静默写坏 B 日文件。
    const { host, root, router } = await renderPage();

    await typeInto(textarea(host), "A 日未保存的编辑");

    let releaseFetch: (value: { content: string; mtime: number }) => void = () => {};
    fetchDiary.mockImplementationOnce(() => new Promise((resolve) => { releaseFetch = resolve; }));
    await navigateTo(router, "/diary?date=2026-07-20");

    // B 日仍在飞：textarea 已卸载，页面显示"正在加载"
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).toContain("正在加载");

    let defaultPrevented = false;
    await act(async () => {
      const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });
    await flush();

    expect(defaultPrevented).toBe(true); // 仍要拦掉浏览器"保存网页"对话框
    expect(saveDiary).not.toHaveBeenCalled();

    // 收尾：放行挂起的 fetch，避免留下悬空 Promise
    await act(async () => {
      releaseFetch({ content: "7/20 的正文", mtime: 200 });
    });
    await flush();
    await unmount(root);
  });

  it("切日期后 fetchDiary 失败（loadFailed 态）：保存按钮变灰、Ctrl+S 也不触发保存，A 日残留内容不会被静默写进 B 日文件", async () => {
    // 与 loading 早退是同一个根因的两个窗口，只挡 loading 不够：loadFailed=true 时 loading
    // 已经是 false，content 仍是 A 日残留、baseMtime 已被日期 effect 清成 null。此前的实现
    // 只挡 loading，这里点保存或按 Ctrl+S 会把 A 日内容静默写进 B 日文件——baseMtime=null
    // 还会被服务端 mtime 并发守卫当成"文件不存在"直接放行，连假冲突提示都不会有。
    // （复审已实测：给旧版本这条测试加一行 `expect(saveDiary).toHaveBeenCalledWith("2026-07-20",
    // expect.objectContaining({ content: "A 日未保存的编辑" }))` 会通过，坐实过写穿。）
    const { host, root, router } = await renderPage();

    await typeInto(textarea(host), "A 日未保存的编辑");

    fetchDiary.mockRejectedValueOnce(new Error("离线"));
    await navigateTo(router, "/diary?date=2026-07-20");

    expect(host.textContent).toContain("加载失败");
    const save = host.querySelector('button[aria-label="保存"]');
    if (!(save instanceof HTMLButtonElement)) throw new Error("missing save button");
    expect(save.disabled).toBe(true); // loadFailed 必须单独挡下，不能只看 loading

    // Ctrl+S 挂在 window 上，不经过按钮的 disabled，必须在 handleSave 里也显式挡住
    let defaultPrevented = false;
    await act(async () => {
      const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });
    await flush();

    expect(defaultPrevented).toBe(true); // 仍要拦掉浏览器"保存网页"对话框
    expect(saveDiary).not.toHaveBeenCalled();

    await unmount(root);
  });

  it("fetchDiaryConfig 挂起时不提前判定“还没有配置日记模板”/未启用，仍显示正在加载", async () => {
    // configLoaded 早退闸防的是：template 初值是 ""，若日期 effect 不等 config 落地就跑，
    // 会拿着初值 template="" 判成"还没有配置日记模板"，闪一下错误分支再变回正确内容。
    // 现有测试测不出来是因为所有断言都在 flush()（10 个真实 setTimeout(0)）之后才做，
    // 那时 config 早就 resolve 了——这条测试把 fetchDiaryConfig 挂起，钉住这个时序窗口。
    let releaseConfig: (value: { enabled: boolean; template: string }) => void = () => {};
    fetchDiaryConfig.mockImplementationOnce(() => new Promise((resolve) => { releaseConfig = resolve; }));
    const { host, root } = await renderPage();

    expect(host.textContent).not.toContain("还没有配置日记模板");
    expect(host.textContent).not.toContain("服务器未配置日记 vault");
    expect(host.textContent).toContain("正在加载");

    await act(async () => {
      releaseConfig({ enabled: true, template: "1. " });
    });
    await flush();
    await unmount(root);
  });

  it("点「前一天」加载前一天的日记", async () => {
    const { host, root, router } = await renderPage();

    await click(host.querySelector('button[aria-label="前一天"]'));

    expect(fetchDiary).toHaveBeenLastCalledWith("2026-07-24");
    expect(router.state.location.search).toBe("?date=2026-07-24");
    await unmount(root);
  });

  it("脏态下切日期先弹确认，点「继续编辑」不切且本地修改仍在", async () => {
    // useUnsavedChangesGuard 只比 pathname，?date= 变化它一概不拦——不自己弹就是静默丢数据
    const { host, root, router } = await renderPage();
    await typeInto(textarea(host), "还没保存的内容");
    fetchDiary.mockClear();

    await click(host.querySelector('button[aria-label="前一天"]'));
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await click(buttonByText(host, "继续编辑"));

    expect(fetchDiary).not.toHaveBeenCalled();
    expect(textarea(host).value).toBe("还没保存的内容");
    expect(router.state.location.search).toBe("");
    await unmount(root);
  });

  it("脏态下切日期点「放弃修改」才真的切过去", async () => {
    const { host, root } = await renderPage();
    await typeInto(textarea(host), "还没保存的内容");
    fetchDiary.mockResolvedValue({ content: "7/24 的正文", mtime: 200 });

    await click(host.querySelector('button[aria-label="前一天"]'));
    await click(buttonByText(host, "放弃修改"));

    expect(fetchDiary).toHaveBeenLastCalledWith("2026-07-24");
    expect(textarea(host).value).toBe("7/24 的正文");
    await unmount(root);
  });

  it("从历史日期点「回到今天」清掉 URL 参数，回到跟随模式", async () => {
    const { host, root, router } = await renderPage("/diary?date=2026-07-20");

    await click(buttonByText(host, "回到今天"));

    expect(router.state.location.search).toBe("");
    expect(fetchDiary).toHaveBeenLastCalledWith("2026-07-25");
    await unmount(root);
  });

  it("标题不再重复日期（DateNav 已经在显示）", async () => {
    const { host, root } = await renderPage("/diary?date=2026-07-20");

    const heading = host.querySelector("h1");
    expect(heading?.textContent).toBe("日记");
    expect(host.querySelector('button[aria-label="前一天"]')).not.toBeNull();
    await unmount(root);
  });
});
