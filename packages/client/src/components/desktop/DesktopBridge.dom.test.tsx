// @vitest-environment jsdom
// 组件接线闸：DesktopBridge 的 effect / 事件回调只有在真渲染里才跑得到，
// 静态渲染对「监听没挂上」「ready 没报」「按钮接错线」「卸载不摘监听」一律无感。
// seed 真 db，故 dbReset 必须先于任何触 db/index 的模块求值。
import type { Category } from "@timedata/shared";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../../test/dbReset.js";
import { click, renderDom, unmount, type Root } from "../../test/domHarness.js";
import { setPunchCategoryId } from "../../lib/settings/punchCategorySetting.js";

// 只挡 IPC 边界，打点仍走真 desktopPunch + 真库。
// 路径写 ".ts" 而不是 ".js"：本仓 vi.mock 按 vitest 的解析路径匹配（DiaryReferencePanel 已验证），
// 写成 ".js" 会静默不生效。
const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("../../lib/desktop/api.ts", () => ({
  invokeDesktop: ipc.invoke,
  listenDesktopHotkey: ipc.listen,
}));

import { DesktopBridge } from "./DesktopBridge.js";

// APP 时区 +08:00。pressedAt = 2026-06-15 12:00 (+08:00)。
const PRESSED_AT_MS = new Date("2026-06-15T04:00:00.000Z").getTime();
const PUNCH_CATEGORY_ID = "cat-deep";
const CONFIG = { autostartDisabled: false, punchConfirmHours: 4, hotkeys: [] };

type HotkeyEvent = { action: string; pressedAtMs: number };

let mountedRoot: Root | null = null;
const calls: string[] = [];
const handlers: ((event: HotkeyEvent) => void)[] = [];
const unlisten = vi.fn();

function category(id: string, name: string, parentId: string | null): Category {
  return {
    id,
    name,
    parentId,
    color: "#94A3B8",
    icon: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:00.000Z",
  };
}

async function seedPunchable() {
  await db.categories.bulkAdd([category("cat-work", "工作", null), category(PUNCH_CATEGORY_ID, "深度", "cat-work")]);
  await setPunchCategoryId(PUNCH_CATEGORY_ID);
  await db.timeEntries.add({
    id: "seed-1",
    categoryId: PUNCH_CATEGORY_ID,
    startTime: "2026-06-15T00:00:00.000Z",
    endTime: "2026-06-15T03:00:00.000Z",
    note: null,
    createdAt: "2026-06-15T03:00:00.000Z",
    updatedAt: "2026-06-15T03:00:00.000Z",
  });
  await db.syncLog.clear();
}

/** 让 React 把已排队的 effect 与 promise 链跑一轮（纯让位，不等真实时间）。 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 反复让位直到条件成立——Dexie 事务要好几轮微任务才落地，一轮 settle 不够。 */
async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let round = 0; round < 100; round++) {
    if (check()) return;
    await settle();
  }
  throw new Error(`等不到：${label}`);
}

const countOf = (cmd: string) => calls.filter((call) => call === cmd).length;

async function mount() {
  const rendered = await renderDom(createElement(DesktopBridge));
  mountedRoot = rendered.root;
  await settle();
  return rendered;
}

async function emitPunch(...presses: number[]): Promise<void> {
  // 四种结局各自恰好发一条 notify_user 或一条 show_main，用它数「跑完了几次」。
  const done = () => countOf("notify_user") + countOf("show_main");
  const before = done();
  await act(async () => {
    for (const pressedAtMs of presses) handlers[0]?.({ action: "punch", pressedAtMs });
  });
  await waitFor(() => done() >= before + presses.length, `${presses.length} 次打点跑完`);
  await settle();
}

const buttonNamed = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label) ?? null;

beforeEach(async () => {
  await resetDb();
  calls.length = 0;
  handlers.length = 0;
  unlisten.mockClear();
  ipc.invoke.mockReset();
  ipc.invoke.mockImplementation(async (cmd: string) => {
    calls.push(cmd);
    return cmd === "get_desktop_config" ? CONFIG : undefined;
  });
  ipc.listen.mockReset();
  ipc.listen.mockImplementation(async (handler: (event: HotkeyEvent) => void) => {
    calls.push("listen");
    handlers.push(handler);
    return unlisten;
  });
});

afterEach(async () => {
  if (mountedRoot) await unmount(mountedRoot);
  mountedRoot = null;
});

describe("DesktopBridge 组件接线", () => {
  it("挂载后监听挂上一次，desktop_ready 排在它之后", async () => {
    await mount();

    expect(ipc.listen).toHaveBeenCalledOnce();
    expect(calls).toContain("desktop_ready");
    expect(calls.indexOf("listen")).toBeLessThan(calls.indexOf("desktop_ready"));
  });

  it("热键 punch 走完全链路：真库落一条、撤销条出现在 DOM 里", async () => {
    await seedPunchable();
    const { host } = await mount();

    expect(handlers).toHaveLength(1);
    await emitPunch(PRESSED_AT_MS);

    expect(await db.timeEntries.count()).toBe(2);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("已打点 11:00–12:00");
    expect(calls).toContain("notify_user");
  });

  it("点 DOM 里的「撤销」：那条记录被删、撤销条消失", async () => {
    await seedPunchable();
    const { host } = await mount();
    await emitPunch(PRESSED_AT_MS);
    expect(await db.timeEntries.count()).toBe(2);

    await click(buttonNamed(host, "撤销"));
    await waitFor(() => host.querySelector('[role="status"]') === null, "撤销条收起");

    expect(await db.timeEntries.count()).toBe(1); // 只剩 seed 那条
  });

  it("卸载时把监听摘掉", async () => {
    const { root } = await mount();
    expect(unlisten).not.toHaveBeenCalled();

    await unmount(root);
    mountedRoot = null;

    expect(unlisten).toHaveBeenCalledOnce();
  });

  // 连按（按了不确定生效就再按一下）是常见动作，而打点是零 UI 的。两次并发各自读到同一条
  // 「上一条记录」就会各写一条完全重叠的假记录，用户不一定当场发现。
  it("连按两次热键只写一条——串行化让第二次看得见第一次写下的记录", async () => {
    await seedPunchable();
    await mount();

    await emitPunch(PRESSED_AT_MS, PRESSED_AT_MS);

    expect(await db.timeEntries.count()).toBe(2); // seed + 一条，不是 seed + 两条
    expect(calls).toContain("notify_user");
  });

  // 队列是 .then 链：某一步 reject 会让后面的 .then 全部跳过，此后每次打点都静音且无报错。
  // 这条同时守「失败要出通知」和「失败之后队列还活着」——少了 catch 两者一起没。
  it("一次打点失败不卡死队列：出通知，下一次照常写库", async () => {
    await seedPunchable();
    await mount();

    ipc.invoke.mockImplementationOnce(async (cmd: string) => {
      calls.push(cmd);
      throw new Error("读配置失败");
    });

    await emitPunch(PRESSED_AT_MS);
    expect(ipc.invoke).toHaveBeenCalledWith("notify_user", { title: "TimeData", body: "读配置失败" });
    expect(await db.timeEntries.count()).toBe(1); // 失败那次一个字没写，只剩 seed

    await emitPunch(PRESSED_AT_MS);
    expect(await db.timeEntries.count()).toBe(2); // 队列没卡死
  });
});
