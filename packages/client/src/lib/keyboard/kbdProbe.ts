import { type RecoveryKV, defaultRecoveryKV } from "../recovery/kv.js";
import { type PendingReport, SYNC_LOG_DETAIL_MAX } from "../recovery/pendingReports.js";
import { STORAGE_KEYS } from "../storageKeys.js";

/** 每次打开开关最多采这么多条：pendingReports 只有 30 格，别把 open_session 挤出去。 */
export const PROBE_BUDGET = 20;

export interface ProbeSwitch {
  on: boolean;
  left: number;
}

export function readProbeSwitch(kv: RecoveryKV = defaultRecoveryKV): ProbeSwitch {
  const raw = kv.get(STORAGE_KEYS.keyboardProbe);
  if (!raw) return { on: false, left: 0 };
  try {
    const p = JSON.parse(raw) as { on?: unknown; left?: unknown };
    const left = typeof p.left === "number" && Number.isFinite(p.left) ? Math.max(0, Math.floor(p.left)) : 0;
    return { on: p.on === true && left > 0, left };
  } catch {
    return { on: false, left: 0 };
  }
}

export function writeProbeSwitch(next: ProbeSwitch, kv: RecoveryKV = defaultRecoveryKV): void {
  if (!next.on && next.left === 0) kv.remove(STORAGE_KEYS.keyboardProbe);
  else kv.set(STORAGE_KEYS.keyboardProbe, JSON.stringify(next));
}

/**
 * 会话里记的事件：fi/fo 焦点、ws/ds/wh/dh 插件 will/did、ts/te 驻坞条 transition、
 * ff 首帧延迟（不进 ev，只填 ff）、vs visualViewport scroll（引擎平移视口的证据）。
 */
export type ProbeEventType = "fi" | "fo" | "ws" | "ds" | "wh" | "dh" | "ts" | "te" | "ff" | "vs";

export interface ProbeInput {
  type: ProbeEventType;
  /** performance.now() */
  t: number;
  scrollY: number;
  vvTop: number;
  /** ws 带插件报的键盘高。 */
  height?: number;
  /** ff 带「事件到下一次 rAF」的毫秒。 */
  frameMs?: number;
}

/** 落库形态（design §2.4）。短键：detail ≤ 1000 字符。 */
export interface KbdSession {
  v: 1;
  p: "ios" | "android" | "web";
  os: string;
  b: string;
  r: string;
  in: "dock" | "page";
  kh: number;
  /** [事件, 距 fi 的 ms, scrollY, vv.offsetTop] */
  ev: Array<readonly [string, number, number, number]>;
  /** 首帧延迟 [show, hide]，没量到为 null */
  ff: [number | null, number | null];
  /** 量到的系统时长 [show, hide]（did − will），没量到为 null */
  dur: [number | null, number | null];
  /** 本次输入条实际用的 [showMs, hideMs, 曲线名] */
  mo: [number, number, string];
  nav: 0 | 1;
  trunc?: true;
}

/** 超长先截 ev 尾部（vs 事件可能刷屏），保底留头 4 条，标 trunc。 */
export function encodeSession(session: KbdSession): string {
  let s: KbdSession = session;
  let text = JSON.stringify(s);
  while (text.length > SYNC_LOG_DETAIL_MAX && s.ev.length > 4) {
    s = { ...s, ev: s.ev.slice(0, Math.max(4, Math.floor(s.ev.length * 0.7))), trunc: true };
    text = JSON.stringify(s);
  }
  return text;
}

export interface KeyboardProbeTrackerDeps {
  platform: KbdSession["p"];
  os: string;
  build: string;
  route: () => string;
  motion: () => { showMs: number; hideMs: number; easingName: string };
  stash: (report: PendingReport) => void;
  readSwitch: () => ProbeSwitch;
  writeSwitch: (next: ProbeSwitch) => void;
  navCollapsed: () => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

/** fo 之后这么久没有 will 事件就当键盘没来过（外接键盘 / 事件丢失），闭合会话。 */
const IDLE_CLOSE_MS = 1000;

/**
 * 键盘探针会话 tracker（纯逻辑，依赖全注入；接线在 components/KeyboardProbe.tsx）。
 * 会话边界：fi 开段，dh 闭合；fo 后 1 s 没 will 事件也闭合；新 fi 先闭合上一段。
 * 每闭合一条扣一格预算，扣完自动关开关。
 */
export function createKeyboardProbeTracker(deps: KeyboardProbeTrackerDeps) {
  let session: KbdSession | null = null;
  let t0 = 0;
  let willShowAt: number | null = null;
  let willHideAt: number | null = null;
  let inDock = false;
  let idleTimer: unknown = null;

  const clearIdle = () => {
    if (idleTimer === null) return;
    deps.clearTimer(idleTimer);
    idleTimer = null;
  };

  const close = () => {
    clearIdle();
    const s = session;
    session = null;
    if (!s) return;
    const sw = deps.readSwitch();
    if (!sw.on) return;
    const m = deps.motion();
    s.mo = [m.showMs, m.hideMs, m.easingName];
    s.nav = deps.navCollapsed() ? 1 : 0;
    deps.stash({ action: "kbd_session", detail: encodeSession(s) });
    const left = Math.max(0, sw.left - 1);
    deps.writeSwitch({ on: left > 0, left });
  };

  const open = (e: ProbeInput) => {
    t0 = e.t;
    willShowAt = null;
    willHideAt = null;
    session = {
      v: 1,
      p: deps.platform,
      os: deps.os,
      b: deps.build,
      r: deps.route(),
      in: inDock ? "dock" : "page",
      kh: 0,
      ev: [],
      ff: [null, null],
      dur: [null, null],
      mo: [0, 0, ""],
      nav: 0,
    };
  };

  return {
    /** fi 到达前由接线方告知：聚焦的是不是驻坞条里的输入框。 */
    focusTarget(dock: boolean) {
      inDock = dock;
    },
    push(e: ProbeInput) {
      if (!deps.readSwitch().on) return;
      if (e.type === "fi") {
        if (session) close();
        open(e);
      }
      const s = session;
      if (!s) return;
      const rel = Math.round(e.t - t0);
      if (e.type === "ff") {
        if (typeof e.frameMs === "number") {
          if (willHideAt === null) s.ff[0] = Math.round(e.frameMs);
          else s.ff[1] = Math.round(e.frameMs);
        }
        return;
      }
      s.ev.push([e.type, rel, Math.round(e.scrollY), Math.round(e.vvTop)]);
      switch (e.type) {
        case "ws":
          s.kh = Math.round(e.height ?? 0);
          willShowAt = e.t;
          clearIdle();
          break;
        case "ds":
          if (willShowAt !== null) s.dur[0] = Math.round(e.t - willShowAt);
          break;
        case "wh":
          willHideAt = e.t;
          break;
        case "dh":
          if (willHideAt !== null) s.dur[1] = Math.round(e.t - willHideAt);
          close();
          break;
        case "fo":
          clearIdle();
          idleTimer = deps.setTimer(close, IDLE_CLOSE_MS);
          break;
        default:
          break;
      }
    },
    dispose() {
      clearIdle();
      session = null;
    },
  };
}
