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
// 只替换两个 IPC 入口，模块其余部分（messageOf 等纯函数）用真的——
// 整体替换的写法会让「失败原因怎么读出来」这件被测的事变成 mock 自己说了算。
vi.mock("../../lib/desktop/api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/desktop/api.js")>()),
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

/** 只配打点分类、不留任何记录：起点回退今天 0 点 → 12 小时 → 必然超阈值弹确认卡。 */
async function seedCategoryOnly() {
  await db.categories.bulkAdd([category("cat-work", "工作", null), category(PUNCH_CATEGORY_ID, "深度", "cat-work")]);
  await setPunchCategoryId(PUNCH_CATEGORY_ID);
  await db.syncLog.clear();
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
async function waitFor(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let round = 0; round < 100; round++) {
    if (await check()) return;
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

const confirmCard = (host: HTMLElement) => host.querySelector('[role="alertdialog"]');

/** 空库 + 配好分类 → 12 小时区间必然超阈值 → 弹确认卡。等到它真出现在 DOM 里。 */
async function raiseConfirmCard(host: HTMLElement): Promise<void> {
  await act(async () => {
    handlers[0]?.({ action: "punch", pressedAtMs: PRESSED_AT_MS });
  });
  await waitFor(() => confirmCard(host) !== null, "确认卡出现");
}

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

  // ---- 确认卡这条路：bridge→layer 的 prop 落位 ----
  // 层内测的是「点『记录』→ 调 onConfirm」，函数级测的是「confirmPunch 会落笔」，
  // 中间那段 **bridge 把哪个回调接到哪个 prop 上** 从没人锁：两个回调对调，
  // 上面两处全绿，而后果是点「记录」什么都不写、点「算了」反而落库一段没批准的区间。
  it("点确认卡里的「记录」：真落库，卡片消失", async () => {
    await seedCategoryOnly();
    const { host } = await mount();
    await raiseConfirmCard(host);
    expect(await db.timeEntries.count()).toBe(0); // 弹卡时一个字都还没写

    await click(buttonNamed(host, "记录"));
    await waitFor(async () => (await db.timeEntries.count()) === 1, "落库");
    await waitFor(() => confirmCard(host) === null, "卡片收起");

    expect((await db.timeEntries.toArray())[0].endTime).toBe("2026-06-15T04:00:00.000Z");
    expect(host.querySelector('[aria-label="桌面打点反馈"]')?.textContent).toContain("已打点 00:00–12:00");
  });

  it("点确认卡里的「算了」：一个字不写，卡片消失", async () => {
    await seedCategoryOnly();
    const { host } = await mount();
    await raiseConfirmCard(host);

    await click(buttonNamed(host, "算了"));
    await waitFor(() => confirmCard(host) === null, "卡片消失");

    expect(await db.timeEntries.count()).toBe(0);
  });

  // 用户刚按完热键，手在键盘上。焦点不进卡片 = 只剩鼠标一条路。
  it("卡片弹出时焦点落在「记录」上，Esc 等于「算了」", async () => {
    await seedCategoryOnly();
    const { host } = await mount();
    await raiseConfirmCard(host);

    expect(document.activeElement).toBe(buttonNamed(host, "记录"));

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await waitFor(() => confirmCard(host) === null, "Esc 关掉卡片");

    expect(await db.timeEntries.count()).toBe(0);
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
  //
  // 注入形状是**字符串**不是 Error：Tauri 的 invoke 失败 reject 的是 Rust 的 `Err(String)`。
  // 此前这里抛 `new Error(...)`，正好绕开桥里那条只认 Error 的分支，于是用例绿着、
  // 还能读到原因，而真机上用户看到的是无信息的「打点失败」四个字。
  it("一次打点失败不卡死队列：出通知（读得到 Rust 给的原因），下一次照常写库", async () => {
    await seedPunchable();
    await mount();

    ipc.invoke.mockImplementationOnce(async (cmd: string) => {
      calls.push(cmd);
      // eslint 会嫌弃，但这就是 Tauri 的真实形状。
      throw "读取配置文件 C:\\Users\\me\\desktop-config.json 失败：拒绝访问";
    });

    await emitPunch(PRESSED_AT_MS);
    expect(ipc.invoke).toHaveBeenCalledWith("notify_user", {
      title: "TimeData",
      body: "读取配置文件 C:\\Users\\me\\desktop-config.json 失败：拒绝访问",
    });
    expect(await db.timeEntries.count()).toBe(1); // 失败那次一个字没写，只剩 seed

    await emitPunch(PRESSED_AT_MS);
    expect(await db.timeEntries.count()).toBe(2); // 队列没卡死
  });

  it("失败原因也画进窗口（通知被系统吞掉时还看得见）", async () => {
    await seedPunchable();
    const { host } = await mount();

    ipc.invoke.mockImplementationOnce(async (cmd: string) => {
      calls.push(cmd);
      throw "读取配置文件失败：拒绝访问";
    });

    await emitPunch(PRESSED_AT_MS);
    expect(host.querySelector('[aria-label="桌面打点提示"]')?.textContent).toContain("拒绝访问");
  });

  // Error 形状（前端自己抛的，如 invokeDesktop 的非桌面守卫）也要读得出原文。
  it("失败注入换成 Error 形状时同样读得到原因", async () => {
    await seedPunchable();
    await mount();

    ipc.invoke.mockImplementationOnce(async (cmd: string) => {
      calls.push(cmd);
      throw new Error("invokeDesktop 只能在桌面壳里调用");
    });

    await emitPunch(PRESSED_AT_MS);
    expect(ipc.invoke).toHaveBeenCalledWith("notify_user", {
      title: "TimeData",
      body: "invokeDesktop 只能在桌面壳里调用",
    });
  });
});
