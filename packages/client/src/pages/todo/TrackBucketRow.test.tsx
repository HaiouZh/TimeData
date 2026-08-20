// @vitest-environment jsdom
// biome-ignore assist/source/organizeImports: dbReset must be before tracksModule to register fake-indexeddb before Dexie
import { db, resetDb } from "../../test/dbReset.js";
import type { Track, TrackMilestone, TrackStep } from "@timedata/shared";
import { act } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as sessionsModule from "../../lib/sessions.js";
import * as trackMilestonesModule from "../../lib/trackMilestones.js";
import * as tracksModule from "../../lib/tracks.js";
import { DISPATCH_GROUP_LABELS, dispatchItems } from "../../lib/tracksDispatch.js";
import { DEFAULT_ACTION_TAGS } from "../../lib/settings/trackActionTagsSetting.js";
import { DEFAULT_AGENT_EXEC_TAGS } from "../../lib/settings/trackAgentExecTagsSetting.js";
import { DEFAULT_WAIT_EXTERNAL_TAGS } from "../../lib/settings/trackWaitExternalTagsSetting.js";
import { DEFAULT_RESUME_TAGS } from "../../lib/settings/trackResumeTagsSetting.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TrackBucketRow } from "./TrackBucketRow.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

beforeEach(async () => {
  await resetDb();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  if (mounted) {
    await unmount(mounted.root);
    mounted = null;
  }
  document.body.innerHTML = "";
});

function trackFactory(overrides: Partial<Track> = {}): Track {
  const now = "2026-08-18T12:00:00.000Z";
  return {
    id: "tr1",
    title: "轨道标题",
    status: "active",
    refs: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function stepFactory(overrides: Partial<TrackStep> & Pick<TrackStep, "id" | "seq">): TrackStep {
  const now = "2026-08-18T10:00:00.000Z";
  return {
    trackId: "tr1",
    source: "user",
    content: "步骤内容",
    startedAt: now,
    endedAt: now,
    refs: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as TrackStep;
}

function milestoneFactory(overrides: Partial<TrackMilestone> & Pick<TrackMilestone, "id" | "status">): TrackMilestone {
  return {
    trackId: "tr1",
    title: "阶段",
    note: null,
    taskId: null,
    position: 0,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

function dispatchItemFactory(overrides: Partial<ReturnType<typeof baseItem>> = {}) {
  const base = baseItem();
  return { ...base, ...overrides };
}

function baseItem() {
  const track = trackFactory();
  const step = stepFactory({ id: "s1", seq: 0, content: "最新一步的内容很长需要截断显示" });
  return {
    track,
    latest: step,
    signal: null,
    lastActivityAt: step.startedAt,
    stalledDays: null as number | null,
    group: "in-progress" as const,
  };
}

function baseSteps(): readonly TrackStep[] {
  return [stepFactory({ id: "s1", seq: 0, content: "最新一步的内容很长需要截断显示" })];
}

function widen(el: HTMLElement): void {
  el.getBoundingClientRect = () =>
    ({
      width: 200,
      height: 40,
      top: 0,
      left: 0,
      right: 200,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: () => "",
    }) as DOMRect;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function renderBucket(
  overrides: Partial<Parameters<typeof TrackBucketRow>[0]> = {},
): Promise<ReturnType<typeof renderDom>> {
  const item = overrides.item ?? baseItem();
  const fallbackSteps =
    (item as unknown as { steps?: readonly TrackStep[] }).steps ??
    (item.latest ? [(item.latest as TrackStep)] : ([] as readonly TrackStep[]));
  const steps = overrides.steps ?? (fallbackSteps as readonly TrackStep[]) ?? baseSteps();
  const milestones = overrides.milestones ?? [];
  const project = overrides.project ?? null;
  const expanded = overrides.expanded ?? false;
  const onToggleExpand = overrides.onToggleExpand ?? vi.fn();
  const onError = overrides.onError ?? vi.fn();
  const inHand = overrides.inHand ?? false;
  const element = (
    <MemoryRouter initialEntries={["/todo"]}>
      <Routes>
        <Route
          path="/todo"
          element={
            <TrackBucketRow
              item={item as unknown as Parameters<typeof TrackBucketRow>[0]["item"]}
              steps={steps}
              milestones={milestones}
              project={project}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              inHand={inHand}
              onError={onError}
            />
          }
        />
        <Route path="/tracks/:id" element={<div data-testid="track-detail-page" />} />
        <Route path="/goals/:id" element={<div data-testid="goal-detail-page" />} />
      </Routes>
    </MemoryRouter>
  );
  mounted = await renderDom(element);
  await flush();
  return mounted;
}

describe("TrackBucketRow 收起行", () => {
  it("⑤ 收起行形态：徽章文案、标题、chip、动静截断", async () => {
    const track = trackFactory({ id: "tr1", title: "推进轴" });
    const step = stepFactory({ id: "s1", seq: 0, content: "这是一条很长的最新动静内容用于验证截断" });
    const item = {
      track,
      latest: step,
      signal: null,
      lastActivityAt: step.startedAt,
      stalledDays: null,
      group: "awaiting-me" as const,
    };
    const project = { goalId: "g1", name: "项目 Alpha" };
    const milestones: TrackMilestone[] = [
      milestoneFactory({ id: "m1", status: "pending", position: 0 }),
      milestoneFactory({ id: "m2", status: "done", position: 1 }),
    ];
    const { host, root } = await renderBucket({ item: item as never, steps: [step], project, milestones });
    expect(host.textContent).toContain(DISPATCH_GROUP_LABELS["awaiting-me"]);
    expect(host.textContent).toContain("推进轴");
    const chip = host.querySelector('[data-testid="track-project-chip"]') as HTMLAnchorElement | null;
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("项目 Alpha");
    expect(chip?.getAttribute("href")).toContain("/goals/g1");
    const latestEl = host.querySelector('[data-testid="track-bucket-latest"]') as HTMLElement | null;
    expect(latestEl).not.toBeNull();
    expect(latestEl?.className).toContain("line-clamp-1");
    expect(latestEl?.textContent).toContain("这是一条很长的最新动静内容用于验证截断");
    const progress = host.querySelector('[data-testid="segment-progress-bar"]');
    expect(progress).not.toBeNull();
    await unmount(root);
    mounted = null;
  });

  it("⑥ 无步显「尚无步骤」", async () => {
    const track = trackFactory({ id: "tr2", title: "空轨道" });
    const item = {
      track,
      latest: null,
      signal: null,
      lastActivityAt: null,
      stalledDays: null,
      group: "in-progress" as const,
    };
    const { host, root } = await renderBucket({ item: item as never, steps: [] });
    expect(host.textContent).toContain("尚无步骤");
    await unmount(root);
    mounted = null;
  });

  it("⑦ dropped-only 不渲染迷你条", async () => {
    const milestones: TrackMilestone[] = [
      milestoneFactory({ id: "m1", status: "dropped", position: 0 }),
      milestoneFactory({ id: "m2", status: "dropped", position: 1 }),
    ];
    const { host, root } = await renderBucket({ milestones });
    expect(host.querySelector('[data-testid="segment-progress-bar"]')).toBeNull();
    expect(host.querySelector('[data-testid="track-bucket-progress"]')).toBeNull();
    await unmount(root);
    mounted = null;
  });

  it("⑧ 停滞小字", async () => {
    const item = dispatchItemFactory({ stalledDays: 5 });
    const { host, root } = await renderBucket({ item: item as never });
    const stalled = host.querySelector('[data-testid="track-stalled"]');
    expect(stalled).not.toBeNull();
    expect(stalled?.textContent).toBe("5 天没动静");
    expect(stalled?.className).toContain("td-text-caption");
    expect(stalled?.className).toContain("text-ink-3");
    await unmount(root);
    mounted = null;
  });

  it("⑨ 左区点击 onToggleExpand、右区是 /tracks/:id Link", async () => {
    const onToggleExpand = vi.fn();
    const { host, root } = await renderBucket({ onToggleExpand });
    const row = host.querySelector('[data-testid="track-bucket-row"]') as HTMLElement;
    expect(row).not.toBeNull();
    widen(row);
    await act(async () => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5 }));
    });
    expect(onToggleExpand).toHaveBeenCalledWith("tr1");
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    const link = host.querySelector('[data-testid="track-bucket-link"]') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toContain("/tracks/tr1");
    await unmount(root);
    mounted = null;
  });

  it("右区 Link 存在且键盘 Enter 跳轨道页", async () => {
    const { host, root } = await renderBucket({});
    const row = host.querySelector('[data-testid="track-bucket-row"]') as HTMLElement;
    widen(row);
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    expect(host.querySelector('[data-testid="track-detail-page"]')).not.toBeNull();
    await unmount(root);
    mounted = null;
  });
});

describe("TrackBucketRow 展开态", () => {
  it("⑩ 展开勾当前阶段落库", async () => {
    const track = trackFactory({ id: "tr1", title: "轨道" });
    await db.tracks.add(track);
    const milestone = milestoneFactory({ id: "m1", status: "pending", position: 0, title: "当前阶段A" });
    await db.trackMilestones.add(milestone as unknown as TrackMilestone);
    const item = {
      track,
      latest: null,
      signal: null,
      lastActivityAt: null,
      stalledDays: null,
      group: "in-progress" as const,
    };
    const { host, root } = await renderBucket({
      item: item as never,
      steps: [],
      milestones: [milestone],
      expanded: true,
    });
    const milestoneRow = host.querySelector('[data-testid="track-bucket-current-milestone"]');
    expect(milestoneRow?.textContent).toContain("当前阶段：当前阶段A");
    const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();
    await click(checkbox);
    await flush();
    await flush();
    const updated = await db.trackMilestones.get("m1");
    expect(updated?.status).toBe("done");
    await unmount(root);
    mounted = null;
  });

  it("无骨架不渲染当前阶段行", async () => {
    const { host, root } = await renderBucket({ expanded: true, milestones: [] });
    expect(host.querySelector('[data-testid="track-bucket-current-milestone"]')).toBeNull();
    await unmount(root);
    mounted = null;
  });

  it("⑪ 记一步落库且清空", async () => {
    const track = trackFactory({ id: "tr1", title: "轨道" });
    await db.tracks.add(track);
    const item = {
      track,
      latest: null,
      signal: null,
      lastActivityAt: null,
      stalledDays: null,
      group: "in-progress" as const,
    };
    const { host, root } = await renderBucket({ item: item as never, steps: [], expanded: true });
    const input = host.querySelector('input[aria-label="新步骤内容"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    function setInputValue(el: HTMLInputElement, value: string): void {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await act(async () => {
      setInputValue(input!, "新建的一步");
    });
    await flush();
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    await flush();
    for (let i = 0; i < 20; i += 1) {
      const count = await db.trackSteps.where("trackId").equals("tr1").count();
      if (count > 0) break;
      await flush();
    }
    const steps = await db.trackSteps.where("trackId").equals("tr1").toArray();
    expect(steps.length).toBe(1);
    expect(steps[0].content).toBe("新建的一步");
    expect((host.querySelector('input[aria-label="新步骤内容"]') as HTMLInputElement).value).toBe("");
    await unmount(root);
    mounted = null;
  });

  it("空白不提交", async () => {
    const track = trackFactory({ id: "tr1" });
    await db.tracks.add(track);
    const item = {
      track,
      latest: null,
      signal: null,
      lastActivityAt: null,
      stalledDays: null,
      group: "in-progress" as const,
    };
    const spy = vi.spyOn(tracksModule, "appendUserStep");
    const { host, root } = await renderBucket({ item: item as never, steps: [], expanded: true });
    const input = host.querySelector('input[aria-label="新步骤内容"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "   ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    expect(spy).not.toHaveBeenCalled();
    await unmount(root);
    mounted = null;
  });

  it("⑫ inHand 切换按钮文案与动作", async () => {
    const track = trackFactory({ id: "tr1" });
    await db.tracks.add(track);
    const item = {
      track,
      latest: null,
      signal: null,
      lastActivityAt: null,
      stalledDays: null,
      group: "in-progress" as const,
    };
    // inHand false -> shows 抓到手头
    const first = await renderBucket({ item: item as never, steps: [], expanded: true, inHand: false });
    let btn = first.host.querySelector('button[aria-label="抓到手头"]') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toContain("抓到手头");
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await flush();
    let session = await db.sessions.toArray();
    // After grab, trackIds should contain tr1
    const hasGrab = session.some((s) => (s as unknown as { trackIds?: string[] }).trackIds?.includes("tr1"));
    expect(hasGrab).toBe(true);
    await unmount(first.root);
    mounted = null;

    // inHand true -> shows 移出手头
    const second = await renderBucket({ item: item as never, steps: [], expanded: true, inHand: true });
    btn = second.host.querySelector('button[aria-label="移出手头"]') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toContain("移出手头");
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await flush();
    session = await db.sessions.toArray();
    const stillHas = session.some((s) => (s as unknown as { trackIds?: string[] }).trackIds?.includes("tr1"));
    expect(stillHas).toBe(false);
    await unmount(second.root);
    mounted = null;
  });

  it("⑬ 写入 reject → onError", async () => {
    const track = trackFactory({ id: "tr1" });
    await db.tracks.add(track);
    const item = {
      track,
      latest: null,
      signal: null,
      lastActivityAt: null,
      stalledDays: null,
      group: "in-progress" as const,
    };
    const onError = vi.fn();
    vi.spyOn(tracksModule, "appendUserStep").mockRejectedValue(new Error("写入失败"));
    const { host, root } = await renderBucket({ item: item as never, steps: [], expanded: true, onError });
    const input = host.querySelector('input[aria-label="新步骤内容"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "会失败的一步");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    await flush();
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toContain("写入失败");
    await unmount(root);
    mounted = null;
  });

  it("里程碑写入失败 → onError", async () => {
    const track = trackFactory({ id: "tr1" });
    await db.tracks.add(track);
    const milestone = milestoneFactory({ id: "m1", status: "pending", title: "阶段1" });
    await db.trackMilestones.add(milestone as unknown as TrackMilestone);
    const item = {
      track,
      latest: null,
      signal: null,
      lastActivityAt: null,
      stalledDays: null,
      group: "in-progress" as const,
    };
    const onError = vi.fn();
    vi.spyOn(trackMilestonesModule, "setMilestoneStatus").mockRejectedValue(new Error("里程碑失败"));
    const { host, root } = await renderBucket({
      item: item as never,
      steps: [],
      milestones: [milestone],
      expanded: true,
      onError,
    });
    const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await click(checkbox);
    await flush();
    await flush();
    expect(onError).toHaveBeenCalled();
    await unmount(root);
    mounted = null;
  });

  it("手头按钮写入失败 → onError", async () => {
    const track = trackFactory({ id: "tr1" });
    await db.tracks.add(track);
    const item = {
      track,
      latest: null,
      signal: null,
      lastActivityAt: null,
      stalledDays: null,
      group: "in-progress" as const,
    };
    const onError = vi.fn();
    vi.spyOn(sessionsModule, "grabTrackToHand").mockRejectedValue(new Error("手头失败"));
    const { host, root } = await renderBucket({ item: item as never, steps: [], expanded: true, onError, inHand: false });
    const btn = host.querySelector('button[aria-label="抓到手头"]') as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(onError).toHaveBeenCalled();
    await unmount(root);
    mounted = null;
  });

  it("提交中按钮 disabled", async () => {
    const track = trackFactory({ id: "tr1" });
    await db.tracks.add(track);
    const item = {
      track,
      latest: null,
      signal: null,
      lastActivityAt: null,
      stalledDays: null,
      group: "in-progress" as const,
    };
    let resolve!: () => void;
    const _pending = new Promise<never>((_, __) => {});
    // Mock append to hang
    const spy = vi
      .spyOn(tracksModule, "appendUserStep")
      .mockImplementation(
        () => new Promise((res) => (resolve = res as unknown as () => void)) as unknown as Promise<never>,
      );
    const { host, root } = await renderBucket({ item: item as never, steps: [], expanded: true });
    const input = host.querySelector('input[aria-label="新步骤内容"]') as HTMLInputElement;
    const button = host.querySelector('button[aria-label="提交新步骤"]') as HTMLButtonElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "挂起的一步");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    expect(button.disabled).toBe(true);
    expect(input.disabled).toBe(true);
    // Cleanup resolve to avoid hanging
    spy.mockRestore();
    await unmount(root);
    mounted = null;
  });

  it("SignalSwitcher 渲染", async () => {
    const { host, root } = await renderBucket({ expanded: true });
    // SignalSwitcher renders container with data-testid signal-switcher when track active
    // Need to flush for settings
    for (let i = 0; i < 10; i += 1) await flush();
    expect(host.querySelector('[data-testid="signal-switcher"]')).not.toBeNull();
    await unmount(root);
    mounted = null;
  });
});

describe("TrackBucketRow 守卫：信号完整流分辨（规格3）", () => {
  it("完整 steps 含等外部信号时，SignalSwitcher 等外部为高亮；单步兜底则判不出", async () => {
    const track = trackFactory({ id: "tr1", title: "信号轨道" });
    const sWait = stepFactory({
      id: "s1",
      seq: 0,
      trackId: "tr1",
      tags: ["等外部"],
      content: "等外部阻塞",
      startedAt: "2026-08-18T10:00:00.000Z",
      endedAt: "2026-08-18T10:00:00.000Z",
    });
    const sFollow = stepFactory({
      id: "s2",
      seq: 1,
      trackId: "tr1",
      tags: [],
      content: "后续更新",
      startedAt: "2026-08-18T11:00:00.000Z",
      endedAt: "2026-08-18T11:00:00.000Z",
    });
    const steps: readonly TrackStep[] = [sWait, sFollow];
    // 用真实口径产 item：latest = sFollow，但 signal 仍为 等外部（最近带 tag 的步）
    const items = dispatchItems(
      [track],
      new Map<string, TrackStep[]>([["tr1", [...steps] as TrackStep[]]]),
      DEFAULT_ACTION_TAGS,
      DEFAULT_AGENT_EXEC_TAGS,
      DEFAULT_WAIT_EXTERNAL_TAGS,
      DEFAULT_RESUME_TAGS,
      new Date("2026-08-18T12:00:00.000Z"),
    );
    const item = items[0];
    expect(item.latest?.id).toBe("s2");
    expect(item.signal?.tag).toBe("等外部");
    expect(item.group).toBe("wait-external");
    const { host, root } = await renderBucket({ item: item as never, steps, expanded: true });
    for (let i = 0; i < 10; i += 1) await flush();
    const waitExternalBtn = host.querySelector('[data-testid="signal-wait-external"]') as HTMLElement | null;
    expect(waitExternalBtn).not.toBeNull();
    expect(waitExternalBtn?.getAttribute("data-active")).toBe("true");
    // 其它胶囊不应高亮
    const awaitingBtn = host.querySelector('[data-testid="signal-awaiting-me"]');
    const agentBtn = host.querySelector('[data-testid="signal-agent-running"]');
    const resumeBtn = host.querySelector('[data-testid="signal-in-progress"]');
    if (awaitingBtn) expect(awaitingBtn.getAttribute("data-active")).not.toBe("true");
    if (agentBtn) expect(agentBtn.getAttribute("data-active")).not.toBe("true");
    if (resumeBtn) expect(resumeBtn.getAttribute("data-active")).not.toBe("true");
    // 单步兜底变异下应红：在此断言单步产生的信号为 null、分入推进中，用于说明变异会红
    const singleItems = dispatchItems(
      [track],
      new Map<string, TrackStep[]>([["tr1", item.latest ? [item.latest as TrackStep] : []]]),
      DEFAULT_ACTION_TAGS,
      DEFAULT_AGENT_EXEC_TAGS,
      DEFAULT_WAIT_EXTERNAL_TAGS,
      DEFAULT_RESUME_TAGS,
      new Date("2026-08-18T12:00:00.000Z"),
    );
    expect(singleItems[0].signal).toBeNull();
    expect(singleItems[0].group).toBe("in-progress");
    await unmount(root);
    mounted = null;
  });
});

describe("TrackBucketRow 守卫：提交草稿保留（规格4）", () => {
  function setInputValue(el: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("提交失败保留草稿且 onError 被调", async () => {
    const track = trackFactory({ id: "tr1" });
    await db.tracks.add(track);
    const item = {
      track,
      latest: null,
      signal: null,
      lastActivityAt: null,
      stalledDays: null,
      group: "in-progress" as const,
    };
    const onError = vi.fn();
    vi.spyOn(tracksModule, "appendUserStep").mockRejectedValue(new Error("写入失败-守卫"));
    const { host, root } = await renderBucket({ item: item as never, steps: [], expanded: true, onError });
    const input = host.querySelector('input[aria-label="新步骤内容"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "失败保留原文");
    });
    await flush();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    for (let i = 0; i < 10; i += 1) await flush();
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toContain("写入失败-守卫");
    expect((host.querySelector('input[aria-label="新步骤内容"]') as HTMLInputElement).value).toBe("失败保留原文");
    await unmount(root);
    mounted = null;
  });

  it("await 期间键入新字符不被清空（规格1 回归）", async () => {
    const track = trackFactory({ id: "tr1" });
    await db.tracks.add(track);
    const item = {
      track,
      latest: null,
      signal: null,
      lastActivityAt: null,
      stalledDays: null,
      group: "in-progress" as const,
    };
    let pendingResolve!: (value: unknown) => void;
    const pendingPromise = new Promise<unknown>((resolve) => {
      pendingResolve = resolve;
    });
    vi.spyOn(tracksModule, "appendUserStep").mockImplementation(() => pendingPromise as never);
    const { host, root } = await renderBucket({ item: item as never, steps: [], expanded: true });
    const input = host.querySelector('input[aria-label="新步骤内容"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "初始内容");
    });
    await flush();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    // await 期间用户继续键入
    await act(async () => {
      setInputValue(input, "初始内容追加");
    });
    await flush();
    // resolve 提交
    await act(async () => {
      pendingResolve({ closed: [], created: null });
      // 让 handleSubmit 的 await 完成
      await new Promise((r) => window.setTimeout(r, 0));
    });
    await flush();
    await flush();
    // 若为无条件 setDraft("") 则会被清空，此断言在该变异下必须红
    expect((host.querySelector('input[aria-label="新步骤内容"]') as HTMLInputElement).value).toBe("初始内容追加");
    await unmount(root);
    mounted = null;
  });
});

describe("TrackBucketRow 守卫：里程碑边界（规格5）", () => {
  it("全 dropped 里程碑展开态不渲染当前阶段行", async () => {
    const milestones: TrackMilestone[] = [
      milestoneFactory({ id: "m1", status: "dropped", position: 0, title: "阶段1" }),
      milestoneFactory({ id: "m2", status: "dropped", position: 1, title: "阶段2" }),
    ];
    const { host, root } = await renderBucket({ milestones, expanded: true });
    expect(host.querySelector('[data-testid="track-bucket-current-milestone"]')).toBeNull();
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    await unmount(root);
    mounted = null;
  });
});

describe("TrackBucketRow 守卫：手头失败路径（规格6）", () => {
  it("inHand 行 releaseTrackFromHand reject 时 onError 收到消息", async () => {
    const track = trackFactory({ id: "tr1" });
    await db.tracks.add(track);
    const item = {
      track,
      latest: null,
      signal: null,
      lastActivityAt: null,
      stalledDays: null,
      group: "in-progress" as const,
    };
    const onError = vi.fn();
    vi.spyOn(sessionsModule, "releaseTrackFromHand").mockRejectedValue(new Error("移出手头失败-守卫"));
    const { host, root } = await renderBucket({ item: item as never, steps: [], expanded: true, inHand: true, onError });
    const btn = host.querySelector('button[aria-label="移出手头"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await flush();
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toContain("移出手头失败-守卫");
    await unmount(root);
    mounted = null;
  });
});
