// @vitest-environment jsdom
import { act, createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import { renderDom } from "../test/domHarness.js";
import { CaptureApp } from "./CaptureApp.js";
import { readCaptureDraft, writeCaptureDraft } from "./captureDraft.js";

describe("CaptureApp 骨架", () => {
  it("渲染一个自动聚焦的输入框", async () => {
    const { host } = await renderDom(createElement(CaptureApp));
    const input = host.querySelector("textarea");
    expect(input).not.toBeNull();
    expect(input?.getAttribute("aria-label")).toBe("速记浮窗输入框");
    expect(document.activeElement).toBe(input);
  });

  it("不渲染打点反馈层——浮窗挂第二个热键桥会让一次打点落两条记录", async () => {
    const { host } = await renderDom(createElement(CaptureApp));
    expect(host.querySelector('[data-testid="desktop-punch-layer"]')).toBeNull();
  });
});

beforeEach(async () => {
  await resetDb();
  localStorage.clear();
});

async function type(input: HTMLTextAreaElement, text: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressEnter(input: HTMLTextAreaElement, shift = false): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: shift, bubbles: true }));
  });
}

async function pressEscape(input: HTMLTextAreaElement): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

describe("CaptureApp 存入状态机", () => {
  it("回车把字落进库，然后闪「已记下」", async () => {
    const { host } = await renderDom(createElement(CaptureApp));
    const input = host.querySelector("textarea")!;
    await type(input, "买牛奶");
    await pressEnter(input);

    const notes = await db.quickNotes.toArray();
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe("买牛奶");
    // 真库写路径的续体落在 act 之外（fake-indexeddb 用 setImmediate 排程，act 只等微任务），
    // React 的提交被推迟到下一次 act；这里显式冲刷一次再断言 DOM。
    await act(async () => {});
    expect(host.textContent).toContain("已记下");
  });

  it("Shift+Enter 是换行，不存", async () => {
    const { host } = await renderDom(createElement(CaptureApp));
    const input = host.querySelector("textarea")!;
    await type(input, "第一行");
    await pressEnter(input, true);
    expect(await db.quickNotes.count()).toBe(0);
  });

  it("空白内容不存", async () => {
    const { host } = await renderDom(createElement(CaptureApp));
    const input = host.querySelector("textarea")!;
    await type(input, "   ");
    await pressEnter(input);
    expect(await db.quickNotes.count()).toBe(0);
  });

  it("存失败：窗口不收起、红字报错、字留在框里", async () => {
    const onHide = vi.fn();
    const save = vi.fn(async () => {
      throw new Error("库满了");
    });
    const { host } = await renderDom(createElement(CaptureApp, { onHide, save }));
    const input = host.querySelector("textarea")!;
    await type(input, "会失败的");
    await pressEnter(input);

    expect(host.textContent).toContain("库满了");
    expect(input.value).toBe("会失败的");
    expect(onHide).not.toHaveBeenCalled();
  });

  it("saving 中忽略重复回车——不串行化会写出多条重复速记", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const save = vi.fn(async () => {
      await gate;
    });
    const { host } = await renderDom(createElement(CaptureApp, { save }));
    const input = host.querySelector("textarea")!;
    await type(input, "只该存一次");
    await pressEnter(input);
    await pressEnter(input);
    await pressEnter(input);
    await act(async () => {
      release();
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saving 中按 Esc 不收窗口——结果没出来就走会留下「以为没存其实存了」", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const onHide = vi.fn();
    const { host } = await renderDom(createElement(CaptureApp, { onHide, save: async () => gate }));
    const input = host.querySelector("textarea")!;
    await type(input, "写着呢");
    await pressEnter(input);
    await pressEscape(input);
    expect(onHide).not.toHaveBeenCalled();
    await act(async () => {
      release();
    });
  });

  it("idle 下按 Esc 收窗口，但草稿留着", async () => {
    const onHide = vi.fn();
    const { host } = await renderDom(createElement(CaptureApp, { onHide }));
    const input = host.querySelector("textarea")!;
    await type(input, "打了一半");
    await pressEscape(input);
    expect(onHide).toHaveBeenCalledOnce();
    expect(readCaptureDraft()).toBe("打了一半");
  });

  // 终审 L1/L6 抓到的 Critical 的闸：生产的 main.tsx 渲染的是无 prop 的 <CaptureApp />，
  // 而收窗口的两条路当时都写成 onHide?.()——onHide 恒 undefined，两条全是空操作。
  // 全部既有用例都注入了 mock onHide，所以 3722 条测试一条没红。
  it("不传 onHide 时按 Esc 走真壳的 hide_capture_window——浮窗没有关闭按钮，这是唯一的收起路径", async () => {
    const invoke = vi.fn(async () => undefined as never);
    const listen = vi.fn(async () => () => {});
    const { host } = await renderDom(createElement(CaptureApp, { io: { listen, invoke } }));
    const input = host.querySelector("textarea")!;
    await pressEscape(input);
    expect(invoke).toHaveBeenCalledWith("hide_capture_window");
  });

  it("不传 onHide 时存完闪完也走 hide_capture_window", async () => {
    vi.useFakeTimers();
    try {
      const invoke = vi.fn(async () => undefined as never);
      const listen = vi.fn(async () => () => {});
      const save = vi.fn(async () => {});
      const { host } = await renderDom(
        createElement(CaptureApp, { io: { listen, invoke }, save, savedFlashMs: 500 }),
      );
      const input = host.querySelector("textarea")!;
      await type(input, "存完就走");
      await pressEnter(input);
      expect(invoke).not.toHaveBeenCalledWith("hide_capture_window");
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(invoke).toHaveBeenCalledWith("hide_capture_window");
    } finally {
      vi.useRealTimers();
    }
  });

  it("输入法组合中的回车不提交——它是确认候选词，吃掉会拿组合前的旧文本落库", async () => {
    const save = vi.fn(async () => {});
    const { host } = await renderDom(createElement(CaptureApp, { save }));
    const input = host.querySelector("textarea")!;
    await type(input, "买牛");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
    });
    expect(save).not.toHaveBeenCalled();
    expect(input.value).toBe("买牛");
  });

  it("输入法组合中的 Esc 不收窗口——它是取消候选词，不是关窗", async () => {
    const onHide = vi.fn();
    const { host } = await renderDom(createElement(CaptureApp, { onHide }));
    const input = host.querySelector("textarea")!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }));
    });
    expect(onHide).not.toHaveBeenCalled();
  });

  it("saving 中输入框只读——放行输入会解除「忽略重复回车」的闸，而写完的续体会清掉在途文字", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { host } = await renderDom(createElement(CaptureApp, { save: async () => gate }));
    const input = host.querySelector("textarea")!;
    await type(input, "写着呢");
    await pressEnter(input);
    expect(input.readOnly).toBe(true);
    await act(async () => {
      release();
    });
    expect(input.readOnly).toBe(false);
  });

  it("saving 中即便有输入落进来，status 也不许被打回 idle（readOnly 之外的第二道防线）", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const save = vi.fn(async () => {
      await gate;
    });
    const { host } = await renderDom(createElement(CaptureApp, { save }));
    const input = host.querySelector("textarea")!;
    await type(input, "只该存一次");
    await pressEnter(input);
    // 绕过 readOnly 直接触发受控 onChange，模拟「输入还是进来了」
    await type(input, "只该存一次啦");
    await pressEnter(input);
    await act(async () => {
      release();
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("唤起时把上次的草稿填回去，光标置末", async () => {
    writeCaptureDraft("上次没写完");
    const { host } = await renderDom(createElement(CaptureApp));
    const input = host.querySelector("textarea")!;
    expect(input.value).toBe("上次没写完");
    expect(input.selectionStart).toBe("上次没写完".length);
  });

  it("存成功后清草稿、清输入框，闪完通知外部收起", async () => {
    vi.useFakeTimers();
    try {
      const onHide = vi.fn();
      // 假定时器下不接真库：fake-indexeddb 走真实 setImmediate（jsdom 沙箱外），绕开假时钟后
      // 事务完成时机与 act 相互纠缠、不可确定；真库路径已由上一条用例覆盖，这里专注闪完收起的行为。
      const save = vi.fn(async () => {});
      const { host } = await renderDom(createElement(CaptureApp, { onHide, save, savedFlashMs: 500 }));
      const input = host.querySelector("textarea")!;
      await type(input, "存完就走");
      await pressEnter(input);
      expect(onHide).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(onHide).toHaveBeenCalledOnce();
      expect(input.value).toBe("");
      expect(readCaptureDraft()).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CaptureApp 热键接线", () => {
  it("挂监听在报 desktop_ready 之前——顺序颠倒时排队补投的按键会打在没听众的窗口上", async () => {
    const calls: string[] = [];
    const listen = vi.fn(async () => {
      calls.push("listen");
      return () => {};
    });
    const invoke = vi.fn(async (cmd: string) => {
      calls.push(cmd);
      return undefined as never;
    });
    await renderDom(createElement(CaptureApp, { io: { listen, invoke } }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toEqual(["listen", "desktop_ready"]);
  });

  it("收到 capture 事件时重新聚焦并把光标置末；punch 事件一概不理", async () => {
    const handlers: ((event: { action: string; pressedAtMs: number }) => void)[] = [];
    const listen = vi.fn(async (handler: (event: { action: string; pressedAtMs: number }) => void) => {
      handlers.push(handler);
      return () => {};
    });
    writeCaptureDraft("上次的");
    const { host } = await renderDom(
      createElement(CaptureApp, { io: { listen, invoke: async () => undefined as never } }),
    );
    const input = host.querySelector("textarea")!;
    input.blur();

    await act(async () => {
      handlers[0]({ action: "punch", pressedAtMs: 1 });
    });
    expect(document.activeElement).not.toBe(input);

    await act(async () => {
      handlers[0]({ action: "capture", pressedAtMs: 2 });
    });
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe("上次的".length);
  });

  it("卸载时取消监听，不泄漏", async () => {
    const unlisten = vi.fn();
    const listen = vi.fn(async () => unlisten);
    const { root } = await renderDom(
      createElement(CaptureApp, { io: { listen, invoke: async () => undefined as never } }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      root.unmount();
    });
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
