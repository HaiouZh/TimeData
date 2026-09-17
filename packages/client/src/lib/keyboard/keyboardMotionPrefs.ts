import { type RecoveryKV, defaultRecoveryKV } from "../recovery/kv.js";
import { STORAGE_KEYS } from "../storageKeys.js";

export type MotionPlatform = "ios" | "android" | "web";
export type EasingName = "ios" | "android" | "tg";

export interface KeyboardMotion {
  showMs: number;
  hideMs: number;
  easing: string;
  easingName: EasingName;
}

/** 采信窗：低于 80 是事件配对错乱（did 先于 will），高于 700 是 App 被挂起过。 */
export const DURATION_MIN_MS = 80;
export const DURATION_MAX_MS = 700;

/**
 * 三条曲线：ios = UIKit 私有键盘曲线（curve 7）的常用 cubic-bezier 近似；android =
 * `InsetsController.SYNC_IME_INTERPOLATOR`（PathInterpolator(0.2, 0, 0, 1)，窗口挂了
 * WindowInsetsAnimation.Callback 时 IME 收放都走它——@capacitor/keyboard 正是挂了）；tg =
 * Telegram Android DEFAULT_INTERPOLATOR，web / 桌面浏览器没有系统键盘动画可对齐时沿用。
 */
export const EASINGS: Record<EasingName, string> = {
  ios: "cubic-bezier(0.38, 0.7, 0.125, 1)",
  android: "cubic-bezier(0.2, 0, 0, 1)",
  tg: "cubic-bezier(0.25, 0.1, 0.25, 1)",
};

/** 首次（还没量到真实时长）用的平台默认：iOS 键盘动画 0.25s；Android 12+ 带回调时 285ms。 */
export const PLATFORM_DEFAULTS: Record<MotionPlatform, KeyboardMotion> = {
  ios: { showMs: 250, hideMs: 250, easing: EASINGS.ios, easingName: "ios" },
  android: { showMs: 285, hideMs: 285, easing: EASINGS.android, easingName: "android" },
  web: { showMs: 250, hideMs: 200, easing: EASINGS.tg, easingName: "tg" },
};

/** localStorage 里的形态。实测两项由 store 写，override 三项由读数浮层写。 */
export interface StoredMotion {
  showMs?: number;
  hideMs?: number;
  overrideShowMs?: number;
  overrideHideMs?: number;
  overrideEasing?: EasingName;
}

function isDuration(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= DURATION_MIN_MS && v <= DURATION_MAX_MS;
}

function isEasingName(v: unknown): v is EasingName {
  return v === "ios" || v === "android" || v === "tg";
}

/** 逐字段校验：坏字段丢弃而非整份作废（与 pendingReports 的逐元素校验同款）。 */
function sanitize(input: Record<string, unknown>): StoredMotion {
  const out: StoredMotion = {};
  if (isDuration(input.showMs)) out.showMs = input.showMs;
  if (isDuration(input.hideMs)) out.hideMs = input.hideMs;
  if (isDuration(input.overrideShowMs)) out.overrideShowMs = input.overrideShowMs;
  if (isDuration(input.overrideHideMs)) out.overrideHideMs = input.overrideHideMs;
  if (isEasingName(input.overrideEasing)) out.overrideEasing = input.overrideEasing;
  return out;
}

export function readStoredMotion(kv: RecoveryKV = defaultRecoveryKV): StoredMotion {
  const raw = kv.get(STORAGE_KEYS.keyboardMotion);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  return sanitize(parsed as Record<string, unknown>);
}

function writeStoredMotion(next: StoredMotion, kv: RecoveryKV): void {
  if (Object.keys(next).length === 0) kv.remove(STORAGE_KEYS.keyboardMotion);
  else kv.set(STORAGE_KEYS.keyboardMotion, JSON.stringify(next));
}

/** 记一次实测时长。取最近一次而非均值——换输入法 / OEM 动画变了要立刻跟上。越界拒收。 */
export function recordMeasuredDuration(kind: "show" | "hide", ms: number, kv: RecoveryKV = defaultRecoveryKV): boolean {
  if (!isDuration(ms)) return false;
  const stored = readStoredMotion(kv);
  const rounded = Math.round(ms);
  writeStoredMotion(kind === "show" ? { ...stored, showMs: rounded } : { ...stored, hideMs: rounded }, kv);
  return true;
}

/** 浮层调参：只写给到的字段，越界值按 sanitize 丢弃、不碰已有值。 */
export function setMotionOverride(
  patch: Partial<Pick<StoredMotion, "overrideShowMs" | "overrideHideMs" | "overrideEasing">>,
  kv: RecoveryKV = defaultRecoveryKV,
): void {
  const stored = readStoredMotion(kv);
  const clean = sanitize(patch as Record<string, unknown>);
  writeStoredMotion({ ...stored, ...clean }, kv);
}

export function clearMotionOverride(kv: RecoveryKV = defaultRecoveryKV): void {
  const { showMs, hideMs } = readStoredMotion(kv);
  const next: StoredMotion = {};
  if (showMs !== undefined) next.showMs = showMs;
  if (hideMs !== undefined) next.hideMs = hideMs;
  writeStoredMotion(next, kv);
}

/** 优先级：override > 实测 > 平台默认。曲线只有 override 一档（实测量不出曲线）。 */
export function resolveMotion(platform: MotionPlatform, stored: StoredMotion): KeyboardMotion {
  const base = PLATFORM_DEFAULTS[platform];
  const easingName = stored.overrideEasing ?? base.easingName;
  return {
    showMs: stored.overrideShowMs ?? stored.showMs ?? base.showMs,
    hideMs: stored.overrideHideMs ?? stored.hideMs ?? base.hideMs,
    easing: EASINGS[easingName],
    easingName,
  };
}
