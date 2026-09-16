import { STORAGE_KEYS } from "../storageKeys.js";
import { type RecoveryKV, defaultRecoveryKV } from "./kv.js";
import type { PendingReport } from "./pendingReports.js";
import { SYNC_LOG_DETAIL_MAX } from "./pendingReports.js";
import type { ReactRootSnapshot } from "./reactRootProbe.js";

/**
 * 探针超时后的判定结果：
 * - recovered：补拍后宽限内落地，不重载
 * - reload：仍没落地且页面可见，留墓碑重载
 * - held：仍没落地但页面不可见，补了拍不重载，下次 resume 还能再救
 * - late：探针其实落地了，但定时器迟到 ≥ 2 个窗口——线程或 App 被冻过，用户照样在等
 */
export type SchedulerProbeOutcome = "recovered" | "reload" | "held" | "late";

/** 直驱救援：none = 补拍已送达无需直驱；ran = 补拍未送达、已直驱；unavailable = 未配对到调度器处理函数。 */
export type DirectDrive = "none" | "ran" | "unavailable";

/** 一次判定的完整现场。字段含义与分辨哪条假说见 design §2.1 / §0.4。只有数字与标签，不含内容数据。 */
export interface SchedulerProbeInput {
  outcome: SchedulerProbeOutcome;
  hadPort: boolean;
  kicked: boolean;
  /** 判定那一刻探针是否已落地。late 时恒 true（落地了，只是定时器迟到）——它不是「补拍救回来了」的同义词，那要看 kicked && recovered。 */
  recovered: boolean;
  /** 决定重不重载那一刻的 document.visibilityState 原值（宽限结束时取；late 是超时定时器跑到时取）。 */
  visible: string;
  /** 探针首次发出到超时定时器跑到那一刻的真实经过毫秒（Date.now 差，含 App 挂起时间；不含宽限；时钟回拨夹到 0）。 */
  waitedMs: number;
  /** 探针累计发出次数（跨重载）。两条记录之差 = 期间探了多少次。 */
  probes: number;
  /** 判定前主线程心跳的最大迟到毫秒。≈ waitedMs 说明线程被冻，≈ 0 说明线程空着、只是调度器不干活。 */
  maxGapMs: number;
  /** 判定时刻距页面启动的毫秒（performance.now）。很小 = 探针是在启动链里发的。 */
  sinceBootMs: number;
  /** 探针发出时同时打的一次 IndexedDB 最小往返耗时；判定时还没回来为 null（存储被冻），抛错为 -1（库没开 / 被关）。 */
  storageMs: number | null;
  /** 本枚探针挂着期间收到的恢复事件条数（≥1）。 */
  resumes: number;
  /** 最后一次恢复事件的来源（visibilitychange / focus / pageshow / appStateChange）。 */
  trigger: string | null;
  /** 记录唯一编号（10 位 base36），报告按它去重。 */
  id: string;
  /** 所属 open_session 的 id；不在任何会话里为 null。 */
  sessionId: string | null;
  /** CURRENT_BUILD_ID，版本前后对比用。 */
  build: string;
  /** index.html 内联钩子是否配对到调度器 port1（ios-instant-open 阶段1 §2.1）。 */
  paired: boolean;
  /** 补拍后到宽限结束，调度器处理函数是否经信道被调用过；未配对为 null。false = 甲。 */
  delivered: boolean | null;
  /** 超时那刻「最后一次排队之后再没投递」已持续的毫秒；投递晚于排队为 0；未配对为 null。 */
  pendingMsgMs: number | null;
  direct: DirectDrive;
  /** 补拍前的 React 根快照。 */
  rootPre: ReactRootSnapshot | null;
  /** 宽限结束时的 React 根快照（late 为超时那刻）。transition lane 仍挂起 = 乙。 */
  rootPost: ReactRootSnapshot | null;
  /** 在途懒加载 `[页面名, 已等毫秒]`，≤ 3 条。 */
  lazy: [string, number][];
  /** 存储探针错误类型名。 */
  storageErr: string | null;
  /** db.isOpen()；取不到为 null。 */
  dbOpen: boolean | null;
}

type ProbeRecord = SchedulerProbeInput & { trunc?: true };

/** 超过服务端 detail 上限时的降级顺序（design §2.7）：先丢在途懒加载，再丢补拍前快照，最后截短存储错误名。 */
const DEGRADE_STEPS: Array<(record: ProbeRecord) => ProbeRecord> = [
  (record) => ({ ...record, lazy: [], trunc: true }),
  (record) => ({ ...record, rootPre: null, trunc: true }),
  (record) => ({ ...record, storageErr: record.storageErr === null ? null : record.storageErr.slice(0, 20), trunc: true }),
];

export function buildSchedulerProbeReport(input: SchedulerProbeInput): PendingReport {
  let record: ProbeRecord = input;
  let detail = JSON.stringify(record);
  for (const step of DEGRADE_STEPS) {
    if (detail.length <= SYNC_LOG_DETAIL_MAX) break;
    record = step(record);
    detail = JSON.stringify(record);
  }
  // 三步后仍超限只可能是调用方塞了异常长的字段；交给 stashPendingReport 拒收并计入 dropped，不在这里硬截 JSON。
  return { action: "scheduler_probe", detail, record_count: 0 };
}

/**
 * 探针累计计数 +1 并返回新值。**必须落 KV 而不是模块变量**：`stashPendingReport` 上限 30 条，
 * 一次会话超时超过 5 次时早的记录会被挤掉，只有跨重载存活的累计值不会因丢记录而失真（design §2.2）。
 */
export function bumpProbeCount(kv: RecoveryKV = defaultRecoveryKV): number {
  const parsed = Number(kv.get(STORAGE_KEYS.schedulerProbes) ?? "0");
  const current = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  const next = current + 1;
  kv.set(STORAGE_KEYS.schedulerProbes, String(next));
  return next;
}
