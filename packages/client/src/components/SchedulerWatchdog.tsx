import { startTransition, useEffect, useRef, useState } from "react";
import { useAppResumeRefresh } from "../hooks/useAppResumeRefresh.ts";
import { markReload } from "../lib/recovery/reloadAttribution.ts";
import { kickScheduler } from "../lib/schedulerHostGuard.ts";

/**
 * 探针从发出到判定死锁的等待窗口。
 *
 * 正常路径下 transition 更新在几十毫秒内就落地，这里留出两个数量级的余量：
 * React 自己给 transition 的饥饿保护也在 5 秒量级，正常情况早就自行收敛了，
 * 还没落地的只可能是调度器真的停摆。窗口再收窄就是拿误判换恢复速度，不值。
 */
export const SCHEDULER_PROBE_TIMEOUT_MS = 5000;

/**
 * 补一拍之后再给调度器的宽限。补拍若奏效，积压会在同一拍里冲干净、探针立刻落地，
 * 所以这个窗口只需覆盖「一次提交」的量级，不必再等一个探针窗口。
 */
export const SCHEDULER_KICK_GRACE_MS = 1000;

/** 页面本就冻着，没有能被打断的交互；reload 保留当前 URL，路由自然回到原处。 */
function reloadPage(): void {
  // 先留墓碑再重载：新页面靠「是 reload 却没有墓碑」识别 iOS 回收渲染进程那条路径，
  // 这里不留，本次自救就会被误统计成一次系统回收。
  markReload("watchdog", Date.now());
  window.location.reload();
}

interface SchedulerWatchdogProps {
  /** 补拍也救不回来时的最后手段。默认重载页面——注入点只为测试。 */
  onDeadlock?: () => void;
  /** 探针等待窗口，默认 {@link SCHEDULER_PROBE_TIMEOUT_MS}。 */
  timeoutMs?: number;
  /** 补拍后的宽限窗口，默认 {@link SCHEDULER_KICK_GRACE_MS}。 */
  kickGraceMs?: number;
}

/**
 * React 调度器死锁看门狗：每次回到前台发一枚 transition 探针，超时没落地就先补一拍、再不行才重载。
 *
 * iOS 的 WKWebView 在 App 挂起时会丢掉调度器那条 MessageChannel 的在途消息，
 * 导致 `scheduler` 内部的「消息循环已在跑」开关永久卡住，**所有走调度器的更新一起停摆**
 * （路由导航、liveQuery 回流），而点击里直接改 state 照常生效——现场就是
 * 「弹层点得开、底栏 tab 点不动、数据写进去了但画面不刷」，且没有自愈路径。
 * 成因与补拍的原理见 `lib/schedulerHostGuard.ts`。
 *
 * **探针必须走 transition**：同步 setState 走微任务通道，那条根本没坏，探不出问题。
 *
 * **补拍优先于重载**：补一拍就是把丢掉的那条消息重发一遍，成功的话用户毫无感知；
 * 重载则丢掉滚动位置与未提交输入，只在补拍没能救回来时才用。
 *
 * 不按平台 gate：同一套 WebKit 在 iOS Safari 的 PWA 里同样会中招（那里
 * `Capacitor.getPlatform()` 返回 web），而正常平台永远不会触发，成本是每次恢复一枚定时器。
 */
export function SchedulerWatchdog({
  onDeadlock,
  timeoutMs = SCHEDULER_PROBE_TIMEOUT_MS,
  kickGraceMs = SCHEDULER_KICK_GRACE_MS,
}: SchedulerWatchdogProps = {}) {
  const [probe, setProbe] = useState(0);
  /**
   * 已落地的探针序号。**必须在渲染期同步写**：搬进 useEffect 就变成「effect 还跑不跑」的探测，
   * 而 effect 与提交同生共死——提交本身被调度器卡住时 effect 根本不会跑，两者分不开，
   * 探针也就永远只会报「死了」。渲染期赋值是幂等的，StrictMode 双渲染无副作用。
   */
  const landedRef = useRef(0);
  landedRef.current = probe;

  /** 自救只做一次：reload 已在路上时再触发一次没有意义。 */
  const firedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDeadlockRef = useRef(onDeadlock);
  onDeadlockRef.current = onDeadlock;

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );

  useAppResumeRefresh(() => {
    if (firedRef.current) return;
    const expected = landedRef.current + 1;
    startTransition(() => setProbe(expected));

    const landed = () => landedRef.current >= expected;
    const giveUp = () => {
      firedRef.current = true;
      (onDeadlockRef.current ?? reloadPage)();
    };

    // 一次恢复会同时触发 visibilitychange / focus / appStateChange 好几条，只留最后一枚定时器：
    // 它们在同一拍里算出的 expected 相同（中间没有重渲染），留哪枚都等价。
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (firedRef.current || landed()) return;

      // 先补一拍：把 WebView 丢掉的那条调度消息重发一遍。救回来用户无感，比重载便宜得多。
      // 补不出去（没记到调度器端口 / 投递抛错）就没有中间档可走，直接进最后手段。
      if (!kickScheduler()) {
        giveUp();
        return;
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (firedRef.current || landed()) return;
        giveUp();
      }, kickGraceMs);
    }, timeoutMs);
  });

  return null;
}
