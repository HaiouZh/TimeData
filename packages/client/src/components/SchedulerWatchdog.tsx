import { startTransition, useEffect, useRef, useState } from "react";
import { useAppHidden } from "../hooks/useAppHidden.ts";
import { type ResumeSource, useAppResumeRefresh } from "../hooks/useAppResumeRefresh.ts";
import { CURRENT_BUILD_ID } from "../lib/frontendUpdate.ts";
import { consumeHiddenFlag, hiddenMsSinceInMemory, hiddenMsSincePersisted, markHidden } from "../lib/recovery/lastHidden.ts";
import { snapshotInFlightLazy } from "../lib/recovery/lazyRegistry.ts";
import { type Heartbeat, startHeartbeat } from "../lib/recovery/mainThreadHeartbeat.ts";
import { openSessions } from "../lib/recovery/openSessionRuntime.ts";
import { stashPendingReport } from "../lib/recovery/pendingReports.ts";
import { readColdStartCause } from "../lib/recovery/probe.ts";
import { type ReactRootSnapshot, snapshotReactRoot } from "../lib/recovery/reactRootProbe.ts";
import { markReload } from "../lib/recovery/reloadAttribution.ts";
import { newReportId } from "../lib/recovery/reportId.ts";
import {
  type DirectDrive,
  type SchedulerProbeOutcome,
  buildSchedulerProbeReport,
  bumpProbeCount,
} from "../lib/recovery/schedulerProbeReport.ts";
import { isStorageOpen, probeStorage } from "../lib/recovery/storageProbe.ts";
import { timeStorageProbe } from "../lib/recovery/storageTiming.ts";
import { onSyncTimingRecorded } from "../sync/phaseTimings.ts";
import {
  deliveredSince,
  driveSchedulerDirectly,
  hasSchedulerPort,
  kickScheduler,
  pendingMessageMs,
  schedulerDeliveryState,
} from "../lib/schedulerHostGuard.ts";

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

/**
 * 补拍后等多久看信送没送到；没送到就绕过信道直驱（ios-instant-open 阶段1 design §2.6）。
 * 必须小于宽限：直驱与判定都在原 1 秒宽限之内完成，不延长用户可见的等待。
 */
export const SCHEDULER_DIRECT_DRIVE_AFTER_MS = 250;

/**
 * 重载发出去之后等这么久，页面还活着就把自救能力还回来。
 *
 * `location.reload()` 可能根本不发生——有未保存修改的页面挂着 `beforeunload`，用户在原生对话框上
 * 点「取消」导航就中止了。而 `firedRef` 已经置位且没有任何复位路径，看门狗从此永久哑火：不再发探针、
 * 不补拍、不直驱，连打开会话的记账都停，用户只能自己刷新（终审 A3，verifier CONFIRMED）。
 * 真重载发生时这枚定时器随页面一起消失，所以它只在「重载没成」那条路上起作用。
 */
export const SCHEDULER_RELOAD_ABORT_MS = 10000;

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

/**
 * 一枚挂着的探针及其现场。同一拍里的多条恢复事件共用一枚（expected 相同）。
 * 心跳与全部定时器由 `dispose()` 一处回收（前身残留账 Q1：加第二枚旁证后三处手调 stop 必漏）。
 */
interface ArmedProbe {
  expected: number;
  /** 首次发出的 Date.now()。再来的恢复事件不刷新它——waitedMs 要量的是用户真实等了多久。 */
  armedAt: number;
  resumes: number;
  trigger: ResumeSource | null;
  probes: number;
  /** 所属打开会话；探针发出时没有会话为 null。 */
  sessionId: string | null;
  heartbeat: Heartbeat;
  storageMs: number | null;
  storageErr: string | null;
  disposed: boolean;
  schedule(task: () => void, ms: number): void;
  dispose(): void;
}

/** 一条 scheduler_probe 里由判定分支决定的字段。全部必填：漏传时 TS 当场报错（前身残留账 Q1）。 */
interface ProbeVerdict {
  outcome: SchedulerProbeOutcome;
  hadPort: boolean;
  kicked: boolean;
  recovered: boolean;
  visible: string;
  waitedMs: number;
  paired: boolean;
  delivered: boolean | null;
  pendingMsgMs: number | null;
  direct: DirectDrive;
  rootPre: ReactRootSnapshot | null;
  rootPost: ReactRootSnapshot | null;
}

function armProbe(expected: number, trigger: ResumeSource | null, sessionId: string | null): ArmedProbe {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const probe: ArmedProbe = {
    expected,
    armedAt: Date.now(),
    resumes: 1,
    trigger,
    probes: safeBumpProbeCount(),
    sessionId,
    heartbeat: startHeartbeat(SCHEDULER_HEARTBEAT_MS),
    storageMs: null,
    storageErr: null,
    disposed: false,
    schedule(task, ms) {
      if (probe.disposed) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!probe.disposed) task();
      }, ms);
      timers.add(timer);
    },
    dispose() {
      if (probe.disposed) return;
      probe.disposed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      probe.heartbeat.stop();
    },
  };
  return probe;
}

/**
 * React 调度器死锁看门狗：每次回到前台发一枚 transition 探针，超时没落地就先补一拍、补拍没送到再直驱、
 * 仍不行才重载。
 *
 * iOS 的 WKWebView 回前台后，走调度器的更新可能全部停摆（路由导航、liveQuery 回流），而点击里直接改 state
 * 照常生效——现场就是「弹层点得开、底栏 tab 点不动、数据写进去了但画面不刷」。2026-09 生产数据证实补拍
 * 发出去了却从未救活（ios-instant-open metaspec §0.2），病根在「信没送到」与「挂起的 transition 毒化整批」
 * 之间，本组件在超时时把两者分辨开要的现场全部记下（design §2）。
 *
 * **探针必须走 transition**：同步 setState 走微任务通道，那条根本没坏，探不出问题。
 *
 * **补拍 / 直驱优先于重载**：成功的话用户毫无感知；重载则丢掉滚动位置与未提交输入，
 * 只在都没救回来、且页面此刻可见时才用。
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
  const armedRef = useRef<ArmedProbe | null>(null);
  /** 重载没真的发生时复位 firedRef 的那枚定时器。卸载要跟着清。 */
  const reloadAbortRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDeadlockRef = useRef(onDeadlock);
  onDeadlockRef.current = onDeadlock;
  /** 冷启动探针：只量不救（design 拍板④）——不经 armProbe、没有任何定时器，慢启动不会被判卡死。 */
  const [boot, setBoot] = useState(0);
  const bootLandedAtRef = useRef<number | null>(null);
  if (boot === 1 && bootLandedAtRef.current === null) bootLandedAtRef.current = performance.now();
  /** 回前台探针最近一次渲染到的序号与时刻：渲染期记（提交卡住时 effect 不跑，时刻要取渲染那一刻），effect 里交给会话。 */
  const probeRenderedRef = useRef({ probe: 0, at: 0 });
  if (probeRenderedRef.current.probe !== probe) probeRenderedRef.current = { probe, at: performance.now() };
  const coldSessionRef = useRef<string | null>(null);
  /** StrictMode 开发期 effect 双跑时 ref 保留，靠它不开两个冷启动会话。 */
  const coldBegunRef = useRef(false);

  useEffect(() => {
    if (coldBegunRef.current) return;
    coldBegunRef.current = true;
    consumeHiddenFlag();
    const sessionId = openSessions.begin({
      kind: "cold",
      startedAt: 0,
      cause: readColdStartCause(),
      hiddenMs: hiddenMsSincePersisted(),
      trigger: null,
    });
    coldSessionRef.current = sessionId;
    startTransition(() => setBoot(1));
    void timeStorageProbe(probeStorage).then((result) => {
      if (sessionStillActive(sessionId)) {
        openSessions.storageSettled(result.errorName === null ? result.ms : null, result.errorName);
      }
    });
  }, []);

  useEffect(() => {
    const at = bootLandedAtRef.current;
    if (boot !== 1 || at === null) return;
    if (sessionStillActive(coldSessionRef.current)) openSessions.probeLanded(at);
  }, [boot]);

  useEffect(() => {
    const armed = armedRef.current;
    if (!armed || probe !== armed.expected) return;
    if (sessionStillActive(armed.sessionId)) openSessions.probeLanded(probeRenderedRef.current.at);
  }, [probe]);

  useEffect(() => onSyncTimingRecorded((entry) => openSessions.syncRecorded(entry)), []);

  useAppHidden(() => {
    markHidden();
    openSessions.end("hidden");
  });

  useEffect(
    () => () => {
      armedRef.current?.dispose();
      armedRef.current = null;
      if (reloadAbortRef.current !== null) clearTimeout(reloadAbortRef.current);
      reloadAbortRef.current = null;
    },
    [],
  );

  useAppResumeRefresh((source) => {
    if (firedRef.current) return;
    noteResumeInSession(source ?? null);
    const expected = landedRef.current + 1;

    // 探针挂着期间再来的恢复事件（同一拍的 visibilitychange / focus / appStateChange，或几秒后
    // 补来的一条）只记条数与最后来源，**不重发探针、不重置定时器**：重置会把超时与宽限一并往后推，
    // 真死锁时自救被无限推迟，而 waitedMs 也量不出用户真实等了多久（前身终审 d2b-② / L2-F4）。
    const existing = armedRef.current;
    if (existing && existing.expected === expected) {
      existing.resumes += 1;
      existing.trigger = source ?? null;
      // 会话 id 要跟着刷：探针挂着期间用户切走再回来时，旧会话已按 hidden 收尾、新会话已经开了
      // （上面 noteResumeInSession 刚开的）。不刷的话探针落地、存储结果、卡死结论三样都会因为
      // sessionStillActive(旧 id) 为假而全部丢掉，新会话三线落空只能拖到 20 s 上限（终审 A2）。
      existing.sessionId = openSessions.activeId();
      // 会话 id 要跟着刷：探针挂着期间用户切走再回来时，旧会话已按 hidden 收尾、新会话已经开了
      // （上面 noteResumeInSession 刚开的）。不刷的话探针落地、存储结果、卡死结论三样都会因为
      // sessionStillActive(旧 id) 为假而全部丢掉，新会话三线落空只能拖到 20 s 上限（终审 A2）。
      return;
    }
    existing?.dispose();

    startTransition(() => setProbe(expected));
    const armed = armProbe(expected, source ?? null, openSessions.activeId());
    armedRef.current = armed;

    // 与 transition 探针同时打一次 IndexedDB 往返：判定时还没回来 = 存储层被冻（storageMs null）；
    // 抛错记 -1 并留错误类型名——两者在数据里必须分得开，否则存储报错会被读成存储被冻。
    void timeStorageProbe(probeStorage).then((result) => {
      if (sessionStillActive(armed.sessionId)) {
        openSessions.storageSettled(result.errorName === null ? result.ms : null, result.errorName);
      }
      if (armed.disposed) return;
      armed.storageMs = result.errorName === null ? result.ms : -1;
      armed.storageErr = result.errorName;
    });

    const landed = () => landedRef.current >= expected;
    const disarm = () => {
      armed.dispose();
      if (armedRef.current === armed) armedRef.current = null;
    };
    const report = (verdict: ProbeVerdict) => {
      try {
        stashPendingReport(
          buildSchedulerProbeReport({
            ...verdict,
            probes: armed.probes,
            maxGapMs: armed.heartbeat.maxGapMs(),
            sinceBootMs: Math.round(performance.now()),
            storageMs: armed.storageMs,
            resumes: armed.resumes,
            trigger: armed.trigger,
            id: newReportId(),
            sessionId: armed.sessionId,
            build: CURRENT_BUILD_ID,
            lazy: snapshotInFlightLazy(),
            storageErr: armed.storageErr,
            dbOpen: isStorageOpen(),
          }),
        );
      } catch {
        // 观测失败绝不能影响自救路径
      }
    };

    armed.schedule(() => {
      if (firedRef.current) return;
      // 夹到 0：系统时钟回拨时差值为负，负数进了埋点会污染分位数。
      const waitedMs = Math.max(0, Date.now() - armed.armedAt);

      if (landed()) {
        // 落地了。定时器若迟到 ≥ 2 个窗口，说明中间线程被冻过——这是重载之外、用户照样在等的那种卡，
        // 不记就永远看不见。准点落地什么都不记（前身拍板④）。
        if (waitedMs >= timeoutMs * SCHEDULER_LATE_FACTOR) {
          const state = schedulerDeliveryState();
          report({
            outcome: "late",
            hadPort: hasSchedulerPort(),
            kicked: false,
            recovered: true,
            visible: document.visibilityState,
            waitedMs,
            paired: state.paired,
            delivered: null,
            pendingMsgMs: pendingMessageMs(state, performance.now()),
            direct: "none",
            rootPre: null,
            rootPost: snapshotReactRoot(),
          });
          if (sessionStillActive(armed.sessionId)) openSessions.stallDecided("late");
        }
        disarm();
        return;
      }

      // 先读端口、送达状态与根快照，再补一拍。不可见也照补（前身拍板②）：补拍无害；补不出去也不早退。
      const hadPort = hasSchedulerPort();
      const before = schedulerDeliveryState();
      const pendingMsgMs = pendingMessageMs(before, performance.now());
      const rootPre = snapshotReactRoot();
      const kickAt = performance.now();
      const kicked = kickScheduler();
      let direct: DirectDrive = "none";

      armed.schedule(() => {
        if (firedRef.current) return;
        const state = schedulerDeliveryState();
        if (!state.paired) {
          direct = "unavailable";
          return;
        }
        if (deliveredSince(state, kickAt)) return; // 信送到了，不直驱：救没救活要能归到信道头上
        // 同步驱，不用 driveSchedulerDirectly 默认的 setTimeout(task, 0)：那会让直驱比宽限判定多排一跳
        // 宏任务，而定时器被整体冻住时（挂起恢复、主线程被长任务占住）两枚定时器都已到期、按到期时间
        // 出队，判定就会跑在那一跳之前——本能无感救活的那次被判成 reload（终审 A1，verifier CONFIRMED）。
        direct = driveSchedulerDirectly((task) => {
          task();
        })
          ? "ran"
          : "unavailable";
      }, SCHEDULER_DIRECT_DRIVE_AFTER_MS);

      armed.schedule(() => {
        if (firedRef.current) return;
        const recovered = landed();
        // visible 取宽限结束、真要决定重不重载的这一刻——在超时那刻采样再拿到这里用，
        // 中间那一秒用户切走了就会在后台重载（前身终审复核 CONFIRMED）。waitedMs 仍取超时那刻。
        const visible = document.visibilityState;
        const after = schedulerDeliveryState();
        const outcome: SchedulerProbeOutcome = recovered ? "recovered" : visible === "visible" ? "reload" : "held";
        report({
          outcome,
          hadPort,
          kicked,
          recovered,
          visible,
          waitedMs,
          paired: after.paired,
          delivered: after.paired ? deliveredSince(after, kickAt) : null,
          pendingMsgMs,
          direct,
          rootPre,
          rootPost: snapshotReactRoot(),
        });
        const inSession = sessionStillActive(armed.sessionId);
        if (inSession) openSessions.stallDecided(outcome);
        disarm();
        if (outcome !== "reload") return;

        // 会话记录赶在墓碑与重载之前进队列：重载后这一轮会话的内存状态就没了。
        if (inSession) openSessions.end("reload");
        // 先留墓碑再重载：新页面靠「是 reload 却没有墓碑」识别 iOS 回收渲染进程那条路径，
        // 这里不留，本次自救就会被误统计成一次系统回收。held / recovered 不重载，也就不留。
        firedRef.current = true;
        markReload("watchdog", Date.now());
        (onDeadlockRef.current ?? reloadPage)();
        reloadAbortRef.current = setTimeout(() => {
          reloadAbortRef.current = null;
          firedRef.current = false;
        }, SCHEDULER_RELOAD_ABORT_MS);
      }, kickGraceMs);
    }, timeoutMs);
  });

  return null;
}

/** 探针所属会话此刻是否还开着。会话已收尾（转后台 / 20 s 到点）后迟到的事件不再交给它。 */
function sessionStillActive(sessionId: string | null): sessionId is string {
  return sessionId !== null && openSessions.activeId() === sessionId;
}

/**
 * 恢复事件 → 打开会话：会话还开着就只累加条数；没开着且自上次以来真的转过后台，才开一个新的回前台会话。
 * 转后台标记两条路都消费——挡住 App 没离开前台时零星冒出的 focus 事件被当成一次新打开（design §3.1）。
 */
function noteResumeInSession(trigger: string | null): void {
  const sawHidden = consumeHiddenFlag();
  if (openSessions.activeId() !== null) {
    openSessions.noteResume(trigger);
    return;
  }
  if (!sawHidden) return;
  openSessions.begin({
    kind: "resume",
    startedAt: performance.now(),
    cause: null,
    hiddenMs: hiddenMsSinceInMemory(),
    trigger,
  });
}

function safeBumpProbeCount(): number {
  try {
    return bumpProbeCount();
  } catch {
    return -1;
  }
}
