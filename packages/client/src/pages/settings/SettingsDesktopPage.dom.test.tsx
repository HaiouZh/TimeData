// @vitest-environment jsdom
// 录入态挂起是只有真渲染才守得住的接缝：它由两半拼成——ShortcutInput 的 focus/blur 回调，
// 与页面把 onRecordingChange 接到 suspend/resume 上。两半各自在 node 侧测绿、中间接错线照样全绿，
// 而线断了的后果是静默的：不挂起 → 录一个本应用已注册的组合时按键被全局热键吃掉、永远录不上；
// 挂起了不恢复 → 按一次 Esc 之后全局热键永久失效。故本文件按「顺序」验这条链，不只验"调过"。
import { act, createElement } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Root, renderDom, unmount } from "../../test/domHarness.js";

// 路径写 ".ts" 而不是 ".js"：本仓 vi.mock 按 vitest 的解析路径匹配（DesktopBridge.dom.test.tsx 已验证）。
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../lib/desktop/api.ts", () => ({
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

async function mount() {
  const rendered = await renderDom(createElement(MemoryRouter, null, createElement(SettingsDesktopPage)));
  mountedRoot = rendered.root;
  await waitFor(() => calls.includes("resume_hotkeys"), "首屏配置拉完");
  return rendered;
}

/** 快捷键录入按钮：ShortcutInput 渲染成一个 button，按钮文字就是当前值 / 占位提示。 */
function shortcutButton(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((el) => el.getAttribute("aria-label") === "快捷键");
  if (!button) throw new Error("找不到快捷键录入按钮");
  return button;
}

async function focusInput(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.focus();
  });
  await settle();
}

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
    await pressOn(button, { key: "m", ctrlKey: true, altKey: true });

    expect(shortcutButton(host).textContent).toContain("Ctrl+Alt+M");
    expect(calls.slice(after)).toEqual(["suspend_hotkeys", "resume_hotkeys"]);
  });

  it("Esc 取消录入：值不变，但全局热键必须恢复（否则按一次 Esc 就永久失效）", async () => {
    const { host } = await mount();
    const after = calls.length;
    const button = shortcutButton(host);

    await focusInput(button);
    await pressOn(button, { key: "Escape" });

    expect(shortcutButton(host).textContent).toContain("Ctrl+Alt+P");
    expect(calls.slice(after)).toEqual(["suspend_hotkeys", "resume_hotkeys"]);
  });
});
