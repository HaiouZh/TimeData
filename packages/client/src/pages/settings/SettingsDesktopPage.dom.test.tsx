// @vitest-environment jsdom
// 录入态挂起是只有真渲染才守得住的接缝：它由两半拼成——ShortcutInput 的 focus/blur 回调，
// 与页面把 onRecordingChange 接到 suspend/resume 上。两半各自在 node 侧测绿、中间接错线照样全绿，
// 而线断了的后果是静默的：不挂起 → 录一个本应用已注册的组合时按键被全局热键吃掉、永远录不上；
// 挂起了不恢复 → 按一次 Esc 之后全局热键永久失效。故本文件按「顺序」验这条链，不只验"调过"。
import { act, createElement } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAIN_NAV_ITEMS } from "../../lib/navigation/navRegistry.js";
import { type Root, click, renderDom, unmount } from "../../test/domHarness.js";

// 路径写 ".ts" 而不是 ".js"：本仓 vi.mock 按 vitest 的解析路径匹配（DesktopBridge.dom.test.tsx 已验证）。
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../lib/desktop/api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/desktop/api.js")>()),
  invokeDesktop: ipc.invoke,
}));

import SettingsDesktopPage from "./SettingsDesktopPage.js";

const CONFIG = {
  autostartDisabled: false,
  punchConfirmHours: 4,
  hotkeys: [{ shortcut: "Ctrl+Alt+P", action: "punch" }],
};
const RESUMED = [{ shortcut: "Ctrl+Alt+P", action: "punch", ok: false, error: "被其他程序占用" }];

let mountedRoot: Root | null = null;
const calls: string[] = [];

/** 让 React 把已排队的 effect 与 promise 链跑一轮（纯让位，不等真实时间）。 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let round = 0; round < 50; round++) {
    if (check()) return;
    await settle();
  }
  throw new Error(`等不到：${label}`);
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve: () => resolve(undefined as T) };
}

async function mount() {
  const rendered = await renderDom(createElement(MemoryRouter, null, createElement(SettingsDesktopPage)));
  mountedRoot = rendered.root;
  await waitFor(() => calls.includes("resume_hotkeys"), "首屏配置拉完");
  return rendered;
}

/** 快捷键录入按钮：ShortcutInput 渲染成一个 button，按钮文字就是当前值 / 占位提示。
 *  可访问名带上了当前值与状态（`快捷键：Ctrl+Alt+P` / `快捷键：正在录入…`），故按前缀找。 */
function shortcutButton(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((el) =>
    el.getAttribute("aria-label")?.startsWith("快捷键"),
  );
  if (!button) throw new Error("找不到快捷键录入按钮");
  return button;
}

/** 按文案或 aria-label 找按钮（删除那颗是图标按钮，只有 aria-label）。 */
function buttonNamed(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === label || el.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`找不到按钮「${label}」`);
  return button;
}

async function focusInput(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.focus();
  });
  await settle();
}

/**
 * 直接改 input.value 的话 React 记着旧值、不认这次 input 事件。走原型上的 setter 才等价于
 * 用户输入（受控组件测试的标准做法）。
 */
function nativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
}

/** 真实按键会同时带 key 与 code；录入取的是 code（键位），故用例也要给 code。 */
async function pressOn(button: HTMLButtonElement, init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
  await settle();
}

beforeEach(() => {
  calls.length = 0;
  ipc.invoke.mockReset();
  ipc.invoke.mockImplementation(async (cmd: string) => {
    calls.push(cmd);
    if (cmd === "get_desktop_config") return CONFIG;
    if (cmd === "get_autostart_state") return { enabled: true, userDisabled: false };
    if (cmd === "resume_hotkeys") return RESUMED;
    return undefined;
  });
});

afterEach(async () => {
  if (mountedRoot) await unmount(mountedRoot);
  mountedRoot = null;
});

describe("SettingsDesktopPage 接线", () => {
  it("首屏把配置里的快捷键与 resume 回来的注册失败原因一起显示出来", async () => {
    const { host } = await mount();

    expect(shortcutButton(host).textContent).toContain("Ctrl+Alt+P");
    expect(host.textContent).toContain("被其他程序占用");
  });

  it("聚焦录入框立刻挂起全局热键", async () => {
    const { host } = await mount();
    const after = calls.length;

    await focusInput(shortcutButton(host));

    expect(calls.slice(after)).toEqual(["suspend_hotkeys"]);
  });

  it("录完组合：值换成新组合，并且先挂起后恢复", async () => {
    const { host } = await mount();
    const after = calls.length;
    const button = shortcutButton(host);

    await focusInput(button);
    await pressOn(button, { key: "m", code: "KeyM", ctrlKey: true, altKey: true });

    expect(shortcutButton(host).textContent).toContain("Ctrl+Alt+M");
    expect(calls.slice(after)).toEqual(["suspend_hotkeys", "resume_hotkeys"]);
  });

  it("Esc 取消录入：值不变，但全局热键必须恢复（否则按一次 Esc 就永久失效）", async () => {
    const { host } = await mount();
    const after = calls.length;
    const button = shortcutButton(host);

    await focusInput(button);
    await pressOn(button, { key: "Escape", code: "Escape" });

    expect(shortcutButton(host).textContent).toContain("Ctrl+Alt+P");
    expect(calls.slice(after)).toEqual(["suspend_hotkeys", "resume_hotkeys"]);
  });

  // 挂起挂在 focus、恢复挂在 blur，而 React **卸载一个正在聚焦的元素不触发 blur**：
  // 进设置 → 点录入框 → 按返回，全部全局热键就此失效，直到再进一次设置页或重启壳。
  // 批 2 的全部价值就是这些热键，这条不能只靠 blur。
  it("录入中直接离开设置页：卸载时无条件恢复全局热键", async () => {
    const { host, root } = await mount();
    await focusInput(shortcutButton(host));
    const after = calls.length; // 此处 suspend 已发出，热键正处于挂起态

    await unmount(root);
    mountedRoot = null;
    await settle();

    expect(calls.slice(after)).toEqual(["resume_hotkeys"]);
  });

  // 两行之间移焦点时 DOM 先发 blur（resume：读文件 + 逐条注册）再发 focus（suspend：
  // 只 unregister_all）。fire-and-forget 时完成顺序无保证——suspend 先完成、resume 后完成的话，
  // 第二行正处于录入态而全局热键是注册着的，按下已注册的组合会触发打点而不是被录进去。
  it("录入态的 suspend / resume 按发出顺序串行完成", async () => {
    const { host } = await mount();
    const after = calls.length;
    const button = shortcutButton(host);

    // 把 resume 卡在一道闸后面（不用真实定时器）：resume 要读文件 + 逐条注册，
    // suspend 只 unregister_all，真机上后者必然先完成。不串行化的话第二个 suspend
    // 会抢在 resume 之前落地，得到 [suspend, suspend, resume]——那正是要防的那个中间态。
    const resumeGate = deferred<void>();
    ipc.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "resume_hotkeys") {
        await resumeGate.promise;
        calls.push(cmd);
        return RESUMED;
      }
      calls.push(cmd);
      if (cmd === "get_desktop_config") return CONFIG;
      if (cmd === "get_autostart_state") return { enabled: true, userDisabled: false };
      return undefined;
    });

    await focusInput(button); // suspend
    await act(async () => {
      button.blur(); // resume——被闸卡住
      button.focus(); // suspend——串行化时必须排在 resume 后面
    });
    resumeGate.resolve();
    await waitFor(() => calls.slice(after).length >= 3, "三条命令都跑完");

    expect(calls.slice(after)).toEqual(["suspend_hotkeys", "resume_hotkeys", "suspend_hotkeys"]);
  });

  // 删行 / 改动作只改本地 rows，set_hotkeys 从未发出：列表立刻显示「还没有配置快捷键」，
  // 而 Ctrl+Alt+P 仍在系统里注册着；再聚焦任意录入框还会 resume_hotkeys 把它装回来。
  it("改动前保存按钮是禁用的，改了之后可点并出现未保存标记", async () => {
    const { host } = await mount();
    expect(buttonNamed(host, "保存快捷键").disabled).toBe(true);
    expect(host.textContent).not.toContain("改动要保存才生效");

    await act(async () => {
      buttonNamed(host, "删除").click();
    });
    await settle();

    expect(buttonNamed(host, "保存快捷键").disabled).toBe(false);
    expect(host.textContent).toContain("改动要保存才生效");
  });

  it("保存成功后未保存标记消失、按钮变回禁用", async () => {
    const { host } = await mount();
    await act(async () => {
      buttonNamed(host, "删除").click();
    });
    await settle();
    expect(host.textContent).toContain("改动要保存才生效");

    await act(async () => {
      buttonNamed(host, "保存快捷键").click();
    });
    await settle();

    expect(host.textContent).not.toContain("改动要保存才生效");
    expect(buttonNamed(host, "保存快捷键").disabled).toBe(true);
  });

  // 与上一条成对。保存失败还把标记清掉 = 告诉用户「存好了」，而壳里注册着的仍是旧绑定。
  it("保存失败后未保存标记还在，改动没丢", async () => {
    const { host } = await mount();
    ipc.invoke.mockImplementation(async (cmd: string) => {
      calls.push(cmd);
      if (cmd === "set_hotkeys") throw "被其他程序占用";
      if (cmd === "get_desktop_config") return CONFIG;
      if (cmd === "get_autostart_state") return { enabled: true, userDisabled: false };
      if (cmd === "resume_hotkeys") return RESUMED;
      return undefined;
    });

    await act(async () => {
      buttonNamed(host, "删除").click();
    });
    await settle();
    await act(async () => {
      buttonNamed(host, "保存快捷键").click();
    });
    await settle();

    expect(host.textContent).toContain("被其他程序占用");
    expect(host.textContent).toContain("改动要保存才生效");
    expect(buttonNamed(host, "保存快捷键").disabled).toBe(false);
    expect(host.querySelector("[data-tone='danger']")).toBeInstanceOf(HTMLElement);
  });

  // 读屏取可访问名时 aria-label 会盖掉按钮文字。写死「快捷键」的话读出来永远是
  // 「快捷键，按钮」——当前绑的是什么、是不是正在录，一概听不出来。
  it("录入框的可访问名带上当前值与录入状态", async () => {
    const { host } = await mount();
    expect(shortcutButton(host).getAttribute("aria-label")).toBe("快捷键：Ctrl+Alt+P");

    await focusInput(shortcutButton(host));
    expect(shortcutButton(host).getAttribute("aria-label")).toContain("正在录入");
  });

  // 非法组合（裸字母）返回 null 后什么都不做的话，界面停在「按下组合键…」，
  // 用户以为录上了 → 保存 → 那行被无声丢弃 → 热键从未生效。
  it("按了非法组合就地回显原因，值不变", async () => {
    const { host } = await mount();
    const button = shortcutButton(host);

    await focusInput(button);
    await pressOn(button, { key: "k", code: "KeyK" }); // 裸字母

    expect(shortcutButton(host).textContent).toContain("要带 Ctrl / Alt / Shift");
    expect(shortcutButton(host).getAttribute("aria-label")).toContain("要带 Ctrl / Alt / Shift");
  });

  // 先 preventDefault 再判断的话 Tab 也被吃掉：键盘用户进得去出不来，
  // 只能按 Esc 跳到 body 再从头 Tab。
  it("Tab 直接放行，不做键盘陷阱", async () => {
    const { host } = await mount();
    const button = shortcutButton(host);
    await focusInput(button);

    let defaultPrevented = false;
    await act(async () => {
      const event = new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });

    expect(defaultPrevented).toBe(false);
    expect(shortcutButton(host).textContent).not.toContain("要带 Ctrl / Alt / Shift");
  });

  // 非法阈值静默不保存也不回退时：无报错、无回滚，输入框仍显示 0，用户以为「从此每次都
  // 弹确认卡」，实际仍是旧值（4 小时），3 小时的区间照样闷头写。
  it("阈值改成非法值：不发 IPC，回退到上次存住的值并说明", async () => {
    const { host } = await mount();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="打点确认阈值（小时）"]');
    if (!input) throw new Error("找不到阈值输入框");
    expect(input.value).toBe("4");
    const after = calls.length;

    await act(async () => {
      nativeInputValue(input, "0");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();

    expect(calls.slice(after)).not.toContain("set_punch_confirm_hours");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="打点确认阈值（小时）"]')?.value).toBe("4");
    expect(host.textContent).toContain("已改回 4");
  });

  it("阈值改成合法值：发 IPC 且不回退", async () => {
    const { host } = await mount();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="打点确认阈值（小时）"]');
    if (!input) throw new Error("找不到阈值输入框");
    const after = calls.length;

    await act(async () => {
      nativeInputValue(input, "2.5");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();

    expect(calls.slice(after)).toContain("set_punch_confirm_hours");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="打点确认阈值（小时）"]')?.value).toBe("2.5");
    expect(host.textContent).not.toContain("已改回");
  });

  // 队列是 promise 链：某一环 reject 会让 queue.current 变成 rejected，此后每个 .then
  // 都被跳过——录入态永久静音，且屏幕上毫无异常。catch 必须在回调**内部**吞掉。
  it("一次挂起失败不截断录入队列，下一次照常发得出去", async () => {
    const { host } = await mount();
    let failNext = true;
    ipc.invoke.mockImplementation(async (cmd: string) => {
      calls.push(cmd);
      if (cmd === "suspend_hotkeys" && failNext) {
        failNext = false;
        throw "挂起失败";
      }
      if (cmd === "get_desktop_config") return CONFIG;
      if (cmd === "get_autostart_state") return { enabled: true, userDisabled: false };
      if (cmd === "resume_hotkeys") return RESUMED;
      return undefined;
    });

    const button = shortcutButton(host);
    await focusInput(button);
    await pressOn(button, { key: "Escape", code: "Escape" });
    await focusInput(button);

    expect(calls.filter((cmd) => cmd === "suspend_hotkeys").length).toBe(2);
  });
});

describe("navigate 行", () => {
  it("选了跳转就露出目标页选择器，且带着默认值", async () => {
    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsDesktopPage)));
    mountedRoot = root;
    await waitFor(() => host.querySelector('[aria-label="动作"]') !== null, "首屏加载");

    const navigateOption = [...host.querySelectorAll('[aria-label="动作"] button')].find(
      (b) => b.textContent === "跳转",
    );
    expect(navigateOption).toBeTruthy();
    await click(navigateOption);
    await settle();

    const targetTrigger = host.querySelector('[aria-label="目标页"]');
    expect(targetTrigger).toBeTruthy();
    // 默认值必须落上——留空保存会被 Rust 静默丢掉整条绑定。
    expect(targetTrigger?.textContent).toContain(MAIN_NAV_ITEMS[0].label);
  });
});
