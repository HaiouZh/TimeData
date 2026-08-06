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
