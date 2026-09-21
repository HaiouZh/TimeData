/**
 * React 调度器换道（ios-instant-open 阶段2 design §3.2）：策略层。
 *
 * 机制在 `index.html` 的内联钩子 `td-boot-scheduler-transport`——它在 `scheduler` 求值前装上 `setImmediate`，
 * scheduler 于是把每一拍 `performWorkUntilDeadline` 交给我们的信道（一条 MessageChannel + 队列）。WebKit 在 App
 * 后台期间网络进程一断连，页面里所有 MessagePort 都被永久清空而 React 从不换道；这里决定**什么时候换**：
 *
 * - `confirmed`：信道刚送达过，可信，零定时器。
 * - `suspect`：回前台后（或刚装上时）信道还没证明自己；下一次排队挂一枚 `TRANSPORT_FALLBACK_MS` 兜底。
 * - `degraded`：兜底到点没送达——换新信道、直排积压，此后每次排队同时排一枚 `setTimeout(0)`，直到信道再次送达。
 *
 * 回前台先查 `portDead()`（WebKit 断连会把 port1.onmessage 清空）：命中立即换道并计 `deadPorts`，
 * 这既是快路径也是根因在现场的直接证据。钩子没装上（`installed:false`）时全部函数退化为 no-op。
 */

/** 兜底窗口。正常送达在 1 ms 内；主线程忙时定时器同样到不了，不会误触；绘制偶尔超 16 ms，50 ms 留足余量。 */
export const TRANSPORT_FALLBACK_MS = 50;

export type TransportMode = "confirmed" | "suspect" | "degraded";

interface CoreSnapshot {
  gen: number;
  posted: number;
  delivered: number;
  ran: number;
  queued: number;
  lastPostedAt: number | null;
  lastDeliveredAt: number | null;
}

/** `index.html` 钩子挂在 `window.__timedataBoot.schedulerTransport` 上的对象形状。 */
export interface SchedulerTransportCore {
  onSchedule: (() => void) | null;
  onDeliver: (() => void) | null;
  schedule(fn: (...args: unknown[]) => void, ...args: unknown[]): number;
  cancel(id: number): void;
  rotate(): void;
  drain(): number;
  queued(): number;
  portDead(): boolean;
  snapshot(): CoreSnapshot;
}

export interface TransportSnapshot extends CoreSnapshot {
  installed: boolean;
  mode: TransportMode;
  /** 换过几次信道（含回前台死端口、兜底、看门狗补拍）。 */
  rotations: number;
  /** 兜底到点、信道没送达的次数。 */
  fallbacks: number;
  /** 回前台时发现 port1.onmessage 已被清空的次数。 */
  deadPorts: number;
}

export interface SchedulerDeliveryState {
  installed: boolean;
  /** 最近一次成功 post 的时刻（performance.now 时基）。 */
  lastPostedAt: number | null;
  /** 最近一次信道送达（wake）的时刻。drain 不算。 */
  lastDeliveredAt: number | null;
}

interface ResumeTarget {
  document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
}

export interface PolicyScope {
  __timedataBoot?: { schedulerTransport?: SchedulerTransportCore };
  document?: ResumeTarget["document"];
  window?: ResumeTarget["window"];
}

export interface PolicyOptions {
  fallbackMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

let core: SchedulerTransportCore | null = null;
let mode: TransportMode = "suspect";
let rotations = 0;
let fallbacks = 0;
let deadPorts = 0;
let fallbackTimer: unknown = null;
let degradedTimer: unknown = null;
let unsubscribe: (() => void) | null = null;
let setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms);
let clearTimer: (handle: unknown) => void = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>);
let fallbackMs = TRANSPORT_FALLBACK_MS;

function rotate(): void {
  if (!core) return;
  core.rotate();
  rotations += 1;
}

function clearFallback(): void {
  if (fallbackTimer === null) return;
  clearTimer(fallbackTimer);
  fallbackTimer = null;
}

function armFallback(): void {
  if (fallbackTimer !== null) return;
  fallbackTimer = setTimer(() => {
    fallbackTimer = null;
    if (!core || core.queued() === 0) return;
    fallbacks += 1;
    // 先翻状态再 drain：drain 里调度器会立刻重新排队，那一次排队要按 degraded 的规则挂 setTimeout(0)。
    mode = "degraded";
    rotate();
    core.drain();
  }, fallbackMs);
}

function armDegraded(): void {
  if (degradedTimer !== null) return;
  degradedTimer = setTimer(() => {
    degradedTimer = null;
    core?.drain();
  }, 0);
}

function onSchedule(): void {
  if (mode === "suspect") armFallback();
  else if (mode === "degraded") armDegraded();
}

function onDeliver(): void {
  mode = "confirmed";
  clearFallback();
}

/** 回前台：死端口立即换道；可信信道降为 suspect；degraded 下上一条信道已被证明不可信，顺手换新。 */
function onResume(): void {
  if (!core) return;
  if (core.portDead()) {
    deadPorts += 1;
    rotate();
    mode = "suspect";
  } else if (mode === "confirmed") {
    mode = "suspect";
  } else if (mode === "degraded") {
    rotate();
  }
  if (core.queued() === 0) return;
  if (mode === "degraded") armDegraded();
  else armFallback();
}

function subscribeResume(target: ResumeTarget, onResumeFn: () => void): () => void {
  const onVisibility = () => {
    if (target.document.visibilityState === "visible") onResumeFn();
  };
  const onWindowEvent = () => onResumeFn();
  target.document.addEventListener("visibilitychange", onVisibility);
  target.window.addEventListener("pageshow", onWindowEvent);
  target.window.addEventListener("focus", onWindowEvent);
  return () => {
    target.document.removeEventListener("visibilitychange", onVisibility);
    target.window.removeEventListener("pageshow", onWindowEvent);
    target.window.removeEventListener("focus", onWindowEvent);
  };
}

/**
 * 接管钩子：挂上排队 / 送达两枚策略钩、订阅回前台事件。返回是否真的接上了（钩子没装上为 false）。
 * `main.tsx` 模块体里、`createRoot().render()` 之前调用即可——React 首次排队在那之后。
 */
export function installSchedulerTransportPolicy(
  scope: PolicyScope = globalThis as unknown as PolicyScope,
  options: PolicyOptions = {},
): boolean {
  const candidate = scope.__timedataBoot?.schedulerTransport;
  if (!candidate || core === candidate) return false;
  resetSchedulerTransport();
  core = candidate;
  fallbackMs = options.fallbackMs ?? TRANSPORT_FALLBACK_MS;
  if (options.setTimer) setTimer = options.setTimer;
  if (options.clearTimer) clearTimer = options.clearTimer;
  core.onSchedule = onSchedule;
  core.onDeliver = onDeliver;
  if (scope.document && scope.window) {
    unsubscribe = subscribeResume({ document: scope.document, window: scope.window }, onResume);
  }
  return true;
}

export function hasSchedulerTransport(): boolean {
  return core !== null;
}

/**
 * 看门狗补拍：强制换新信道、直排积压、进 degraded（此后每拍都有 setTimeout(0) 托底）。
 * 返回是否执行了（钩子没装上为 false）。
 */
export function kickSchedulerTransport(): boolean {
  if (!core) return false;
  mode = "degraded";
  rotate();
  core.drain();
  return true;
}

/** 看门狗直驱：直排一次积压。返回是否执行了。 */
export function drainSchedulerTransport(): boolean {
  if (!core) return false;
  core.drain();
  return true;
}

export function schedulerDeliveryState(): SchedulerDeliveryState {
  if (!core) return { installed: false, lastPostedAt: null, lastDeliveredAt: null };
  const snap = core.snapshot();
  return { installed: true, lastPostedAt: snap.lastPostedAt, lastDeliveredAt: snap.lastDeliveredAt };
}

export function transportState(): TransportSnapshot {
  const snap: CoreSnapshot = core
    ? core.snapshot()
    : { gen: 0, posted: 0, delivered: 0, ran: 0, queued: 0, lastPostedAt: null, lastDeliveredAt: null };
  return { ...snap, installed: core !== null, mode, rotations, fallbacks, deadPorts };
}

/** `since` 之后（含）信道是否送达过。 */
export function deliveredSince(state: SchedulerDeliveryState, since: number): boolean {
  return state.lastDeliveredAt !== null && state.lastDeliveredAt >= since;
}

/** 「最后一次排队之后再没送达」已持续的毫秒；送达不早于排队为 0；未安装或从未排队为 null。 */
export function pendingMessageMs(state: SchedulerDeliveryState, now: number): number | null {
  if (!state.installed || state.lastPostedAt === null) return null;
  if (state.lastDeliveredAt !== null && state.lastDeliveredAt >= state.lastPostedAt) return 0;
  return Math.max(0, Math.round(now - state.lastPostedAt));
}

/** 仅供测试：解开钩子、清定时器与计数。 */
export function resetSchedulerTransport(): void {
  clearFallback();
  if (degradedTimer !== null) {
    clearTimer(degradedTimer);
    degradedTimer = null;
  }
  unsubscribe?.();
  unsubscribe = null;
  if (core) {
    core.onSchedule = null;
    core.onDeliver = null;
  }
  core = null;
  mode = "suspect";
  rotations = 0;
  fallbacks = 0;
  deadPorts = 0;
  setTimer = (fn, ms) => setTimeout(fn, ms);
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>);
  fallbackMs = TRANSPORT_FALLBACK_MS;
}
