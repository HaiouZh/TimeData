import { describe, expect, it } from "vitest";
import type { RecoveryKV } from "../recovery/kv.js";
import {
  DURATION_MAX_MS,
  DURATION_MIN_MS,
  EASINGS,
  PLATFORM_DEFAULTS,
  clearMotionOverride,
  readStoredMotion,
  recordMeasuredDuration,
  resolveMotion,
  setMotionOverride,
} from "./keyboardMotionPrefs.js";

function memoryKV(): RecoveryKV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
}

describe("keyboardMotionPrefs", () => {
  it("没有任何记录时按平台默认：iOS 250/250 iOS 曲线，Android 285/285 系统曲线，web 250/200 TG 曲线", () => {
    const kv = memoryKV();
    expect(resolveMotion("ios", readStoredMotion(kv))).toEqual(PLATFORM_DEFAULTS.ios);
    expect(PLATFORM_DEFAULTS.ios).toEqual({ showMs: 250, hideMs: 250, easing: EASINGS.ios, easingName: "ios" });
    expect(PLATFORM_DEFAULTS.android).toEqual({
      showMs: 285,
      hideMs: 285,
      easing: EASINGS.android,
      easingName: "android",
    });
    expect(PLATFORM_DEFAULTS.web).toEqual({ showMs: 250, hideMs: 200, easing: EASINGS.tg, easingName: "tg" });
  });

  it("实测时长落在 [80,700] 才采信并覆盖同向旧值；越界拒收返回 false 且不写", () => {
    const kv = memoryKV();
    expect(recordMeasuredDuration("show", 257, kv)).toBe(true);
    expect(recordMeasuredDuration("show", 301, kv)).toBe(true);
    expect(recordMeasuredDuration("hide", DURATION_MIN_MS - 1, kv)).toBe(false);
    expect(recordMeasuredDuration("hide", DURATION_MAX_MS + 1, kv)).toBe(false);
    expect(recordMeasuredDuration("hide", Number.NaN, kv)).toBe(false);
    const stored = readStoredMotion(kv);
    expect(stored.showMs).toBe(301);
    expect(stored.hideMs).toBeUndefined();
    expect(resolveMotion("android", stored).showMs).toBe(301);
    expect(resolveMotion("android", stored).hideMs).toBe(285);
  });

  it("小数时长四舍五入后落盘", () => {
    const kv = memoryKV();
    expect(recordMeasuredDuration("hide", 259.6, kv)).toBe(true);
    expect(readStoredMotion(kv).hideMs).toBe(260);
  });

  it("override 压过实测与默认；clear 后回到实测", () => {
    const kv = memoryKV();
    recordMeasuredDuration("show", 300, kv);
    setMotionOverride({ overrideShowMs: 180, overrideEasing: "tg" }, kv);
    const m = resolveMotion("ios", readStoredMotion(kv));
    expect(m.showMs).toBe(180);
    expect(m.hideMs).toBe(250);
    expect(m.easing).toBe(EASINGS.tg);
    expect(m.easingName).toBe("tg");
    clearMotionOverride(kv);
    expect(resolveMotion("ios", readStoredMotion(kv)).showMs).toBe(300);
    expect(resolveMotion("ios", readStoredMotion(kv)).easingName).toBe("ios");
  });

  it("override 越界值被丢弃，不污染已有 override", () => {
    const kv = memoryKV();
    setMotionOverride({ overrideShowMs: 180 }, kv);
    setMotionOverride({ overrideShowMs: 5, overrideHideMs: 220 }, kv);
    const stored = readStoredMotion(kv);
    expect(stored.overrideShowMs).toBe(180);
    expect(stored.overrideHideMs).toBe(220);
  });

  it("坏 JSON / 非数字字段按空处理，不抛", () => {
    const kv = memoryKV();
    kv.set("timedata_keyboard_motion", "{not json");
    expect(readStoredMotion(kv)).toEqual({});
    kv.set("timedata_keyboard_motion", JSON.stringify({ showMs: "x", overrideEasing: "nope" }));
    expect(readStoredMotion(kv)).toEqual({});
  });

  it("全部字段清空时删 key 而不是留一个 {}", () => {
    const kv = memoryKV();
    setMotionOverride({ overrideShowMs: 180 }, kv);
    clearMotionOverride(kv);
    expect(kv.data.has("timedata_keyboard_motion")).toBe(false);
  });
});
