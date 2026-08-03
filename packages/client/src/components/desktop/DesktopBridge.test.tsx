import type { Category } from "@timedata/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopHotkeyEvent } from "../../lib/desktop/api.js";
import { setPunchCategoryId } from "../../lib/settings/punchCategorySetting.js";
import { db, resetDb } from "../../test/dbReset.js";
import {
  confirmPunch,
  DesktopBridge,
  IDLE_BRIDGE_STATE,
  punchFromHotkey,
  startDesktopBridge,
  undoPunch,
  type DesktopBridgeIo,
} from "./DesktopBridge.js";

// APP 时区 +08:00。pressedAt = 2026-06-15 12:00 (+08:00)。
const PRESSED_AT_MS = new Date("2026-06-15T04:00:00.000Z").getTime();
const PUNCH_CATEGORY_ID = "cat-deep";
const CONFIG = { autostartDisabled: false, punchConfirmHours: 4, hotkeys: [] };

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

async function configurePunchCategory() {
  await db.categories.bulkAdd([category("cat-work", "工作", null), category(PUNCH_CATEGORY_ID, "深度", "cat-work")]);
  await setPunchCategoryId(PUNCH_CATEGORY_ID);
  await db.syncLog.clear();
}

async function seedEntry(startTime: string, endTime: string) {
  await db.timeEntries.add({
    id: "seed-1",
    categoryId: PUNCH_CATEGORY_ID,
    startTime,
    endTime,
    note: null,
    createdAt: endTime,
    updatedAt: endTime,
  });
}

/** IPC / 删记录这两个接触面注入进来，全链路才能在 node 环境用真库跑。 */
function makeIo(overrides: Partial<typeof CONFIG> = {}) {
  const invoke = vi.fn(async (cmd: string) => (cmd === "get_desktop_config" ? { ...CONFIG, ...overrides } : undefined));
  const listen = vi.fn(async (_handler: (event: DesktopHotkeyEvent) => void) => () => {});
  const deleteEntry = vi.fn(async (id: string) => {
    await db.timeEntries.delete(id);
  });
  const io = { invoke, listen, deleteEntry } as unknown as DesktopBridgeIo;
  return { io, invoke, listen, deleteEntry };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 纯让位：把已排队的微任务放完，不等真实时间。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(resetDb);

describe("startDesktopBridge 接线顺序", () => {
  it("监听挂上之前不许报 desktop_ready（顺序颠倒，排队补投的按键全打在没听众的窗口上）", async () => {
    const { io, invoke, listen } = makeIo();
    const gate = deferred<() => void>();
    listen.mockImplementation(() => gate.promise);

    const started = startDesktopBridge(io, vi.fn());
    await flush();
    expect(listen).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();

    gate.resolve(() => {});
    await started;
    expect(invoke).toHaveBeenCalledWith("desktop_ready");
  });

  it("只有 punch 事件交给前端打点，toggleMain 由 Rust 直办不落到这里", async () => {
    const handlers: ((event: DesktopHotkeyEvent) => void)[] = [];
    const { io, listen } = makeIo();
    listen.mockImplementation(async (handler: (event: DesktopHotkeyEvent) => void) => {
      handlers.push(handler);
      return () => {};
    });
    const onPunch = vi.fn();

    await startDesktopBridge(io, onPunch);
    expect(handlers).toHaveLength(1);

    handlers[0]({ action: "toggleMain", pressedAtMs: 1 });
    expect(onPunch).not.toHaveBeenCalled();

    handlers[0]({ action: "punch", pressedAtMs: PRESSED_AT_MS });
    expect(onPunch).toHaveBeenCalledWith(PRESSED_AT_MS);
  });

  it("返回的是 listen 给的注销函数（卸载时能真摘掉监听）", async () => {
    const unlisten = vi.fn();
    const { io, listen } = makeIo();
    listen.mockImplementation(async () => unlisten);

    const returned = await startDesktopBridge(io, vi.fn());
    returned();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  // 先 listen 再 invoke：中间那步 reject 时监听已经挂上，而注销函数还没 return 出去。
  // 不在这里摘掉就永远摘不掉了——调用方的 unlisten 停在 null，卸载时是空操作。
  it("desktop_ready 失败时先把监听摘掉再抛，不留下摘不掉的监听", async () => {
    const unlisten = vi.fn();
    const { io, listen, invoke } = makeIo();
    listen.mockImplementation(async () => unlisten);
    invoke.mockRejectedValueOnce(new Error("壳没起来"));

    await expect(startDesktopBridge(io, vi.fn())).rejects.toThrow("壳没起来");
    expect(unlisten).toHaveBeenCalledOnce();
  });
});

describe("热键打点分流", () => {
  it("阈值内：写入 + 成功通知 + 撤销条就位", async () => {
    await configurePunchCategory();
    await seedEntry("2026-06-15T00:00:00.000Z", "2026-06-15T03:00:00.000Z");
    const { io, invoke } = makeIo();

    const next = await punchFromHotkey(PRESSED_AT_MS, io, IDLE_BRIDGE_STATE);

    expect(invoke).toHaveBeenCalledWith("get_desktop_config");
    expect(invoke).toHaveBeenCalledWith("notify_user", { title: "TimeData", body: "已打点 11:00–12:00" });
    expect(next.undo?.message).toBe("已打点 11:00–12:00");
    expect(next.confirm).toBeNull();
    expect(await db.timeEntries.count()).toBe(2);
  });

  it("超阈值：不写、show_main、弹首次确认卡；点「记录」才落笔", async () => {
    await configurePunchCategory();
    const { io, invoke } = makeIo();

    const asked = await punchFromHotkey(PRESSED_AT_MS, io, IDLE_BRIDGE_STATE);
    expect(invoke).toHaveBeenCalledWith("show_main");
    expect(asked.confirm?.message).toBe("要把 00:00–12:00 记为打点吗？");
    expect(asked.confirm?.retry).toBe(false);
    expect(await db.timeEntries.count()).toBe(0);

    const done = await confirmPunch(asked, io);
    expect(done.confirm).toBeNull();
    expect(done.undo?.message).toBe("已打点 00:00–12:00");
    expect(await db.timeEntries.count()).toBe(1);
  });

  // T5 修复波 Critical 的桥接侧真闸：用户批准的那个长度必须随「记录」一起传回去，
  // 否则批准 1 小时能闷头落库 12 小时。
  it("确认期间区间变长（同步删了记录）：一个字都不写，改弹新区间的卡并标成重试", async () => {
    await configurePunchCategory();
    await seedEntry("2026-06-14T22:00:00.000Z", "2026-06-15T03:00:00.000Z");
    const { io } = makeIo({ punchConfirmHours: 0.5 });

    const asked = await punchFromHotkey(PRESSED_AT_MS, io, IDLE_BRIDGE_STATE);
    expect(asked.confirm?.message).toBe("要把 11:00–12:00 记为打点吗？"); // 卡上给看的是 1 小时
    expect(asked.confirm?.retry).toBe(false);

    await db.timeEntries.clear(); // 用户盯着卡的这会儿，那条记录被同步删掉了

    const again = await confirmPunch(asked, io);
    expect(again.confirm?.message).toBe("要把 00:00–12:00 记为打点吗？"); // 换新区间再问一次
    expect(again.confirm?.retry).toBe(true);
    expect(await db.timeEntries.count()).toBe(0); // 一个字都没写
  });

  // 全新装机必然没配打点分类（首次启动是空数据），这条是新用户最先撞上的出口。
  // 系统通知两端各吞一次（Rust 的 `let _ = …show()` + 桥的 quietly），专注助手开着 /
  // 通知权限关了就是屏幕上零变化——所以除了通知，必须有一个**不经通知通道**的落点：
  // 窗口内提示条 + 把窗口提起来（这条要用户去设置里做点什么）。
  it("未配置打点分类：通知 + 提窗 + 窗口内提示条，不写", async () => {
    const { io, invoke } = makeIo();

    const next = await punchFromHotkey(PRESSED_AT_MS, io, IDLE_BRIDGE_STATE);

    expect(invoke).toHaveBeenCalledWith("notify_user", { title: "TimeData", body: "请先在设置里选择打点分类" });
    expect(invoke).toHaveBeenCalledWith("show_main");
    expect(next.notice?.message).toBe("请先在设置里选择打点分类");
    expect(next.undo).toBeNull();
    expect(next.confirm).toBeNull();
    expect(await db.timeEntries.count()).toBe(0);
  });

  it("无时间可记：通知 + 窗口内提示条，不写", async () => {
    await configurePunchCategory();
    await seedEntry("2026-06-15T00:00:00.000Z", "2026-06-15T04:00:00.000Z"); // 盖到按键时刻
    const { io, invoke } = makeIo();

    const next = await punchFromHotkey(PRESSED_AT_MS, io, IDLE_BRIDGE_STATE);

    expect(invoke).toHaveBeenCalledWith("notify_user", { title: "TimeData", body: "距上次记录还没有时间" });
    expect(next.notice?.message).toBe("距上次记录还没有时间");
    expect(next.confirm).toBeNull();
    expect(await db.timeEntries.count()).toBe(1);
  });

  // A4 的判据：新加的落点要真能让用户看见，不能是又一层同样会被吞掉的东西。
  // 通知**发不出去**（invoke 抛）时，窗口内提示条必须照样在。
  it("通知发不出去时窗口内提示条照样在（不能两条反馈同生共死）", async () => {
    const { io, invoke } = makeIo();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "notify_user") throw new Error("通知权限被关了");
      return cmd === "get_desktop_config" ? CONFIG : undefined;
    });

    const next = await punchFromHotkey(PRESSED_AT_MS, io, IDLE_BRIDGE_STATE);

    expect(next.notice?.message).toBe("请先在设置里选择打点分类");
  });
});

describe("撤销", () => {
  it("撤销删掉刚写的那条、撤销条随即消失", async () => {
    await configurePunchCategory();
    await seedEntry("2026-06-15T00:00:00.000Z", "2026-06-15T03:00:00.000Z");
    const { io, deleteEntry } = makeIo();

    const written = await punchFromHotkey(PRESSED_AT_MS, io, IDLE_BRIDGE_STATE);
    expect(await db.timeEntries.count()).toBe(2);
    const entryId = written.undo?.entryId;
    expect(entryId).toBeTruthy();

    const after = await undoPunch(written, io);

    expect(deleteEntry).toHaveBeenCalledWith(entryId);
    expect(after.undo).toBeNull();
    expect(await db.timeEntries.count()).toBe(1); // 只剩 seed 那条
  });

  it("没有可撤销的记录时不乱删", async () => {
    const { io, deleteEntry } = makeIo();

    const after = await undoPunch(IDLE_BRIDGE_STATE, io);

    expect(deleteEntry).not.toHaveBeenCalled();
    expect(after.undo).toBeNull();
  });
});

describe("DesktopBridge 组件", () => {
  it("空闲时不吐任何 DOM（挂进 App 不影响版式）", () => {
    expect(renderToStaticMarkup(createElement(DesktopBridge))).toBe("");
  });
});
