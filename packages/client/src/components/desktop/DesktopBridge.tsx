import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEntryMutations } from "../../hooks/useEntries.js";
import type { DesktopConfigDto, DesktopHotkeyEvent } from "../../lib/desktop/api.js";
import { invokeDesktop, listenDesktopHotkey, messageOf } from "../../lib/desktop/api.js";
import { desktopPunch, rangeHours, type DesktopPunchOutcome } from "../../lib/desktop/desktopPunch.js";
import { formatTime } from "../../lib/time.js";
import {
  DesktopPunchLayer,
  type DesktopConfirmState,
  type DesktopNoticeState,
  type DesktopUndoState,
} from "./DesktopPunchLayer.js";

/**
 * 桥接层与外界的全部接触面。抽成参数而不是直接调模块函数，打点全链路（含「批准后重试」
 * 这条状态机）才能在 node 环境用真库跑完，不必起 DOM、也不必 mock 掉业务函数。
 */
export interface DesktopBridgeIo {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen: (handler: (event: DesktopHotkeyEvent) => void) => Promise<() => void>;
  deleteEntry: (id: string) => Promise<void>;
}

export interface UndoPending extends DesktopUndoState {
  entryId: string;
}

export interface ConfirmPending extends DesktopConfirmState {
  pressedAtMs: number;
  /**
   * 用户批准的区间长度。确认时数据可能变了：变短照写（更准），变长则再弹一次卡，
   * 不闷头写下用户没看过的区间（T5 修复波的 Critical：批准 1 小时曾能落库 12 小时）。
   */
  approvedHours: number;
}

export interface BridgeState {
  undo: UndoPending | null;
  confirm: ConfirmPending | null;
  /**
   * 窗口内的提示条。`noRange` / `missingCategory` / 队列里抛出来的失败此前**只**发系统通知，
   * 而通知两端各吞一次（Rust 的 `let _ = …show()` + 前端的 `quietly`）。专注助手开着、
   * 或通知权限关了，这几条出口就是屏幕上零变化——最伤的是全新装机必然没配打点分类，
   * 按热键走 `missingCategory`：不写库、不提窗、无红字，用户只会去查热键注册（设置页全绿）。
   * `needsConfirm` 有确认卡兜底、`written` 有撤销条兜底，恰恰这两条需要用户去做点什么的没有。
   */
  notice: DesktopNoticeState | null;
}

export const IDLE_BRIDGE_STATE: BridgeState = { undo: null, confirm: null, notice: null };

// 通知与「把主窗口提到前面」都是尽力而为的告知手段：它们失败不该把「已经写进库了 /
// 该弹卡了」这个结论一起吞掉。真正的失败（读配置、写库）照旧往上抛给调用方。
async function quietly(call: () => Promise<unknown>): Promise<void> {
  try {
    await call();
  } catch {
    // 告知失败不影响判定结果
  }
}

async function notify(io: DesktopBridgeIo, body: string): Promise<void> {
  await quietly(() => io.invoke("notify_user", { title: "TimeData", body }));
}

/**
 * 把一次打点结果落成下一份 UI 状态并发出对应反馈。
 * retry 标记这次 needsConfirm 是不是「点过记录之后又弹的」，决定确认卡的副文案。
 */
export async function applyPunchOutcome(
  outcome: DesktopPunchOutcome,
  pressedAtMs: number,
  retry: boolean,
  io: DesktopBridgeIo,
  prev: BridgeState,
): Promise<BridgeState> {
  switch (outcome.kind) {
    case "written": {
      const message = `已打点 ${formatTime(outcome.entry.startTime)}–${formatTime(outcome.entry.endTime)}`;
      await notify(io, message);
      return { undo: { message, entryId: outcome.entry.id }, confirm: null, notice: null };
    }
    case "needsConfirm": {
      const message = `要把 ${formatTime(outcome.range.startTime)}–${formatTime(outcome.range.endTime)} 记为打点吗？`;
      await quietly(() => io.invoke("show_main"));
      // 也发一条通知：Windows 的前台锁会把 set_focus 降级成任务栏闪烁（用户在别的应用
      // 全屏时尤其如此），只靠 show_main 的话这次按键可以是零可观察结果——
      // 用户根本不知道有张卡在等他。四条出口里这条曾是唯一不发通知的。
      await notify(io, `${message}（到 TimeData 窗口里确认）`);
      return {
        undo: prev.undo,
        confirm: { message, retry, pressedAtMs, approvedHours: rangeHours(outcome.range) },
        notice: null,
      };
    }
    // 下面两条出口都**清掉停留中的确认卡**：卡上写的区间是按下那一刻算的，走到这两条
    // 说明当下数据已经不支持那张卡了（区间被盖满 / 分类没了）。留着它，屏幕上就是
    // 「通知说没时间可记，却挂着一张要你记 00:00–12:00 的卡」这种自相矛盾的中间态。
    case "noRange": {
      const message = "距上次记录还没有时间";
      await notify(io, message);
      return { undo: prev.undo, confirm: null, notice: { message } };
    }
    case "missingCategory": {
      const message = "请先在设置里选择打点分类";
      // 这条要用户去做点什么（进设置选分类），所以除了通知还要把窗口提起来。
      await quietly(() => io.invoke("show_main"));
      await notify(io, message);
      return { undo: prev.undo, confirm: null, notice: { message } };
    }
  }
}

/** 一次热键按下：按配置阈值预检，超了先问不写。 */
export async function punchFromHotkey(
  pressedAtMs: number,
  io: DesktopBridgeIo,
  prev: BridgeState,
): Promise<BridgeState> {
  const config = await io.invoke<DesktopConfigDto>("get_desktop_config");
  const outcome = await desktopPunch(pressedAtMs, config.punchConfirmHours);
  return applyPunchOutcome(outcome, pressedAtMs, false, io, prev);
}

/** 确认卡上点「记录」：上限 = 用户批准的那个区间长度，变长了就再问一次而不是闷头写。 */
export async function confirmPunch(prev: BridgeState, io: DesktopBridgeIo): Promise<BridgeState> {
  const pending = prev.confirm;
  if (!pending) return prev;
  const outcome = await desktopPunch(pending.pressedAtMs, pending.approvedHours);
  return applyPunchOutcome(outcome, pending.pressedAtMs, true, io, {
    undo: prev.undo,
    confirm: null,
    notice: null,
  });
}

/** 撤销条上点「撤销」：删掉刚写的那条，撤销条随即收起。 */
export async function undoPunch(prev: BridgeState, io: DesktopBridgeIo): Promise<BridgeState> {
  if (prev.undo) await io.deleteEntry(prev.undo.entryId);
  return { ...prev, undo: null };
}

/**
 * 挂监听并向壳报到。**先挂监听、后报 desktop_ready**：Rust 收到 ready 会立刻把 WebView
 * 就绪前排队的按键投出来（spec §五.3），顺序颠倒这批补投就全打在没有听众的窗口上。
 */
export async function startDesktopBridge(
  io: Pick<DesktopBridgeIo, "invoke" | "listen">,
  onPunch: (pressedAtMs: number) => void,
): Promise<() => void> {
  const unlisten = await io.listen((event) => {
    // toggleMain 由 Rust 直办，前端只认 punch。
    if (event.action === "punch") onPunch(event.pressedAtMs);
  });
  try {
    await io.invoke("desktop_ready");
  } catch (err) {
    // 先占资源、后可能抛：这一步 reject 时监听已经挂上了，而注销函数还没 return 出去——
    // 调用方的 unlisten 停在 null，卸载时是空操作，监听就此泄漏（重挂一次桥再泄漏一次）。
    unlisten();
    throw err;
  }
  return unlisten;
}

/**
 * 桌面壳事件桥：只在 isDesktopShell() 为真时被 App 挂载（App.tsx 的 gate 是三端回归的唯一保证）。
 * 组件本身只持状态与接线，判定与副作用全在上面那几个可在 node 里跑的函数里。
 */
export function DesktopBridge() {
  const [state, setState] = useState<BridgeState>(IDLE_BRIDGE_STATE);
  const { deleteEntry } = useEntryMutations();
  const deleteEntryRef = useRef(deleteEntry);
  // 队列里跑的那一步要看到「上一步跑完之后」的状态，而不是渲染时捕获的那份。
  const stateRef = useRef(state);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const io = useMemo<DesktopBridgeIo>(
    () => ({
      invoke: invokeDesktop,
      listen: listenDesktopHotkey,
      deleteEntry: (id) => deleteEntryRef.current(id),
    }),
    [],
  );

  /**
   * 全部状态转移排成一条串行队列。热键连按两下会并发跑两次打点，各自 ~8 个 await 必然交错：
   * 两次都在对方写库前读到同一条「上一条记录」，算出同一区间，各写一条完全重叠的假记录
   * （punchNow 的 overlapPlan 为 null，不裁剪）。串行化顺带治好状态陈旧——第二次打点看得见
   * 第一次写下的记录，于是正确地报「距上次记录还没有时间」。
   */
  const run = useCallback(
    (step: (prev: BridgeState) => Promise<BridgeState>) => {
      queueRef.current = queueRef.current.then(async () => {
        try {
          const next = await step(stateRef.current);
          stateRef.current = next;
          setState(next);
        } catch (err) {
          // catch 必须在 .then 回调内部：漏在外面时一次 reject 会截断整条链，
          // 此后每次打点都静音且无报错。notify 走 quietly，catch 自身不会再 reject。
          // 失败的原因要**两条路**都给：窗口内的提示条（通知被系统吞掉时它还在）+ 系统通知
          // （窗口整段隐藏时它还在）。messageOf 而不是只认 Error——invoke 失败 reject 的是字符串。
          const message = messageOf(err, "打点失败");
          const next = { ...stateRef.current, notice: { message } };
          stateRef.current = next;
          setState(next);
          await notify(io, message);
        }
      });
    },
    [io],
  );

  useEffect(() => {
    deleteEntryRef.current = deleteEntry;
  });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        const un = await startDesktopBridge(io, (pressedAtMs) => run((prev) => punchFromHotkey(pressedAtMs, io, prev)));
        if (cancelled) {
          un();
          return;
        }
        unlisten = un;
      } catch {
        // 壳没起来 / 事件权限缺失：桥不可用，主窗口其余功能照常。
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [io, run]);

  return (
    <DesktopPunchLayer
      undo={state.undo}
      confirm={state.confirm}
      notice={state.notice}
      onUndo={() => run((prev) => undoPunch(prev, io))}
      onDismissUndo={() => run(async (prev) => ({ ...prev, undo: null }))}
      onDismissNotice={() => run(async (prev) => ({ ...prev, notice: null }))}
      onConfirm={() => run((prev) => confirmPunch(prev, io))}
      onCancelConfirm={() => run(async (prev) => ({ ...prev, confirm: null }))}
    />
  );
}
