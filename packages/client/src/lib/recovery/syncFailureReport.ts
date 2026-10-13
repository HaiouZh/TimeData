import type { SyncLaneStats } from "../../sync/phaseTimings.js";
import { ApiError } from "../api.js";
import type { PendingReport } from "./pendingReports.js";

/**
 * 同步失败轮的观测：`sync_error`（一段连败的前几轮各一条）+ `sync_recovered`（连败后首次成功一条）。
 *
 * 2026-10-10 安卓卡了几分钟不同步，服务端只看得到「一条请求都没到」：失败轮从不上报，
 * 中间重试了几次、各报什么错、断了多久全是空白。纯状态机、依赖注入，接线在 hooks/useSync.ts。
 * 和其它端上观测一样先攒进待发送队列，搭下一次带上报的同步轮发出。
 * 安卓双车道（ADR 0038）：两类记录都带本轮 lanes；没连败但被第二车道救回的成功轮另攒 `sync_lane_rescue`。
 */

/** 每段连败最多记几条 sync_error。断网时 60s 一轮重试，不封顶会把 30 条的待发送队列挤满、把 open_session 挤掉。 */
export const SYNC_ERROR_REPORTS_PER_STREAK = 5;

/** 被第二车道救回的成功轮最多每 10 分钟记一条；卡顿期间每轮都可能被救回，不节流会挤爆 30 条的待发送队列。 */
export const SYNC_LANE_RESCUE_MIN_INTERVAL_MS = 10 * 60_000;

const CAUSE_MAX = 120;

export interface SyncErrorClass {
  /** timeout | network | http_<status> | abort | other */
  kind: string;
  /** 底层异常的短摘要（原生通道是 Java 异常名，判 DNS / 建连 / 读超时靠它）；没有则 null。 */
  cause: string | null;
}

export function classifySyncError(error: unknown): SyncErrorClass {
  const rawCause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const cause = rawCause instanceof Error
    ? rawCause.message.slice(0, CAUSE_MAX)
    : typeof rawCause === "string" ? rawCause.slice(0, CAUSE_MAX) : null;
  if (error instanceof ApiError) return { kind: `http_${error.status}`, cause };
  if ((error as Error | null)?.name === "AbortError") return { kind: "abort", cause };
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("网络请求超时")) return { kind: "timeout", cause };
  if (message.startsWith("网络请求失败")) return { kind: "network", cause };
  return { kind: "other", cause };
}

export interface SyncFailureInput {
  reason: string | null;
  transport: string | null;
  connection: string | null;
  waitMs: number | null;
  totalMs: number;
  phases: Record<string, number>;
  lanes?: SyncLaneStats | null;
  error: unknown;
}

export interface SyncSuccessInput {
  reason: string | null;
  transport: string | null;
  totalMs: number;
  lanes?: SyncLaneStats | null;
}

export interface SyncFailureTrackerDeps {
  now: () => number;
  build: string;
  newId: () => string;
  stash: (report: PendingReport) => void;
}

export interface SyncFailureTracker {
  recordFailure(input: SyncFailureInput): void;
  recordSuccess(input: SyncSuccessInput): void;
}

export function createSyncFailureTracker(deps: SyncFailureTrackerDeps): SyncFailureTracker {
  let streak = 0;
  let streakStartedAt = 0;
  let lastRescueAt: number | null = null;
  let suppressedRescues = 0;

  const stashRescue = (round: SyncSuccessInput): void => {
    if (!round.lanes || round.lanes.backupWon === 0) return;
    const now = deps.now();
    if (lastRescueAt !== null && now - lastRescueAt < SYNC_LANE_RESCUE_MIN_INTERVAL_MS) {
      suppressedRescues += 1;
      return;
    }
    lastRescueAt = now;
    const detail = {
      id: deps.newId(),
      build: deps.build,
      reason: round.reason,
      transport: round.transport,
      totalMs: round.totalMs,
      lanes: round.lanes,
      suppressed: suppressedRescues,
    };
    suppressedRescues = 0;
    deps.stash({ action: "sync_lane_rescue", detail: JSON.stringify(detail), record_count: 0 });
  };

  return {
    recordFailure({ error, ...round }) {
      streak += 1;
      if (streak === 1) streakStartedAt = deps.now();
      if (streak > SYNC_ERROR_REPORTS_PER_STREAK) return;
      const detail = {
        id: deps.newId(),
        build: deps.build,
        streak,
        reason: round.reason,
        transport: round.transport,
        connection: round.connection,
        waitMs: round.waitMs,
        totalMs: round.totalMs,
        phases: round.phases,
        ...(round.lanes ? { lanes: round.lanes } : {}),
        ...classifySyncError(error),
      };
      deps.stash({ action: "sync_error", detail: JSON.stringify(detail), record_count: 0 });
    },
    recordSuccess(round) {
      if (streak === 0) {
        stashRescue(round);
        return;
      }
      const detail = {
        id: deps.newId(),
        build: deps.build,
        streak,
        outageMs: Math.max(0, Math.round(deps.now() - streakStartedAt)),
        reason: round.reason,
        transport: round.transport,
        totalMs: round.totalMs,
        ...(round.lanes ? { lanes: round.lanes } : {}),
      };
      streak = 0;
      deps.stash({ action: "sync_recovered", detail: JSON.stringify(detail), record_count: 0 });
    },
  };
}
