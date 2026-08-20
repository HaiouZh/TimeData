// @vitest-environment jsdom
// biome-ignore assist/source/organizeImports: dbReset must be before tracksModule to register fake-indexeddb before Dexie
import { db } from "../../../test/dbReset.js";
import type { Track, TrackStep } from "@timedata/shared";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as tracksModule from "../../../lib/tracks.js";
import { renderDom, unmount } from "../../../test/domHarness.js";
import { SignalSwitcher } from "./SignalSwitcher.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

// 纯 spy 直通原实现：信号步正文「→ 组名」由组件生成，可直接过 trimRequired 落库
let originalAppendForMock: typeof tracksModule.appendUserStep | null = null;
let appendSpy: ReturnType<typeof vi.spyOn> | null = null;

function installAppendMock() {
  if (!originalAppendForMock) originalAppendForMock = tracksModule.appendUserStep;
  const orig = originalAppendForMock;
  appendSpy = vi.spyOn(tracksModule, "appendUserStep").mockImplementation(async (input) => orig(input));
}

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await db.tracks.clear();
  await db.trackSteps.clear();
  await db.settings.clear();
  await db.syncLog.clear();
  // afterEach 的 restoreAllMocks 会把上轮 spy 卸掉，此处重装
  installAppendMock();
});

afterEach(async () => {
  vi.restoreAllMocks();
  appendSpy = null;
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitForButton(host: HTMLElement, text: string): Promise<HTMLButtonElement> {
  for (let i = 0; i < 200; i += 1) {
    const btn = [...host.querySelectorAll("button")].find((b) => b.textContent === text) as
      | HTMLButtonElement
      | undefined;
    if (btn) return btn;
    await flush();
  }
  throw new Error(`Timed out waiting for button ${text}`);
}

async function mountSwitcher(track: Track, steps: TrackStep[], onError?: (msg: string) => void) {
  mounted = await renderDom(createElement(SignalSwitcher, { track, steps, onError }));
  // 等 settings liveQuery 回流（actionTags 等默认）
  for (let i = 0; i < 200; i += 1) {
    if (hostHasSwitcher(mounted.host)) break;
    await flush();
  }
  await flush();
  return mounted.host;
}

function hostHasSwitcher(host: HTMLElement): boolean {
  return host.querySelector('[data-testid="signal-switcher"]') !== null;
}

function trackFactory(partial: Partial<Track> = {}): Track {
  const now = "2026-06-21T03:00:00.000Z";
  return {
    id: "track-1",
    title: "测试轨道",
    status: "active",
    refs: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

function stepFactory(partial: Partial<TrackStep> & { id: string; seq: number }): TrackStep {
  const now = "2026-06-21T03:00:00.000Z";
  return {
    trackId: "track-1",
    source: "user",
    content: "step",
    startedAt: now,
    endedAt: now,
    refs: [],
    tags: [],
    seq: 0,
    createdAt: now,
    updatedAt: now,
    ...partial,
  } as TrackStep;
}

async function clickButton(host: HTMLElement, text: string) {
  const btn = await waitForButton(host, text);
  await act(async () => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
  // appendUserStep 异步写入，需再等
  await flush();
  await flush();
}

describe("SignalSwitcher", () => {
  it("⑥ 无信号 → 恢复推进胶囊高亮（in-progress 组）", async () => {
    const track = trackFactory();
    await db.tracks.add(track);
    const host = await mountSwitcher(track, []);
    const resumeBtn = await waitForButton(host, "恢复推进");
    expect(resumeBtn.getAttribute("data-active")).toBe("true");
    expect(resumeBtn.getAttribute("aria-label")).toBe("切换信号：恢复推进");
    // 其他胶囊不高亮
    const awaitingBtn = await waitForButton(host, "等我接");
    expect(awaitingBtn.getAttribute("data-active")).toBe("false");
  });

  it("⑦ 最近步带「等外部」→ 等外部高亮", async () => {
    const track = trackFactory();
    await db.tracks.add(track);
    const steps: TrackStep[] = [
      stepFactory({
        id: "s1",
        seq: 0,
        tags: ["等外部"],
        startedAt: "2026-06-21T01:00:00.000Z",
        endedAt: "2026-06-21T01:00:00.000Z",
      }),
    ];
    const host = await mountSwitcher(track, steps);
    const waitBtn = await waitForButton(host, "等外部");
    expect(waitBtn.getAttribute("data-active")).toBe("true");
    const resumeBtn = await waitForButton(host, "恢复推进");
    expect(resumeBtn.getAttribute("data-active")).toBe("false");
  });

  it("⑧ 点「等我接」→ appendUserStep 效果落库（新步 tags 含 actionTags[0]）", async () => {
    const track = trackFactory();
    await db.tracks.add(track);
    const host = await mountSwitcher(track, []);
    // 确认初始无步
    expect(await db.trackSteps.where("trackId").equals(track.id).count()).toBe(0);
    appendSpy!.mockClear();
    await clickButton(host, "等我接");
    // 校验调用参数为规格要求
    const lastCall = appendSpy!.mock.calls[appendSpy!.mock.calls.length - 1]?.[0] as
      | Parameters<typeof tracksModule.appendUserStep>[0]
      | undefined;
    expect(lastCall).toBeDefined();
    expect(lastCall?.trackId).toBe(track.id);
    expect(lastCall?.content).toBe("→ 等我接");
    expect(lastCall?.mode).toBe("instant");
    // 默认 actionTags[0] 为 待我处理（shared DEFAULT_TRACK_BOARD_SIGNALS[0]）
    expect(lastCall?.tags).toEqual(["待我处理"]);
    // 落库校验：DB 有新步且 tags 含该标签
    const stepsAfter = await db.trackSteps.where("trackId").equals(track.id).toArray();
    expect(stepsAfter.length).toBe(1);
    expect(stepsAfter[0].tags).toContain("待我处理");
  });

  it("⑨ 当前组高亮胶囊再点 → 不新增步（步数不变）", async () => {
    const track = trackFactory();
    await db.tracks.add(track);
    // 先铺一个等外部信号，使等外部为当前组
    const steps: TrackStep[] = [
      stepFactory({
        id: "s1",
        seq: 0,
        tags: ["等外部"],
        startedAt: "2026-06-21T01:00:00.000Z",
        endedAt: "2026-06-21T01:00:00.000Z",
      }),
    ];
    for (const s of steps) await db.trackSteps.add(s);
    const initialCount = await db.trackSteps.where("trackId").equals(track.id).count();
    const host = await mountSwitcher(track, steps);
    const waitBtn = await waitForButton(host, "等外部");
    expect(waitBtn.getAttribute("data-active")).toBe("true");
    appendSpy!.mockClear();
    await clickButton(host, "等外部");
    // 幂等：不写步
    expect(appendSpy).not.toHaveBeenCalled();
    const afterCount = await db.trackSteps.where("trackId").equals(track.id).count();
    expect(afterCount).toBe(initialCount);
  });

  it("⑩ concluded 轨道 → 返回 null 不渲染", async () => {
    const track = trackFactory({ status: "concluded" });
    await db.tracks.add(track);
    const host = await mountSwitcher(track, []);
    // SignalSwitcher 返回 null，host 内应无 switcher 容器
    await flush();
    // 即使等待，也不应出现按钮
    expect(host.querySelector('[data-testid="signal-switcher"]')).toBeNull();
    expect(host.querySelector("button")).toBeNull();
  });

  it("非 active 时整行不渲染（parked）", async () => {
    const track = trackFactory({ status: "parked" as Track["status"] });
    await db.tracks.add(track);
    const host = await mountSwitcher(track, []);
    await flush();
    expect(host.querySelector('[data-testid="signal-switcher"]')).toBeNull();
  });

  it("⑪ in-flight 锁：同胶囊连点只一次调用，期间按钮 disabled", async () => {
    const track = trackFactory();
    await db.tracks.add(track);
    let resolve!: () => void;
    const pending = new Promise<void>((r) => {
      resolve = r;
    });
    // 挂起 appendUserStep
    appendSpy!.mockImplementation(() => pending as unknown as Promise<never>);
    const host = await mountSwitcher(track, []);
    const btn = await waitForButton(host, "等我接");
    expect(btn.getAttribute("data-active")).toBe("false");
    // 第一次点击
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(btn.disabled).toBe(true);
    // 同胶囊二次连点应被忽略
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(appendSpy).toHaveBeenCalledTimes(1);
    // 其他胶囊也应 disabled
    const resumeBtn = await waitForButton(host, "恢复推进");
    expect(resumeBtn.disabled).toBe(true);
    // resolve 后解锁
    resolve();
    for (let i = 0; i < 20; i += 1) await flush();
    expect(btn.disabled).toBe(false);
    expect(resumeBtn.disabled).toBe(false);
  });

  it("⑫ appendUserStep 失败通过 onError 信道", async () => {
    const track = trackFactory();
    await db.tracks.add(track);
    const onError = vi.fn();
    appendSpy!.mockRejectedValue(new Error("写入失败 mock"));
    const host = await mountSwitcher(track, [], onError);
    await clickButton(host, "等我接");
    // onError 应收到消息
    for (let i = 0; i < 20; i += 1) {
      if (onError.mock.calls.length > 0) break;
      await flush();
    }
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain("写入失败 mock");
    // 失败后按钮应恢复可用
    const btn = await waitForButton(host, "等我接");
    expect(btn.disabled).toBe(false);
  });
});
