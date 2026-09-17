// @vitest-environment jsdom
import { act, createElement } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider } from "../contexts/BottomNavContext.js";
import { renderDom, unmount } from "../test/domHarness.js";

const getPlatformMock = vi.hoisted(() => vi.fn((): string => "android"));
const addListenerMock = vi.hoisted(() => vi.fn());
const stashMock = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: getPlatformMock } }));
vi.mock("@capacitor/keyboard", () => ({ Keyboard: { addListener: addListenerMock } }));
vi.mock("../lib/recovery/pendingReports.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/recovery/pendingReports.js")>();
  return { ...actual, stashPendingReport: stashMock };
});

import { KeyboardProbe } from "./KeyboardProbe.js";

type NativeHandlers = Record<string, (info?: { keyboardHeight: number }) => void>;

function captureNative(): NativeHandlers {
  const handlers: NativeHandlers = {};
  addListenerMock.mockImplementation((name: string, cb: NativeHandlers[string]) => {
    handlers[name] = cb;
    return Promise.resolve({ remove: vi.fn() });
  });
  return handlers;
}

/** 探针 + 一个带 data-kbd-dock 的驻坞条壳（里面一个 input）+ 一个页面里的 input。 */
function renderProbe() {
  return renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: ["/todo"] },
      createElement(
        BottomNavProvider,
        null,
        createElement(
          "div",
          null,
          createElement(KeyboardProbe),
          createElement("div", { "data-kbd-dock": "1" }, createElement("input", { "data-testid": "dock-input" })),
          createElement("input", { "data-testid": "page-input" }),
        ),
      ),
    ),
  );
}

function readDetail(callIndex = 0): Record<string, unknown> {
  const call = stashMock.mock.calls[callIndex] as [{ action: string; detail?: string }] | undefined;
  return JSON.parse(call?.[0].detail ?? "{}") as Record<string, unknown>;
}

describe("KeyboardProbe 接线", () => {
  let nowMs = 1000;
  beforeEach(() => {
    localStorage.clear();
    stashMock.mockReset();
    nowMs = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    // rAF 立即回调并前进 18ms：首帧延迟可测
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      nowMs += 18;
      cb(nowMs);
      return 1;
    });
    getPlatformMock.mockReturnValue("android");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("开关开着：聚焦驻坞条输入框 → 插件事件 → dock transition → 落一条 kbd_session（in=dock，ff 有值，r=/todo）", async () => {
    localStorage.setItem("timedata_keyboard_probe", JSON.stringify({ on: true, left: 20 }));
    const native = captureNative();
    const { host, root } = await renderProbe();
    const dock = host.querySelector("[data-kbd-dock]") as HTMLElement;
    const input = host.querySelector('[data-testid="dock-input"]') as HTMLInputElement;

    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      nowMs += 200;
      native.keyboardWillShow?.({ keyboardHeight: 300 });
      dock.dispatchEvent(new Event("transitionstart", { bubbles: true }));
      nowMs += 250;
      native.keyboardDidShow?.({ keyboardHeight: 300 });
      dock.dispatchEvent(new Event("transitionend", { bubbles: true }));
      nowMs += 1000;
      native.keyboardWillHide?.();
      nowMs += 250;
      native.keyboardDidHide?.();
    });

    expect(stashMock).toHaveBeenCalledTimes(1);
    expect((stashMock.mock.calls[0] as [{ action: string }])[0].action).toBe("kbd_session");
    const d = readDetail();
    expect(d.in).toBe("dock");
    expect(d.r).toBe("/todo");
    expect(d.p).toBe("android");
    expect(d.kh).toBe(300);
    expect((d.ev as string[][]).map((e) => e[0])).toEqual(["fi", "ws", "ts", "ds", "te", "wh", "dh"]);
    expect(d.ff).toEqual([18, 18]);
    expect(d.dur).toEqual([268, 268]);
    expect(d.nav).toBe(0);
    expect(JSON.parse(localStorage.getItem("timedata_keyboard_probe") ?? "{}")).toEqual({ on: true, left: 19 });
    await unmount(root);
  });

  it("聚焦页面里的输入框 in=page；驻坞条之外的元素 transition 不进会话", async () => {
    localStorage.setItem("timedata_keyboard_probe", JSON.stringify({ on: true, left: 20 }));
    const native = captureNative();
    const { host, root } = await renderProbe();
    const input = host.querySelector('[data-testid="page-input"]') as HTMLInputElement;
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      native.keyboardWillShow?.({ keyboardHeight: 300 });
      input.dispatchEvent(new Event("transitionstart", { bubbles: true }));
      native.keyboardDidHide?.();
    });
    const d = readDetail();
    expect(d.in).toBe("page");
    expect((d.ev as string[][]).map((e) => e[0])).toEqual(["fi", "ws", "dh"]);
    await unmount(root);
  });

  it("开关关着：不落库；设置页翻开开关（广播 td:keyboard-probe）后立即生效", async () => {
    const native = captureNative();
    const { host, root } = await renderProbe();
    const input = host.querySelector('[data-testid="dock-input"]') as HTMLInputElement;
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      native.keyboardWillShow?.({ keyboardHeight: 300 });
      native.keyboardDidHide?.();
    });
    expect(stashMock).not.toHaveBeenCalled();

    await act(async () => {
      localStorage.setItem("timedata_keyboard_probe", JSON.stringify({ on: true, left: 20 }));
      window.dispatchEvent(new Event("td:keyboard-probe"));
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      native.keyboardWillShow?.({ keyboardHeight: 300 });
      native.keyboardDidHide?.();
    });
    expect(stashMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });
});
