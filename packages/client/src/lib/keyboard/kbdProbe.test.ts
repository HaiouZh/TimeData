import { describe, expect, it } from "vitest";
import type { RecoveryKV } from "../recovery/kv.js";
import { type PendingReport, SYNC_LOG_DETAIL_MAX } from "../recovery/pendingReports.js";
import {
  type KbdSession,
  PROBE_BUDGET,
  type ProbeSwitch,
  createKeyboardProbeTracker,
  encodeSession,
  readProbeSwitch,
  writeProbeSwitch,
} from "./kbdProbe.js";

function memoryKV(): RecoveryKV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
}

function harness(sw: ProbeSwitch = { on: true, left: PROBE_BUDGET }, navCollapsed = false) {
  const stashed: PendingReport[] = [];
  let current = sw;
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const tracker = createKeyboardProbeTracker({
    platform: "android",
    os: "13",
    build: "b1",
    route: () => "/todo",
    motion: () => ({ showMs: 285, hideMs: 285, easingName: "android" }),
    stash: (r) => void stashed.push(r),
    readSwitch: () => current,
    writeSwitch: (n) => {
      current = n;
    },
    navCollapsed: () => navCollapsed,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms, cleared: false });
      return timers.length - 1;
    },
    clearTimer: (h) => {
      const t = timers[h as number];
      if (t) t.cleared = true;
    },
  });
  return {
    tracker,
    stashed,
    get switch() {
      return current;
    },
    timers,
  };
}

const zero = { scrollY: 0, vvTop: 0 };

describe("kbdProbe tracker", () => {
  it("一次 fi→ws→ts→ds→te→wh→dh 落一条 kbd_session，字段齐全、时刻相对 fi", () => {
    const h = harness();
    h.tracker.focusTarget(true);
    h.tracker.push({ type: "fi", t: 1000, ...zero });
    h.tracker.push({ type: "ws", t: 1213, scrollY: 40, vvTop: 0, height: 300 });
    h.tracker.push({ type: "ff", t: 1231, ...zero, frameMs: 18 });
    h.tracker.push({ type: "ts", t: 1230, ...zero });
    h.tracker.push({ type: "ds", t: 1470, ...zero });
    h.tracker.push({ type: "te", t: 1478, ...zero });
    h.tracker.push({ type: "wh", t: 3300, ...zero });
    h.tracker.push({ type: "ff", t: 3334, ...zero, frameMs: 34 });
    h.tracker.push({ type: "dh", t: 3560, ...zero });
    expect(h.stashed).toHaveLength(1);
    const r = h.stashed[0];
    expect(r?.action).toBe("kbd_session");
    const d = JSON.parse(r?.detail ?? "{}") as KbdSession;
    expect(d).toMatchObject({ v: 1, p: "android", os: "13", b: "b1", r: "/todo", in: "dock", kh: 300, nav: 0 });
    expect(d.ev[0]).toEqual(["fi", 0, 0, 0]);
    expect(d.ev[1]).toEqual(["ws", 213, 40, 0]);
    expect(d.ev.map((e) => e[0])).toEqual(["fi", "ws", "ts", "ds", "te", "wh", "dh"]);
    expect(d.ff).toEqual([18, 34]);
    expect(d.dur).toEqual([257, 260]);
    expect(d.mo).toEqual([285, 285, "android"]);
    expect(h.switch.left).toBe(PROBE_BUDGET - 1);
  });

  it("聚焦的不是驻坞条里的输入框时 in=page；底栏收了记 nav=1", () => {
    const h = harness({ on: true, left: 3 }, true);
    h.tracker.focusTarget(false);
    h.tracker.push({ type: "fi", t: 0, ...zero });
    h.tracker.push({ type: "ws", t: 10, ...zero, height: 300 });
    h.tracker.push({ type: "dh", t: 500, ...zero });
    const d = JSON.parse(h.stashed[0]?.detail ?? "{}") as KbdSession;
    expect(d.in).toBe("page");
    expect(d.nav).toBe(1);
  });

  it("开关关着不记；预算用尽自动关", () => {
    const off = harness({ on: false, left: 5 });
    off.tracker.push({ type: "fi", t: 0, ...zero });
    off.tracker.push({ type: "dh", t: 500, ...zero });
    expect(off.stashed).toHaveLength(0);

    const last = harness({ on: true, left: 1 });
    last.tracker.push({ type: "fi", t: 0, ...zero });
    last.tracker.push({ type: "ws", t: 10, ...zero, height: 300 });
    last.tracker.push({ type: "dh", t: 500, ...zero });
    expect(last.stashed).toHaveLength(1);
    expect(last.switch).toEqual({ on: false, left: 0 });
    // 关了之后再来一轮：不记
    last.tracker.push({ type: "fi", t: 1000, ...zero });
    last.tracker.push({ type: "dh", t: 1500, ...zero });
    expect(last.stashed).toHaveLength(1);
  });

  it("没有 fi 的孤儿事件不开会话（页面加载时键盘已弹着）", () => {
    const h = harness();
    h.tracker.push({ type: "ws", t: 10, ...zero, height: 300 });
    h.tracker.push({ type: "dh", t: 500, ...zero });
    expect(h.stashed).toHaveLength(0);
  });

  it("fo 之后 1 s 没有 will 事件，也闭合会话（外接键盘 / 事件丢失）；期间来了 ws 则取消闭合", () => {
    const h = harness();
    h.tracker.push({ type: "fi", t: 0, ...zero });
    h.tracker.push({ type: "fo", t: 800, ...zero });
    expect(h.stashed).toHaveLength(0);
    expect(h.timers.at(-1)?.ms).toBe(1000);
    h.timers.at(-1)?.fn();
    expect(h.stashed).toHaveLength(1);
    expect((JSON.parse(h.stashed[0]?.detail ?? "{}") as KbdSession).dur).toEqual([null, null]);

    const h2 = harness();
    h2.tracker.push({ type: "fi", t: 0, ...zero });
    h2.tracker.push({ type: "fo", t: 800, ...zero });
    h2.tracker.push({ type: "ws", t: 900, ...zero, height: 300 });
    expect(h2.timers.at(-1)?.cleared).toBe(true);
    h2.tracker.push({ type: "dh", t: 1500, ...zero });
    expect(h2.stashed).toHaveLength(1);
  });

  it("新的 fi 先闭合上一段再开新段（连点两个输入框）", () => {
    const h = harness();
    h.tracker.push({ type: "fi", t: 0, ...zero });
    h.tracker.push({ type: "ws", t: 10, ...zero, height: 300 });
    h.tracker.push({ type: "fi", t: 2000, ...zero });
    expect(h.stashed).toHaveLength(1);
    h.tracker.push({ type: "dh", t: 2500, ...zero });
    expect(h.stashed).toHaveLength(2);
    expect((JSON.parse(h.stashed[1]?.detail ?? "{}") as KbdSession).ev[0]).toEqual(["fi", 0, 0, 0]);
  });

  it("encodeSession 超过 1000 字符时先截 ev 尾部并标 trunc", () => {
    const ev = Array.from({ length: 200 }, (_, i) => ["vs", i * 7, 0, 0] as const);
    const s = encodeSession({
      v: 1,
      p: "ios",
      os: "17",
      b: "b",
      r: "/",
      in: "dock",
      kh: 300,
      ev: [...ev],
      ff: [1, 2],
      dur: [250, 250],
      mo: [250, 250, "ios"],
      nav: 0,
    });
    expect(s.length).toBeLessThanOrEqual(SYNC_LOG_DETAIL_MAX);
    expect((JSON.parse(s) as KbdSession).trunc).toBe(true);
  });
});

describe("探针开关", () => {
  it("读写往返；left 归 0 即视为关；坏 JSON 当关", () => {
    const kv = memoryKV();
    expect(readProbeSwitch(kv)).toEqual({ on: false, left: 0 });
    writeProbeSwitch({ on: true, left: 20 }, kv);
    expect(readProbeSwitch(kv)).toEqual({ on: true, left: 20 });
    writeProbeSwitch({ on: true, left: 0 }, kv);
    expect(readProbeSwitch(kv).on).toBe(false);
    writeProbeSwitch({ on: false, left: 0 }, kv);
    expect(kv.data.has("timedata_keyboard_probe")).toBe(false);
    kv.set("timedata_keyboard_probe", "{nope");
    expect(readProbeSwitch(kv)).toEqual({ on: false, left: 0 });
  });
});
