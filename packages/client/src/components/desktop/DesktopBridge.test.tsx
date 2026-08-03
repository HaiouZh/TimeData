import type { Category } from "@timedata/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopHotkeyEvent } from "../../lib/desktop/api.js";
import { setPunchCategoryId } from "../../lib/settings/punchCategorySetting.js";
import { db, resetDb } from "../../test/dbReset.js";
import {
  cancelConfirm,
  confirmPunch,
  DesktopBridge,
  dismissNotice,
  dismissUndo,
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

    const done = await confirmPunch(asked, io, asked.confirm);
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

    const again = await confirmPunch(asked, io, asked.confirm);
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

    const after = await undoPunch(written, io, written.undo);

    expect(deleteEntry).toHaveBeenCalledWith(entryId);
    expect(after.undo).toBeNull();
    expect(await db.timeEntries.count()).toBe(1); // 只剩 seed 那条
  });

  it("没有可撤销的记录时不乱删", async () => {
    const { io, deleteEntry } = makeIo();

    const after = await undoPunch(IDLE_BRIDGE_STATE, io, null);

    expect(deleteEntry).not.toHaveBeenCalled();
    expect(after.undo).toBeNull();
  });
});

// 队列里排队要几十~几百毫秒（一趟 IPC + 读盘 + 若干 Dexie 事务 + 一次通知）。用户在这个
// 窗口里点上一条撤销条的按钮时，队列会先跑完新打点、把状态里的撤销条 / 确认卡换成新的，
// 然后才轮到他这一下——不带身份就会作用在**他没看过的那一条**上。
describe("动作带身份：排队期间状态被换掉就放弃，不动新的那条", () => {
  it("撤销删的是他看着的那条；队列里已换成新记录时一个字不删", async () => {
    await configurePunchCategory();
    await seedEntry("2026-06-15T00:00:00.000Z", "2026-06-15T03:00:00.000Z");
    const { io, deleteEntry } = makeIo();

    const written = await punchFromHotkey(PRESSED_AT_MS, io, IDLE_BRIDGE_STATE);
    const staleUndo = written.undo; // 用户点「撤销」时屏幕上的那条（entry A）
    expect(staleUndo).toBeTruthy();

    // 他点下去之后、这一下轮到之前，队列先跑完了另一次打点，撤销条换成了 entry B
    const swapped = { ...written, undo: { message: "已打点 12:00–12:30", entryId: "entry-B" } };

    const after = await undoPunch(swapped, io, staleUndo);

    expect(deleteEntry).not.toHaveBeenCalled(); // 尤其不能删 entry-B
    expect(after.undo).toBe(swapped.undo); // 新撤销条原样留在屏幕上
    expect(await db.timeEntries.count()).toBe(2);
  });

  it("「✕」只关他看的那条，队列里刚弹出来的新撤销条不许被顺手带走", () => {
    const stale = { message: "已打点 11:00–12:00", entryId: "entry-A" };
    const fresh = { message: "已打点 12:00–12:30", entryId: "entry-B" };

    expect(dismissUndo({ ...IDLE_BRIDGE_STATE, undo: fresh }, stale).undo).toBe(fresh);
    expect(dismissUndo({ ...IDLE_BRIDGE_STATE, undo: fresh }, fresh).undo).toBeNull();
  });

  it("「算了」只关他看的那张卡，队列里刚弹的新卡不许被顺手带走", () => {
    const stale = { message: "要把 00:00–12:00 记为打点吗？", retry: false, pressedAtMs: 1, approvedHours: 12 };
    const fresh = { message: "要把 11:00–12:00 记为打点吗？", retry: false, pressedAtMs: 2, approvedHours: 1 };

    expect(cancelConfirm({ ...IDLE_BRIDGE_STATE, confirm: fresh }, stale).confirm).toBe(fresh);
    expect(cancelConfirm({ ...IDLE_BRIDGE_STATE, confirm: fresh }, fresh).confirm).toBeNull();
  });

  // 提示条只有 message 一个字段，屏幕上完全由它决定。三个生产者每次都现造 { message }，
  // 于是「文案一模一样但换了对象」是必然会发生的一种状态更替——引用比对在这里退化成
  // 「点了 ✕ 没反应」：屏幕上文字前后一个字不差，用户不知道自己点空了。
  it("同文案的提示条被换成新对象后，✕ 照样要能关掉（不能「点了没反应」）", async () => {
    await configurePunchCategory();
    await seedEntry("2026-06-15T00:00:00.000Z", "2026-06-15T04:00:00.000Z"); // 区间被盖满 → noRange
    const { io } = makeIo();

    const first = await punchFromHotkey(PRESSED_AT_MS, io, IDLE_BRIDGE_STATE);
    const seen = first.notice; // 用户点 ✕ 时屏幕上的这一条
    expect(seen?.message).toBe("距上次记录还没有时间");

    // 他点下去的同一瞬间，队列里还有一次打点在跑，那次也走 noRange
    const second = await punchFromHotkey(PRESSED_AT_MS, io, first);
    expect(second.notice).not.toBe(seen); // 现造的新对象（这一条是下面那句的前提）
    expect(second.notice?.message).toBe(seen?.message); // 而屏幕上一个字没变

    expect(dismissNotice(second, seen).notice).toBeNull();
  });

  it("文案变了说明换了一条（用户看得出来），✕ 不许把新的那条顺手带走", () => {
    const seen = { message: "距上次记录还没有时间" };
    const fresh = { message: "请先在设置里选择打点分类" };

    expect(dismissNotice({ ...IDLE_BRIDGE_STATE, notice: fresh }, seen).notice).toBe(fresh);
    expect(dismissNotice({ ...IDLE_BRIDGE_STATE, notice: fresh }, fresh).notice).toBeNull();
  });

  // 身份用对象引用而不是 pressedAtMs：重试卡与原卡的 pressedAtMs **相同**（同一次按键），
  // 拿字段比对会把「双击『记录』」放行——第二下按新卡那个更长的已批准长度落笔，
  // 正是 T5 那个 Critical 的失败形态（批准 1 小时，闷头写下 12 小时）。
  it("双击「记录」：第二下作用在重试卡上会写下没批准的长区间，必须被挡住", async () => {
    await configurePunchCategory();
    await seedEntry("2026-06-14T22:00:00.000Z", "2026-06-15T03:00:00.000Z");
    const { io } = makeIo({ punchConfirmHours: 0.5 });

    const asked = await punchFromHotkey(PRESSED_AT_MS, io, IDLE_BRIDGE_STATE);
    expect(asked.confirm?.approvedHours).toBe(1); // 用户看到并批准的是 1 小时

    await db.timeEntries.clear(); // 盯着卡的这会儿那条记录被同步删了
    const again = await confirmPunch(asked, io, asked.confirm); // 第一下 → 换成 12 小时的重试卡
    expect(again.confirm?.approvedHours).toBe(12);
    expect(again.confirm?.pressedAtMs).toBe(asked.confirm?.pressedAtMs); // 同一次按键，字段比对认不出来

    // 第二下带的仍是**第一张卡**的身份 → 必须原样返回，不能拿 12 小时那个上限去落笔
    const second = await confirmPunch(again, io, asked.confirm);
    expect(second).toBe(again);
    expect(await db.timeEntries.count()).toBe(0);
  });
});

// A22 / A26：停留中的确认卡在这两条出口必须被清掉。留着它，屏幕上就是
// 「通知说没时间可记，却挂着一张要你记 00:00–12:00 的卡」这种自相矛盾的中间态。
describe("停留中的确认卡在 noRange / missingCategory 出口被清掉", () => {
  it("再按热键走 noRange：旧卡不许还挂着（punchFromHotkey 路径）", async () => {
    await configurePunchCategory();
    const { io } = makeIo();

    const asked = await punchFromHotkey(PRESSED_AT_MS, io, IDLE_BRIDGE_STATE);
    expect(asked.confirm).toBeTruthy(); // 卡记着 00:00–12:00

    await seedEntry("2026-06-15T00:00:00.000Z", "2026-06-15T04:00:00.000Z"); // 用户在别处把区间补满了
    const next = await punchFromHotkey(PRESSED_AT_MS, io, asked);

    expect(next.confirm).toBeNull();
    expect(next.notice?.message).toBe("距上次记录还没有时间");
  });

  it("在卡上点「记录」但区间已被盖满：卡片必须关掉，不许赖着不走（confirmPunch 路径）", async () => {
    await configurePunchCategory();
    const { io, invoke } = makeIo();

    const asked = await punchFromHotkey(PRESSED_AT_MS, io, IDLE_BRIDGE_STATE);
    expect(asked.confirm).toBeTruthy();

    await seedEntry("2026-06-15T00:00:00.000Z", "2026-06-15T04:00:00.000Z"); // 盯着卡时同步把区间盖满

    const next = await confirmPunch(asked, io, asked.confirm);

    expect(next.confirm).toBeNull(); // 再点也是一样的结果，卡不能留在屏幕上
    expect(invoke).toHaveBeenCalledWith("notify_user", { title: "TimeData", body: "距上次记录还没有时间" });
    expect(await db.timeEntries.count()).toBe(1); // 只有 seed 那条
  });

  it("在卡上点「记录」但打点分类没了：卡片同样关掉", async () => {
    await configurePunchCategory();
    const { io } = makeIo();

    const asked = await punchFromHotkey(PRESSED_AT_MS, io, IDLE_BRIDGE_STATE);
    await db.categories.clear(); // 分类被同步删了

    const next = await confirmPunch(asked, io, asked.confirm);

    expect(next.confirm).toBeNull();
    expect(next.notice?.message).toBe("请先在设置里选择打点分类");
    expect(await db.timeEntries.count()).toBe(0);
  });
});

describe("DesktopBridge 组件", () => {
  it("空闲时不吐任何 DOM（挂进 App 不影响版式）", () => {
    expect(renderToStaticMarkup(createElement(DesktopBridge))).toBe("");
  });
});
