import type { SyncTimingEntry } from "../../sync/phaseTimings.js";
import type { NetTiming } from "../../sync/resourceTimingCache.js";
import { type PendingReport, SYNC_LOG_DETAIL_MAX } from "./pendingReports.js";

/**
 * 打开会话收集器（ios-instant-open 阶段1 design §3）：每次冷启动 / 回前台恰好一条 `open_session`。
 *
 * 纯状态机、依赖全部注入：看门狗、同步耗时落账、存储探针向它报事件，它不反向依赖任何一方
 * （前身残留账 Q4「现场记录与三分判定交织在同一回调里」借此拆开）。真实依赖的装配在 `openSessionRuntime.ts`。
 */

/** 会话最长等多久收尾。M3 目标 p90 ≤ 2 s，20 s 足够把「慢」与「没来」分开。 */
export const OPEN_SESSION_CAP_MS = 20_000;

export type OpenSessionKind = "cold" | "resume";
export type OpenSessionStall = "reload" | "held" | "recovered" | "late";
export type OpenSessionEnd = "complete" | "cap" | "hidden" | "reload";

export interface OpenSessionSync {
  outcome: string;
  reason: string | null;
  waitMs: number | null;
  totalMs: number;
  phases: Record<string, number>;
  connection: string | null;
  protocol: string | null;
}

export interface OpenSessionRecord {
  id: string;
  build: string;
  kind: OpenSessionKind;
  /** 冷启动的重载归因；回前台为 null。 */
  cause: string | null;
  hiddenMs: number | null;
  /** 打开到首个 transition 落地（M2）。 */
  ttiMs: number | null;
  /** 看门狗判定结果（M1）。 */
  stall: OpenSessionStall | null;
  /** 会话开始到首条同步耗时落账（M3）。 */
  syncMs: number | null;
  sync: OpenSessionSync | null;
  net: NetTiming | null;
  /** 存储往返耗时（M4）；出错为 null。 */
  storageMs: number | null;
  storageErr: string | null;
  resumes: number;
  trigger: string | null;
  endedBy: OpenSessionEnd;
  /** 自上条记录以来丢失的上报条数。 */
  dropped: number;
  trunc?: true;
}

export interface OpenSessionDeps {
  /** performance.now 时基：startedAt 与 probeLanded 的 at 同基。 */
  now(): number;
  /** Date.now 时基：只用来和 SyncTimingEntry.at（ISO）比先后。 */
  wallNow(): number;
  build: string;
  newId(): string;
  stash(report: PendingReport): void;
  takeDropped(): number;
  /** 发起不早于 `sinceMs`（performance.now 时基）的那次 /api/sync/status 的网络细分。 */
  netTiming(sinceMs: number): NetTiming | null;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface BeginOptions {
  kind: OpenSessionKind;
  /** performance.now 时基；冷启动传 0（导航起点）。 */
  startedAt: number;
  cause: string | null;
  hiddenMs: number | null;
  trigger: string | null;
}

export interface OpenSessionTracker {
  begin(options: BeginOptions): string;
  activeId(): string | null;
  noteResume(trigger: string | null): void;
  probeLanded(at: number): void;
  stallDecided(outcome: OpenSessionStall): void;
  storageSettled(ms: number | null, errorName: string | null): void;
  syncRecorded(entry: SyncTimingEntry): void;
  end(by: "hidden" | "reload"): void;
}

interface ActiveSession {
  id: string;
  kind: OpenSessionKind;
  startedAt: number;
  startedWallAt: number;
  cause: string | null;
  hiddenMs: number | null;
  trigger: string | null;
  resumes: number;
  ttiMs: number | null;
  stall: OpenSessionStall | null;
  syncMs: number | null;
  sync: OpenSessionSync | null;
  net: NetTiming | null;
  storageDone: boolean;
  storageMs: number | null;
  storageErr: string | null;
  timer: unknown;
}

export function buildOpenSessionReport(record: OpenSessionRecord): PendingReport {
  let current = record;
  let detail = JSON.stringify(current);
  if (detail.length > SYNC_LOG_DETAIL_MAX) {
    current = { ...current, net: null, trunc: true };
    detail = JSON.stringify(current);
  }
  if (detail.length > SYNC_LOG_DETAIL_MAX && current.sync) {
    current = { ...current, sync: { ...current.sync, phases: {} }, trunc: true };
    detail = JSON.stringify(current);
  }
  return { action: "open_session", detail, record_count: 0 };
}

export function createOpenSessionTracker(deps: OpenSessionDeps): OpenSessionTracker {
  let active: ActiveSession | null = null;

  function finalize(by: OpenSessionEnd): void {
    const session = active;
    if (!session) return;
    active = null;
    deps.clearTimer(session.timer);
    try {
      deps.stash(
        buildOpenSessionReport({
          id: session.id,
          build: deps.build,
          kind: session.kind,
          cause: session.cause,
          hiddenMs: session.hiddenMs,
          ttiMs: session.ttiMs,
          stall: session.stall,
          syncMs: session.syncMs,
          sync: session.sync,
          net: session.net,
          storageMs: session.storageMs,
          storageErr: session.storageErr,
          resumes: session.resumes,
          trigger: session.trigger,
          endedBy: by,
          dropped: deps.takeDropped(),
        }),
      );
    } catch {
      // 观测失败不影响任何主路径
    }
  }

  function tryComplete(): void {
    const session = active;
    if (!session) return;
    const probeDone = session.ttiMs !== null || session.stall !== null;
    if (probeDone && session.sync !== null && session.storageDone) finalize("complete");
  }

  return {
    begin(options) {
      if (active) finalize("hidden");
      const elapsed = Math.max(0, deps.now() - options.startedAt);
      const session: ActiveSession = {
        id: deps.newId(),
        kind: options.kind,
        startedAt: options.startedAt,
        startedWallAt: deps.wallNow() - elapsed,
        cause: options.cause,
        hiddenMs: options.hiddenMs === null ? null : Math.round(options.hiddenMs),
        trigger: options.trigger,
        resumes: options.kind === "resume" ? 1 : 0,
        ttiMs: null,
        stall: null,
        syncMs: null,
        sync: null,
        net: null,
        storageDone: false,
        storageMs: null,
        storageErr: null,
        timer: null,
      };
      active = session;
      session.timer = deps.setTimer(() => {
        if (active === session) finalize("cap");
      }, Math.max(0, OPEN_SESSION_CAP_MS - elapsed));
      return session.id;
    },

    activeId: () => active?.id ?? null,

    noteResume(trigger) {
      if (!active) return;
      active.resumes += 1;
      active.trigger = trigger;
    },

    probeLanded(at) {
      if (!active || active.ttiMs !== null) return;
      active.ttiMs = Math.max(0, Math.round(at - active.startedAt));
      tryComplete();
    },

    stallDecided(outcome) {
      if (!active) return;
      active.stall = outcome;
      tryComplete();
    },

    storageSettled(ms, errorName) {
      if (!active || active.storageDone) return;
      active.storageDone = true;
      active.storageMs = ms === null ? null : Math.round(ms);
      active.storageErr = errorName;
      tryComplete();
    },

    syncRecorded(entry) {
      const session = active;
      if (!session || session.sync !== null) return;
      const roundStartedAt = Date.parse(entry.at);
      // 转后台前就发起、回前台才落账的那轮不代表本次打开的「新数据到达」。
      if (!Number.isFinite(roundStartedAt) || roundStartedAt < session.startedWallAt) return;
      session.syncMs = Math.max(0, Math.round(deps.now() - session.startedAt));
      session.sync = {
        outcome: entry.outcome,
        reason: entry.reason ?? null,
        waitMs: entry.waitMs ?? null,
        totalMs: entry.totalMs,
        phases: { ...entry.phases } as Record<string, number>,
        connection: entry.connection ?? null,
        protocol: entry.protocol ?? null,
      };
      session.net = deps.netTiming(session.startedAt);
      tryComplete();
    },

    end(by) {
      finalize(by);
    },
  };
}
