import { useEffect, useState, useSyncExternalStore } from "react";
import {
  type KeyboardProbeEvent,
  readViewportBottomGap,
  refreshKeyboardMotion,
  subscribeKeyboardEvents,
  useKeyboardHeight,
  useKeyboardMotion,
  useKeyboardVisible,
} from "../hooks/useKeyboardHeight.ts";
import {
  DURATION_MAX_MS,
  DURATION_MIN_MS,
  type EasingName,
  clearMotionOverride,
  readStoredMotion,
  setMotionOverride,
} from "../lib/keyboard/keyboardMotionPrefs.js";
import { readProbeSwitch } from "../lib/keyboard/kbdProbe.js";
import { safeGetItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import { Z } from "../lib/zLayers.ts";
import { KEYBOARD_PROBE_SWITCH_EVENT } from "./KeyboardProbe.tsx";

// 单条转移记录：事件名 + 当帧的三个原始量。ms 取自挂载起点，真机截图可直接对时序。
interface DebugLogEntry {
  t: number;
  tag: string;
  ih: number;
  vvh: number;
  gap: number;
}

const LOG_LIMIT = 7;
const STEP_MS = 20;
const EASING_CYCLE: EasingName[] = ["ios", "android", "tg"];

/** 探针开 + 浮层开 才显示：浮层是探针的附属显示，两者都由设置页「高级 · 诊断」控制。 */
function isEnabled(): boolean {
  return readProbeSwitch().on && safeGetItem(STORAGE_KEYS.keyboardDebug) === "1";
}

function subscribeSwitch(onChange: () => void): () => void {
  window.addEventListener(KEYBOARD_PROBE_SWITCH_EVENT, onChange);
  return () => window.removeEventListener(KEYBOARD_PROBE_SWITCH_EVENT, onChange);
}

function clampMs(v: number): number {
  return Math.min(DURATION_MAX_MS, Math.max(DURATION_MIN_MS, v));
}

/**
 * 键盘读数浮层（常驻，按设置页「高级 · 诊断」两个开关显示；mobile-keyboard R7 起不再是临时件）。
 *
 * 只显示原始可测量：innerHeight / visualViewport / 实测遮挡 gap / hook 输出 / 当前时长曲线 /
 * 最近一次量到的系统时长 / 插件事件流水。裁决点一眼可读（对抗验证报告 .dispatch/20260822-kbd-statemachine P7）：
 * - innerHeight 随键盘变 → 壳在动（overlay 前提失效）；
 * - visible=false 且 gap>0 → 收起后视口残影复活；
 * - 流水里 willHide 缺失 → 事件丢失。
 *
 * 调参行（真机试时长曲线，写 override 后 KeyboardDock 即时跟上；试满意了把值固化成平台默认）：
 * show± / hide± 每步 20ms，夹在采信窗 [80, 700]；曲线在 ios / android / tg 三条里循环；重置清全部 override。
 * 读数区 pointer-events 关闭、不参与布局；按钮行可点。
 */
export function KeyboardDebugOverlay() {
  const enabled = useSyncExternalStore(subscribeSwitch, isEnabled, () => false);
  const keyboardHeight = useKeyboardHeight();
  const keyboardVisible = useKeyboardVisible();
  const motion = useKeyboardMotion();
  const [, setTick] = useState(0);
  const [log, setLog] = useState<DebugLogEntry[]>([]);
  const [measured, setMeasured] = useState<{ show: number | null; hide: number | null }>({ show: null, hide: null });

  useEffect(() => {
    if (!enabled) return;
    const startedAt = Date.now();
    const push = (tag: string) => {
      const entry: DebugLogEntry = {
        t: Date.now() - startedAt,
        tag,
        ih: window.innerHeight,
        vvh: Math.round(window.visualViewport?.height ?? 0),
        gap: Math.round(readViewportBottomGap()),
      };
      setLog((prev) => [...prev.slice(-(LOG_LIMIT - 1)), entry]);
      setTick((n) => n + 1);
    };

    const onResize = () => push("rs");
    const onVvResize = () => push("vv");
    const onVvScroll = () => push("vs");
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onVvResize);
    window.visualViewport?.addEventListener("scroll", onVvScroll);

    // 插件 / 焦点事件走 store 的广播，浮层不自己听插件（与探针同源，读数一致）。
    let willShowAt: number | null = null;
    let willHideAt: number | null = null;
    const offStore = subscribeKeyboardEvents((e: KeyboardProbeEvent) => {
      switch (e.type) {
        case "ws":
          willShowAt = e.t;
          push(`WS${Math.round(e.height)}`);
          break;
        case "ds":
          if (willShowAt !== null) setMeasured((m) => ({ ...m, show: Math.round(e.t - (willShowAt ?? e.t)) }));
          push("DS");
          break;
        case "wh":
          willHideAt = e.t;
          push("WH");
          break;
        case "dh":
          if (willHideAt !== null) setMeasured((m) => ({ ...m, hide: Math.round(e.t - (willHideAt ?? e.t)) }));
          push("DH");
          break;
        case "fi":
          push("fi");
          break;
        case "fo":
          push("fo");
          break;
        default:
          break;
      }
    });

    push("mount");
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onVvResize);
      window.visualViewport?.removeEventListener("scroll", onVvScroll);
      offStore();
    };
  }, [enabled]);

  if (!enabled) return null;

  const adjust = (kind: "show" | "hide", delta: number) => {
    const current = kind === "show" ? motion.showMs : motion.hideMs;
    const next = clampMs(current + delta);
    setMotionOverride(kind === "show" ? { overrideShowMs: next } : { overrideHideMs: next });
    refreshKeyboardMotion();
  };
  const cycleEasing = () => {
    const idx = EASING_CYCLE.indexOf(readStoredMotion().overrideEasing ?? motion.easingName);
    setMotionOverride({ overrideEasing: EASING_CYCLE[(idx + 1) % EASING_CYCLE.length] });
    refreshKeyboardMotion();
  };
  const reset = () => {
    clearMotionOverride();
    refreshKeyboardMotion();
  };

  const vv = window.visualViewport;
  const fmt = (v: number | null) => (v === null ? "-" : String(v));
  const btn = "rounded-ctl border border-border bg-surface px-1.5 py-0.5 td-text-caption text-ink-2";
  return (
    <div
      data-testid="kbd-debug-overlay"
      className="td-safe-top fixed left-0 top-0 max-w-64 rounded-br-ctl bg-page/80 p-1 td-text-caption text-ink-2"
      style={{ zIndex: Z.top }}
    >
      <div className="pointer-events-none">
        <div>
          ih:{window.innerHeight} vv:{Math.round(vv?.height ?? 0)}@{Math.round(vv?.offsetTop ?? 0)} gap:
          {Math.round(readViewportBottomGap())}
        </div>
        <div>
          kh:{Math.round(keyboardHeight)} vis:{keyboardVisible ? "T" : "F"} mo:{motion.showMs}/{motion.hideMs}{" "}
          {motion.easingName} dur:{fmt(measured.show)}/{fmt(measured.hide)}
        </div>
        {log.map((entry) => (
          <div key={`${entry.t}-${entry.tag}`}>
            {entry.t}ms {entry.tag} ih{entry.ih} vv{entry.vvh} g{entry.gap}
          </div>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <button type="button" className={btn} onClick={() => adjust("show", -STEP_MS)}>
          show−
        </button>
        <button type="button" className={btn} onClick={() => adjust("show", STEP_MS)}>
          show+
        </button>
        <button type="button" className={btn} onClick={() => adjust("hide", -STEP_MS)}>
          hide−
        </button>
        <button type="button" className={btn} onClick={() => adjust("hide", STEP_MS)}>
          hide+
        </button>
        <button type="button" className={btn} onClick={cycleEasing}>
          曲线
        </button>
        <button type="button" className={btn} onClick={reset}>
          重置
        </button>
      </div>
    </div>
  );
}
