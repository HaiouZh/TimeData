import { startTransition, useEffect, useRef, useState } from "react";
import { type ResumeSource, useAppResumeRefresh } from "../hooks/useAppResumeRefresh.ts";
import { type Heartbeat, startHeartbeat } from "../lib/recovery/mainThreadHeartbeat.ts";
import { stashPendingReport } from "../lib/recovery/pendingReports.ts";
import { markReload } from "../lib/recovery/reloadAttribution.ts";
import {
  type SchedulerProbeOutcome,
  buildSchedulerProbeReport,
  bumpProbeCount,
} from "../lib/recovery/schedulerProbeReport.ts";
import { probeStorage } from "../lib/recovery/storageProbe.ts";
import { hasSchedulerPort, kickScheduler } from "../lib/schedulerHostGuard.ts";

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

/** 探针落地了、但定时器迟到 ≥ 这么多个窗口，就记一条 late：线程或 App 被冻过，用户照样在等。 */
export const SCHEDULER_LATE_FACTOR = 2;

/** 主线程心跳间隔。只在探针挂着的几秒内跑。 */
export const SCHEDULER_HEARTBEAT_MS = 250;

/** 页面本就冻着，没有能被打断的交互；reload 保留当前 URL，路由自然回到原处。 */
function reloadPage(): void {
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

/** 一枚挂着的探针及其现场。同一拍里的多条恢复事件共用一枚（expected 相同）。 */
interface ArmedProbe {
  expected: number;
  /** 首次发出的 Date.now()。再来的恢复事件不刷新它——waitedMs 要量的是用户真实等了多久。 */
  armedAt: number;
  resumes: number;
  trigger: ResumeSource | null;
  probes: number;
  heartbeat: Heartbeat;
  storageMs: number | null;
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
 * 重载则丢掉滚动位置与未提交输入，只在补拍没能救回来、且页面此刻可见时才用。
 *
 * **每次超时都记现场**（`scheduler_probe`，搭同步上报的车）：端口在不在、补没补出去、补完落没落地、
 * 页面可不可见、真实等了多久、主线程心跳迟到多少、IndexedDB 回没回来——这几个字段合起来才分得清
 * 「调度器死了」「补拍失灵」「看门狗误判」「线程 / 存储被冻」四族根因，见 design §2.1 / §0.4。
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

  /** 重载只做一次：reload 已在路上时再触发一次没有意义。held / recovered / late 都不置位。 */
  const firedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedRef = useRef<ArmedProbe | null>(null);
  const onDeadlockRef = useRef(onDeadlock);
  onDeadlockRef.current = onDeadlock;

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      armedRef.current?.heartbeat.stop();
      armedRef.current = null;
    },
    [],
  );

  useAppResumeRefresh((source) => {
    if (firedRef.current) return;
    const expected = landedRef.current + 1;
    startTransition(() => setProbe(expected));

    // 同一拍里的多条恢复事件（visibilitychange / focus / appStateChange）共用一枚探针：
    // 中间没有重渲染，算出的 expected 相同。只记条数与最后来源，首发时刻不动。
    const existing = armedRef.current;
    let armed: ArmedProbe;
    if (existing && existing.expected === expected) {
      existing.resumes += 1;
      existing.trigger = source ?? null;
      armed = existing;
    } else {
      existing?.heartbeat.stop();
      armed = {
        expected,
        armedAt: Date.now(),
        resumes: 1,
        trigger: source ?? null,
        probes: safeBumpProbeCount(),
        heartbeat: startHeartbeat(SCHEDULER_HEARTBEAT_MS),
        storageMs: null,
      };
      armedRef.current = armed;
      // 与 transition 探针同时打一次 IndexedDB 往返：判定时还没回来 = 存储层被冻。
      const current = armed;
      void probeStorage().then(
        () => {
          if (armedRef.current === current) current.storageMs = Date.now() - current.armedAt;
        },
        () => undefined,
      );
    }

    const landed = () => landedRef.current >= expected;
    const disarm = () => {
      armed.heartbeat.stop();
      if (armedRef.current === armed) armedRef.current = null;
    };
    const report = (fields: {
      outcome: SchedulerProbeOutcome;
      hadPort: boolean;
      kicked: boolean;
      recovered: boolean;
      visible: string;
      waitedMs: number;
    }) => {
      try {
        stashPendingReport(
          buildSchedulerProbeReport({
            ...fields,
            probes: armed.probes,
            maxGapMs: armed.heartbeat.maxGapMs(),
            sinceBootMs: Math.round(performance.now()),
            storageMs: armed.storageMs,
            resumes: armed.resumes,
            trigger: armed.trigger,
          }),
        );
      } catch {
        // 观测失败绝不能影响自救路径
      }
    };

    // 一次恢复会同时触发好几条事件，只留最后一枚定时器：它们的 expected 相同，留哪枚都等价。
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (firedRef.current) return;
      const waitedMs = Date.now() - armed.armedAt;

      if (landed()) {
        // 落地了。定时器若迟到 ≥ 2 个窗口，说明中间线程被冻过——这是重载之外、用户照样在等的那种卡，
        // 不记就永远看不见。准点落地什么都不记（拍板④）。
        if (waitedMs >= timeoutMs * SCHEDULER_LATE_FACTOR) {
          report({
            outcome: "late",
            hadPort: hasSchedulerPort(),
            kicked: false,
            recovered: true,
            visible: document.visibilityState,
            waitedMs,
          });
        }
        disarm();
        return;
      }

      // 先读现场，再补一拍——visible 与 waitedMs 都取自判定这一刻。
      // 不可见也照补（拍板②）：补拍无害；补不出去也不早退——没发出去不代表调度器一定死了。
      const hadPort = hasSchedulerPort();
      const visible = document.visibilityState;
      const kicked = kickScheduler();

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (firedRef.current) return;
        const recovered = landed();
        const outcome: SchedulerProbeOutcome = recovered ? "recovered" : visible === "visible" ? "reload" : "held";
        report({ outcome, hadPort, kicked, recovered, visible, waitedMs });
        disarm();
        if (outcome !== "reload") return;

        // 先留墓碑再重载：新页面靠「是 reload 却没有墓碑」识别 iOS 回收渲染进程那条路径，
        // 这里不留，本次自救就会被误统计成一次系统回收。held / recovered 不重载，也就不留。
        firedRef.current = true;
        markReload("watchdog", Date.now());
        (onDeadlockRef.current ?? reloadPage)();
      }, kickGraceMs);
    }, timeoutMs);
  });

  return null;
}

function safeBumpProbeCount(): number {
  try {
    return bumpProbeCount();
  } catch {
    return -1;
  }
}
