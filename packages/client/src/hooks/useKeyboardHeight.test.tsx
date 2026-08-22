// @vitest-environment jsdom
import { act, createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";

const getPlatformMock = vi.hoisted(() => vi.fn(() => "web"));
const addListenerMock = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: getPlatformMock,
  },
}));

vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    addListener: addListenerMock,
  },
}));

import { useKeyboardHeight, useKeyboardVisible } from "./useKeyboardHeight.js";

function Probe() {
  const height = useKeyboardHeight();
  return createElement("div", { "data-keyboard-height": String(height) });
}

function VisibleProbe() {
  const visible = useKeyboardVisible();
  return createElement("div", { "data-keyboard-visible": String(visible) });
}

function readVisible(host: HTMLElement): string | null {
  return host.firstElementChild?.getAttribute("data-keyboard-visible") ?? null;
}

type ViewportListener = () => void;

function createViewportMock(initial: { height: number; offsetTop: number }) {
  const listeners: Record<"resize" | "scroll", ViewportListener[]> = { resize: [], scroll: [] };
  const viewport = {
    height: initial.height,
    offsetTop: initial.offsetTop,
    addEventListener: (event: "resize" | "scroll", cb: ViewportListener) => {
      listeners[event].push(cb);
    },
    removeEventListener: (event: "resize" | "scroll", cb: ViewportListener) => {
      listeners[event] = listeners[event].filter((l) => l !== cb);
    },
    fire(event: "resize" | "scroll") {
      for (const cb of [...listeners[event]]) cb();
    },
  };
  return viewport;
}

function readHeight(host: HTMLElement): string | null {
  return host.firstElementChild?.getAttribute("data-keyboard-height") ?? null;
}

beforeEach(() => {
  getPlatformMock.mockReset();
  getPlatformMock.mockReturnValue("web");
  addListenerMock.mockReset();
  (window as unknown as { visualViewport?: unknown }).visualViewport = undefined;
  // innerHeight 由各用例经 defineProperty 改写且不会自动还原，逐例复位到 jsdom 默认值，
  // 否则「壳缩过」的残留值会让后一个用例算出非零 shrink。
  Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
});

describe("useKeyboardHeight — native", () => {
  it("keyboardWillShow 给出真实高度，keyboardWillHide 归零", async () => {
    getPlatformMock.mockReturnValue("ios");
    const callbacks: Record<string, (arg?: unknown) => void> = {};
    addListenerMock.mockImplementation((eventName: string, cb: (arg?: unknown) => void) => {
      callbacks[eventName] = cb;
      return Promise.resolve({ remove: vi.fn() });
    });

    const { host, root } = await renderDom(createElement(Probe));

    expect(readHeight(host)).toBe("0");
    expect(addListenerMock).toHaveBeenCalledWith("keyboardWillShow", expect.any(Function));
    expect(addListenerMock).toHaveBeenCalledWith("keyboardWillHide", expect.any(Function));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    expect(readHeight(host)).toBe("300");

    await act(async () => {
      callbacks.keyboardWillHide?.();
    });
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });

  it("keyboardHeight 非有限值（NaN/undefined）时归零而非透传 NaN", async () => {
    getPlatformMock.mockReturnValue("ios");
    const callbacks: Record<string, (arg?: unknown) => void> = {};
    addListenerMock.mockImplementation((eventName: string, cb: (arg?: unknown) => void) => {
      callbacks[eventName] = cb;
      return Promise.resolve({ remove: vi.fn() });
    });

    const { host, root } = await renderDom(createElement(Probe));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: Number.NaN });
    });
    expect(readHeight(host)).toBe("0");

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: undefined });
    });
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });

  it("非 web 平台照常订阅插件事件（visualViewport 在场也不改这一点）", async () => {
    getPlatformMock.mockReturnValue("android");
    addListenerMock.mockReturnValue(Promise.resolve({ remove: vi.fn() }));
    const viewport = createViewportMock({ height: 500, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;

    const { root } = await renderDom(createElement(Probe));
    expect(addListenerMock).toHaveBeenCalledTimes(2);

    await unmount(root);
  });

  it("插件 addListener 返回 rejected promise（插件缺席）时静默降级，实测路径照常", async () => {
    // 插件缺席时 Capacitor 的 addListener **不是同步抛**而是返回 rejected promise（web 桥
    // UNIMPLEMENTED / native 壳未注册同理），只包 try/catch 逮不住——rejection 无人接就是
    // unhandled rejection（AppShell 挂 KeyboardAvoidanceBridge 后 App.keptStack.test.tsx 在
    // mock 平台 android/ios 下整文件炸掉的根因）。本用例若 rejection 未被接住会以
    // Unhandled Rejection 失败。
    getPlatformMock.mockReturnValue("android");
    // 异步 reject，贴近真实 web 桥的时序（同步 Promise.reject 会被 unmount 时后补的 catch
    // 抵消记账，复现不了）；rejection 必须在 addListener 返回处**同步**接住才防得住。
    addListenerMock.mockImplementation(() =>
      Promise.resolve().then(() => {
        throw new Error("UNIMPLEMENTED");
      }),
    );
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const viewport = createViewportMock({ height: 500, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;

    const { host, root } = await renderDom(createElement(Probe));
    // 让 rejection 的微任务链走完——未接住的话 vitest 以 Unhandled Rejection 判整个 run 失败。
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    // 只剩实测路径：800 - 500 - 0 = 300，好过整条 effect 挂掉。
    expect(readHeight(host)).toBe("300");

    await unmount(root);
  });
});

describe("useKeyboardHeight — 壳已经让过位时不再重复避让", () => {
  function mockNativeKeyboard() {
    const callbacks: Record<string, (arg?: unknown) => void> = {};
    addListenerMock.mockImplementation((eventName: string, cb: (arg?: unknown) => void) => {
      callbacks[eventName] = cb;
      return Promise.resolve({ remove: vi.fn() });
    });
    return callbacks;
  }

  function setInnerHeight(value: number) {
    Object.defineProperty(window, "innerHeight", { value, configurable: true });
  }

  it("壳把 webview 缩掉一个键盘高（innerHeight 变小）时，JS 侧避让收敛为 0", async () => {
    // 双倍避让的根因：插件报 300，而壳已经把布局视口底抬到键盘之上，JS 再加 300 就把输入条
    // 顶到屏幕上半部分。这里钉住「壳让过位就不再重复加」。
    getPlatformMock.mockReturnValue("android");
    setInnerHeight(800);
    const callbacks = mockNativeKeyboard();

    const { host, root } = await renderDom(createElement(Probe));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    // 壳还没 reflow：此刻无从判断，按插件高度抬起（不缩的壳这就是终值）。
    expect(readHeight(host)).toBe("300");

    // 壳缩了 webview → window resize。
    setInnerHeight(500);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });

  it("壳缩过一次后，下一次弹起首帧就不再冲高（不抖）", async () => {
    getPlatformMock.mockReturnValue("android");
    setInnerHeight(800);
    const callbacks = mockNativeKeyboard();

    const { host, root } = await renderDom(createElement(Probe));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    setInnerHeight(500);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(readHeight(host)).toBe("0");

    // 收起：壳恢复全高，基线随之回到 800。
    await act(async () => {
      callbacks.keyboardWillHide?.();
    });
    setInnerHeight(800);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(readHeight(host)).toBe("0");

    // 再次弹起，壳尚未 reflow：按上次实测到的缩量预扣，首帧即 0，不再先冲到 300 再落回。
    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });

  it("壳逐帧缩 webview（IME 动画同步）期间基线不漂移：插件事件最后到达时不叠成双倍", async () => {
    // 安卓壳改逐帧让位（WindowInsetsAnimationCompat.onProgress）后，动画期间每帧一个 resize、
    // 且插件高度尚为 0。基线若在这些帧里被「顺手校准」到缩小中的值，动画结束插件报 300 时
    // 壳缩量会算成 0，JS 再叠 300 = 双倍避让（输入条飞到键盘上方一个键盘高）。
    // 键盘在不在场 recompute 无从直接知道，但「可编辑元素持焦点」时禁校准即可挡住整段动画窗口。
    getPlatformMock.mockReturnValue("android");
    setInnerHeight(800);
    const callbacks = mockNativeKeyboard();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const { host, root } = await renderDom(createElement(Probe));

    // IME 动画逐帧缩：每帧 resize 时插件高度仍为 0。
    for (const frameHeight of [740, 660, 580, 500]) {
      setInnerHeight(frameHeight);
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
      });
    }
    // 动画结束插件事件才到：壳已让掉 300（基线 800 - 现值 500），JS 必须收敛为 0。
    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    expect(readHeight(host)).toBe("0");

    input.remove();
    await unmount(root);
  });

  it("native 平台上 visualViewport 实测到的遮挡量优先于插件高度", async () => {
    // 壳把视口整体上移（WKWebView 的 scroll-to-focus）而非缩小时，innerHeight 不变、
    // 实测 gap 才说得出真相；插件高度此时是过量的。
    getPlatformMock.mockReturnValue("ios");
    setInnerHeight(800);
    const viewport = createViewportMock({ height: 620, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const callbacks = mockNativeKeyboard();

    const { host, root } = await renderDom(createElement(Probe));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    // 实测：800 - 620 - 0 = 180 被遮，而插件报 300。以实测为准。
    expect(readHeight(host)).toBe("180");

    await unmount(root);
  });

  it("keyboardWillHide 后即使 visualViewport 仍报遮挡（收起动画残影），也立即归零", async () => {
    // 用户实测（iOS 速记页）：收起输入法后输入条有个滞后的下滑动作。根因：willHide 已把插件高度
    // 归零，但 recompute 实测优先——visualViewport 要等键盘收起动画结束才恢复，动画期间实测仍报
    // 遮挡，高度被它顶着不落，输入条比键盘晚落一拍。插件明确宣布收起后，动画残影不作数。
    getPlatformMock.mockReturnValue("ios");
    setInnerHeight(800);
    const viewport = createViewportMock({ height: 500, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const callbacks = mockNativeKeyboard();

    const { host, root } = await renderDom(createElement(Probe));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    // 实测路径活跃：800 - 500 - 0 = 300。
    expect(readHeight(host)).toBe("300");

    // 键盘开始收起：插件事件先到，viewport 数值原封未动（动画没结束）。
    await act(async () => {
      callbacks.keyboardWillHide?.();
    });
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });

  it("收起后的抑制窗口内，visualViewport 的动画中间帧不把高度弹回", async () => {
    getPlatformMock.mockReturnValue("ios");
    setInnerHeight(800);
    const viewport = createViewportMock({ height: 500, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const callbacks = mockNativeKeyboard();

    const { host, root } = await renderDom(createElement(Probe));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    await act(async () => {
      callbacks.keyboardWillHide?.();
    });
    expect(readHeight(host)).toBe("0");

    // 键盘收起动画的中间帧：viewport 恢复到一半（实测 150），事件打进来也不得弹回。
    viewport.height = 650;
    await act(async () => {
      viewport.fire("resize");
    });
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });

  it("抑制窗口过期后，实测路径恢复效力", async () => {
    // 抑制只为吞掉收起动画的残影（~250ms），不能永久闭眼——过期后 visualViewport 再报遮挡
    //（如 web 外接场景、壳行为变化）仍要能避让。实现读 Date.now()，这里直接 mock 它推进时间，
    // 不涉及定时器等待。
    getPlatformMock.mockReturnValue("ios");
    setInnerHeight(800);
    const viewport = createViewportMock({ height: 500, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const callbacks = mockNativeKeyboard();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);

    try {
      const { host, root } = await renderDom(createElement(Probe));

      await act(async () => {
        callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
      });
      await act(async () => {
        callbacks.keyboardWillHide?.();
      });
      expect(readHeight(host)).toBe("0");

      // 过了抑制窗口（500ms 后），viewport 仍在报遮挡 → 实测重新说了算。
      nowSpy.mockReturnValue(100_500);
      await act(async () => {
        viewport.fire("resize");
      });
      expect(readHeight(host)).toBe("300");

      await unmount(root);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("visualViewport 报不出遮挡（gap 在阈值内）时，回落到插件高度", async () => {
    // iOS resize:none 下 WebKit 可能既不缩 webview 也不更新 visualViewport，
    // 此时实测为 0 而键盘确实在遮——必须由插件高度兜底，否则输入条被键盘盖住。
    getPlatformMock.mockReturnValue("ios");
    setInnerHeight(800);
    const viewport = createViewportMock({ height: 800, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const callbacks = mockNativeKeyboard();

    const { host, root } = await renderDom(createElement(Probe));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    expect(readHeight(host)).toBe("300");

    await unmount(root);
  });
});

describe("useKeyboardVisible — 键盘在不在场，与「还挡着多少」解耦", () => {
  // 安卓壳层让位（adjustResize + ime inset）后 useKeyboardHeight 恒 0——那是「JS 无需再让位」，
  // 不等于「键盘没弹」。「键盘弹起时收起底栏 / composer 不算滚动隐藏」这类**在场判断**必须用
  // 本信号：native 平台由插件事件驱动（壳让位后事件照发），web 无插件、实测兜底。
  it("native：壳已让位（实测恒 0）时 keyboardWillShow 仍给出 true，willHide 归 false", async () => {
    getPlatformMock.mockReturnValue("android");
    const callbacks: Record<string, (arg?: unknown) => void> = {};
    addListenerMock.mockImplementation((eventName: string, cb: (arg?: unknown) => void) => {
      callbacks[eventName] = cb;
      return Promise.resolve({ remove: vi.fn() });
    });
    // 壳缩了 webview：innerHeight 与 visualViewport 一致，实测遮挡恒 0。
    Object.defineProperty(window, "innerHeight", { value: 500, configurable: true });
    const viewport = createViewportMock({ height: 500, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;

    const { host, root } = await renderDom(createElement(VisibleProbe));
    expect(readVisible(host)).toBe("false");

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    expect(readVisible(host)).toBe("true");

    await act(async () => {
      callbacks.keyboardWillHide?.();
    });
    expect(readVisible(host)).toBe("false");

    await unmount(root);
  });

  // 安卓的 keyboardWillShow 由 OnGlobalLayoutListener 驱动，**键盘显示完毕才发**；而壳的
  // adjustResize 在 IME 动画一开始就把 webview 缩了。中间这段窗口里「键盘明明在场、信号还说不在」
  // ——待办页的输入条因此先停在「还给底栏留着一个身位」的位置，等事件到了才向下吸附一段，真机
  // 观感是「先渲染到页面中间，键盘完整出现后才吸附过去」。壳缩 webview 这件事本身与动画同步，
  // 拿它当在场信号才追得上。
  it("native：壳缩 webview 那一刻就算在场，不等滞后的插件事件", async () => {
    getPlatformMock.mockReturnValue("android");
    addListenerMock.mockImplementation(() => Promise.resolve({ remove: vi.fn() }));
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const viewport = createViewportMock({ height: 800, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;

    const { host, root } = await renderDom(createElement(VisibleProbe));
    expect(readVisible(host)).toBe("false");

    // 壳让位：innerHeight 与 visualViewport 一起变小，故实测遮挡恒 0——判不出键盘在场的正是这一步。
    Object.defineProperty(window, "innerHeight", { value: 500, configurable: true });
    viewport.height = 500;
    await act(async () => {
      viewport.fire("resize");
    });
    expect(readVisible(host)).toBe("true");

    await unmount(root);
  });

  // 上一条的「只升不降」若不加约束就有反面：keyboardWillHide 先到、壳把 webview 恢复全高在后，
  // 恢复途中的每一次 resize 缩量都还超阈值，会把刚落下的在场状态一路顶回 true——底栏收着不回来、
  // 输入条停在键盘早已消失的位置。压制到壳真的恢复为止（按缩量判，不猜动画时长）。
  it("native：keyboardWillHide 之后，壳恢复途中的 resize 不把在场状态顶回来", async () => {
    getPlatformMock.mockReturnValue("android");
    const callbacks: Record<string, (arg?: unknown) => void> = {};
    addListenerMock.mockImplementation((eventName: string, cb: (arg?: unknown) => void) => {
      callbacks[eventName] = cb;
      return Promise.resolve({ remove: vi.fn() });
    });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const viewport = createViewportMock({ height: 800, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;

    const { host, root } = await renderDom(createElement(VisibleProbe));

    Object.defineProperty(window, "innerHeight", { value: 500, configurable: true });
    viewport.height = 500;
    await act(async () => {
      viewport.fire("resize");
    });
    expect(readVisible(host)).toBe("true");

    // 键盘落下：插件事件先到，壳的 reflow 还没发生。
    await act(async () => {
      callbacks.keyboardWillHide?.();
    });
    expect(readVisible(host)).toBe("false");

    // 壳恢复途中的中间帧：innerHeight 还没回到 800，缩量仍超阈值。
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    viewport.height = 600;
    await act(async () => {
      viewport.fire("resize");
    });
    expect(readVisible(host)).toBe("false");

    await unmount(root);
  });

  it("web：无插件事件，实测遮挡超阈值即在场、回落即离场", async () => {
    getPlatformMock.mockReturnValue("web");
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const viewport = createViewportMock({ height: 800, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;

    const { host, root } = await renderDom(createElement(VisibleProbe));
    expect(readVisible(host)).toBe("false");

    viewport.height = 500;
    await act(async () => {
      viewport.fire("resize");
    });
    expect(readVisible(host)).toBe("true");

    viewport.height = 800;
    await act(async () => {
      viewport.fire("resize");
    });
    expect(readVisible(host)).toBe("false");

    await unmount(root);
  });
});

describe("useKeyboardVisible — focusin 预测性在场（聚焦即在场，不等滞后信号）", () => {
  // Telegram Android 的核心原则「预测先行、实测校正」：用户点输入框那一刻就知道键盘要来了，
  // 不必等壳缩 webview（与 IME 动画同步）更不必等插件事件（键盘显示完毕才发）。在场信号
  // 提前到 focusin，消费方（收底栏、composer 定位）首帧即到位，输入条不再「上蹿下跳找位置」。
  it("native：可编辑元素 focusin 那一刻即在场，不等插件事件与壳缩", async () => {
    getPlatformMock.mockReturnValue("android");
    addListenerMock.mockImplementation(() => Promise.resolve({ remove: vi.fn() }));

    const { host, root } = await renderDom(createElement(VisibleProbe));
    expect(readVisible(host)).toBe("false");

    const input = document.createElement("input");
    document.body.appendChild(input);
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(readVisible(host)).toBe("true");

    input.remove();
    await unmount(root);
  });

  it("native：focusout 切到另一个可编辑元素（换输入框）不闪落", async () => {
    getPlatformMock.mockReturnValue("android");
    addListenerMock.mockImplementation(() => Promise.resolve({ remove: vi.fn() }));

    const { host, root } = await renderDom(createElement(VisibleProbe));
    const inputA = document.createElement("input");
    const inputB = document.createElement("textarea");
    document.body.append(inputA, inputB);

    await act(async () => {
      inputA.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(readVisible(host)).toBe("true");

    // 键盘在两个输入框之间保持弹起：focusout 的去向仍是可编辑元素，不得闪落。
    await act(async () => {
      inputA.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: inputB }));
    });
    expect(readVisible(host)).toBe("true");

    inputA.remove();
    inputB.remove();
    await unmount(root);
  });

  it("native：focusout 到非可编辑目标时离场（外接键盘 / 插件事件缺席时的自愈出口）", async () => {
    getPlatformMock.mockReturnValue("android");
    addListenerMock.mockImplementation(() => Promise.resolve({ remove: vi.fn() }));

    const { host, root } = await renderDom(createElement(VisibleProbe));
    const input = document.createElement("input");
    document.body.appendChild(input);

    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(readVisible(host)).toBe("true");

    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    });
    expect(readVisible(host)).toBe("false");

    input.remove();
    await unmount(root);
  });

  // willHide 那条竞态的 focusout 同款：离场事件先到、壳恢复 webview 在后，恢复途中的中间帧
  // 缩量仍超阈值，「只升不降」分支会把刚落下的在场状态顶回 true。focusout 也要竖起压制。
  it("native：focusout 离场后，壳恢复途中的 resize 不把在场状态顶回来", async () => {
    getPlatformMock.mockReturnValue("android");
    addListenerMock.mockImplementation(() => Promise.resolve({ remove: vi.fn() }));
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const viewport = createViewportMock({ height: 800, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;

    const { host, root } = await renderDom(createElement(VisibleProbe));
    const input = document.createElement("input");
    document.body.appendChild(input);

    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    // 壳让位（IME 动画同步缩 webview）。
    Object.defineProperty(window, "innerHeight", { value: 500, configurable: true });
    viewport.height = 500;
    await act(async () => {
      viewport.fire("resize");
    });
    expect(readVisible(host)).toBe("true");

    // 焦点离开：离场先于壳恢复。
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    });
    expect(readVisible(host)).toBe("false");

    // 壳恢复途中的中间帧：缩量 800-600=200 仍超阈值，不得顶回。
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    viewport.height = 600;
    await act(async () => {
      viewport.fire("resize");
    });
    expect(readVisible(host)).toBe("false");

    input.remove();
    await unmount(root);
  });

  it("web（桌面浏览器）：focusin 不置在场——桌面敲字不许收底栏", async () => {
    getPlatformMock.mockReturnValue("web");

    const { host, root } = await renderDom(createElement(VisibleProbe));
    const input = document.createElement("input");
    document.body.appendChild(input);

    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(readVisible(host)).toBe("false");

    input.remove();
    await unmount(root);
  });
});

describe("useKeyboardHeight — web 兜底", () => {
  it("visualViewport 差值超过阈值出正值，回落到阈值以下归零", async () => {
    getPlatformMock.mockReturnValue("web");
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const viewport = createViewportMock({ height: 750, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;

    const { host, root } = await renderDom(createElement(Probe));
    expect(readHeight(host)).toBe("0");
    expect(addListenerMock).not.toHaveBeenCalled();

    viewport.height = 500; // 800 - 500 - 0 = 300 > 80 阈值
    await act(async () => {
      viewport.fire("resize");
    });
    expect(readHeight(host)).toBe("300");

    viewport.height = 750; // 800 - 750 - 0 = 50 < 80 阈值
    await act(async () => {
      viewport.fire("resize");
    });
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });

  it("无 visualViewport 时始终为 0", async () => {
    getPlatformMock.mockReturnValue("web");
    (window as unknown as { visualViewport?: unknown }).visualViewport = undefined;

    const { host, root } = await renderDom(createElement(Probe));
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });
});
