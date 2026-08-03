import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEntryMutations } from "../../hooks/useEntries.js";
import type { DesktopConfigDto, DesktopHotkeyEvent } from "../../lib/desktop/api.js";
import { invokeDesktop, listenDesktopHotkey } from "../../lib/desktop/api.js";
import { desktopPunch, rangeHours, type DesktopPunchOutcome } from "../../lib/desktop/desktopPunch.js";
import { formatTime } from "../../lib/time.js";
import { DesktopPunchLayer, type DesktopConfirmState, type DesktopUndoState } from "./DesktopPunchLayer.js";

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
}

export const IDLE_BRIDGE_STATE: BridgeState = { undo: null, confirm: null };

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
      return { undo: { message, entryId: outcome.entry.id }, confirm: null };
    }
    case "needsConfirm": {
      await quietly(() => io.invoke("show_main"));
      return {
        undo: prev.undo,
        confirm: {
          message: `要把 ${formatTime(outcome.range.startTime)}–${formatTime(outcome.range.endTime)} 记为打点吗？`,
          retry,
          pressedAtMs,
          approvedHours: rangeHours(outcome.range),
        },
      };
    }
    case "noRange":
      await notify(io, "距上次记录还没有时间");
      return prev;
    case "missingCategory":
      await notify(io, "请先在设置里选择打点分类");
      return prev;
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
  return applyPunchOutcome(outcome, pending.pressedAtMs, true, io, { undo: prev.undo, confirm: null });
}

/** 撤销条上点「撤销」：删掉刚写的那条，撤销条随即收起。 */
export async function undoPunch(prev: BridgeState, io: DesktopBridgeIo): Promise<BridgeState> {
  if (prev.undo) await io.deleteEntry(prev.undo.entryId);
  return { undo: null, confirm: prev.confirm };
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
  await io.invoke("desktop_ready");
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

  const io = useMemo<DesktopBridgeIo>(
    () => ({
      invoke: invokeDesktop,
      listen: listenDesktopHotkey,
      deleteEntry: (id) => deleteEntryRef.current(id),
    }),
    [],
  );

  const run = useCallback(
    async (step: () => Promise<BridgeState>) => {
      try {
        setState(await step());
      } catch (err) {
        await notify(io, err instanceof Error ? err.message : "打点失败");
      }
    },
    [io],
  );

  // 监听只挂一次，但它要用到每次渲染后的最新 state / deleteEntry，故走 ref 转手。
  const punchRef = useRef<(pressedAtMs: number) => void>(() => {});
  useEffect(() => {
    deleteEntryRef.current = deleteEntry;
    punchRef.current = (pressedAtMs) => void run(() => punchFromHotkey(pressedAtMs, io, state));
  });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        const un = await startDesktopBridge(io, (pressedAtMs) => punchRef.current(pressedAtMs));
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
  }, [io]);

  return (
    <DesktopPunchLayer
      undo={state.undo}
      confirm={state.confirm}
      onUndo={() => void run(() => undoPunch(state, io))}
      onDismissUndo={() => setState((prev) => ({ ...prev, undo: null }))}
      onConfirm={() => void run(() => confirmPunch(state, io))}
      onCancelConfirm={() => setState((prev) => ({ ...prev, confirm: null }))}
    />
  );
}
