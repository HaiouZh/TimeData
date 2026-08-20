// @vitest-environment jsdom
import { db, resetDb } from "../../test/dbReset.js";
import type { Goal, Track, TrackStep } from "@timedata/shared";
import { act } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { DISPATCH_GROUP_LABELS } from "../../lib/tracksDispatch.js";
import { HandTrackRows, TrackBucketSection } from "./TrackBucketSection.js";

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

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function renderBucketSection(props: Parameters<typeof TrackBucketSection>[0]): Promise<ReturnType<typeof renderDom>> {
  const element = (
    <MemoryRouter initialEntries={["/todo"]}>
      <Routes>
        <Route
          path="/todo"
          element={
            <TrackBucketSection
              tracks={props.tracks}
              stepsByTrack={props.stepsByTrack}
              sessionTrackIds={props.sessionTrackIds}
              expandedTrackIds={props.expandedTrackIds}
              onToggleExpand={props.onToggleExpand}
              onError={props.onError}
            />
          }
        />
        <Route path="/tracks/:id" element={<div data-testid="track-detail-page" />} />
        <Route path="/goals/:id" element={<div data-testid="goal-detail-page" />} />
      </Routes>
    </MemoryRouter>
  );
  mounted = await renderDom(element);
  // need multiple flush for liveQuery
  for (let i = 0; i < 5; i += 1) await flush();
  return mounted;
}

async function renderHandRows(props: Parameters<typeof HandTrackRows>[0]): Promise<ReturnType<typeof renderDom>> {
  const element = (
    <MemoryRouter initialEntries={["/todo"]}>
      <Routes>
        <Route
          path="/todo"
          element={
            <HandTrackRows
              tracks={props.tracks}
              stepsByTrack={props.stepsByTrack}
              expandedTrackIds={props.expandedTrackIds}
              onToggleExpand={props.onToggleExpand}
              onError={props.onError}
            />
          }
        />
        <Route path="/tracks/:id" element={<div data-testid="track-detail-page" />} />
        <Route path="/goals/:id" element={<div data-testid="goal-detail-page" />} />
      </Routes>
    </MemoryRouter>
  );
  mounted = await renderDom(element);
  for (let i = 0; i < 5; i += 1) await flush();
  return mounted;
}

describe("TrackBucketSection", () => {
  it("按信号分组渲染：两组各有行、组名可见", async () => {
    const t1 = trackFactory({ id: "t1", title: "等我接轨道" });
    const t2 = trackFactory({ id: "t2", title: "推进中轨道" });
    // t1 latest step has 待我处理 -> awaiting-me, t2 has no signal -> in-progress
    const s1 = stepFactory({ id: "s1", seq: 0, trackId: "t1", tags: ["待我处理"], content: "待我处理内容" });
    const s2 = stepFactory({ id: "s2", seq: 0, trackId: "t2", tags: [], content: "推进内容" });
    const stepsByTrack = new Map<string, TrackStep[]>([
      ["t1", [s1]],
      ["t2", [s2]],
    ]);
    const { host, root } = await renderBucketSection({
      tracks: [t1, t2],
      stepsByTrack,
      sessionTrackIds: [],
      expandedTrackIds: new Set(),
      onToggleExpand: vi.fn(),
      onError: vi.fn(),
    });
    expect(host.textContent).toContain(DISPATCH_GROUP_LABELS["awaiting-me"]);
    expect(host.textContent).toContain(DISPATCH_GROUP_LABELS["in-progress"]);
    expect(host.textContent).toContain("等我接轨道");
    expect(host.textContent).toContain("推进中轨道");
    expect(host.querySelectorAll('[data-testid="track-bucket-row"]').length).toBe(2);
    await unmount(root);
    mounted = null;
  });

  it("sessionTrackIds 排他：被抓轨道不出现在桶", async () => {
    const t1 = trackFactory({ id: "t1", title: "被抓轨道" });
    const t2 = trackFactory({ id: "t2", title: "桶轨道" });
    const s1 = stepFactory({ id: "s1", seq: 0, trackId: "t1", tags: [] });
    const s2 = stepFactory({ id: "s2", seq: 0, trackId: "t2", tags: [] });
    const stepsByTrack = new Map<string, TrackStep[]>([
      ["t1", [s1]],
      ["t2", [s2]],
    ]);
    const { host, root } = await renderBucketSection({
      tracks: [t1, t2],
      stepsByTrack,
      sessionTrackIds: ["t1"],
      expandedTrackIds: new Set(),
      onToggleExpand: vi.fn(),
      onError: vi.fn(),
    });
    expect(host.textContent).not.toContain("被抓轨道");
    expect(host.textContent).toContain("桶轨道");
    expect(host.querySelectorAll('[data-testid="track-bucket-row"]').length).toBe(1);
    await unmount(root);
    mounted = null;
  });

  it("全被抓/无轨道时 section 不渲染", async () => {
    const t1 = trackFactory({ id: "t1", title: "轨道1" });
    const s1 = stepFactory({ id: "s1", seq: 0, trackId: "t1", tags: [] });
    const stepsByTrack = new Map<string, TrackStep[]>([["t1", [s1]]]);
    // 无轨道
    const empty = await renderBucketSection({
      tracks: [],
      stepsByTrack: new Map(),
      sessionTrackIds: [],
      expandedTrackIds: new Set(),
      onToggleExpand: vi.fn(),
      onError: vi.fn(),
    });
    expect(empty.host.querySelector('[data-section="todo-track-bucket"]')).toBeNull();
    await unmount(empty.root);
    mounted = null;

    // 全被抓
    const allGrabbed = await renderBucketSection({
      tracks: [t1],
      stepsByTrack,
      sessionTrackIds: ["t1"],
      expandedTrackIds: new Set(),
      onToggleExpand: vi.fn(),
      onError: vi.fn(),
    });
    expect(allGrabbed.host.querySelector('[data-section="todo-track-bucket"]')).toBeNull();
    await unmount(allGrabbed.root);
    mounted = null;
  });

  it("展开态透传：expandedTrackIds 命中的行展开", async () => {
    const t1 = trackFactory({ id: "t1", title: "展开轨道" });
    const t2 = trackFactory({ id: "t2", title: "收起轨道" });
    await db.tracks.bulkAdd([t1, t2]);
    const s1 = stepFactory({ id: "s1", seq: 0, trackId: "t1", tags: [] });
    const s2 = stepFactory({ id: "s2", seq: 0, trackId: "t2", tags: [] });
    const stepsByTrack = new Map<string, TrackStep[]>([
      ["t1", [s1]],
      ["t2", [s2]],
    ]);
    const { host, root } = await renderBucketSection({
      tracks: [t1, t2],
      stepsByTrack,
      sessionTrackIds: [],
      expandedTrackIds: new Set(["t1"]),
      onToggleExpand: vi.fn(),
      onError: vi.fn(),
    });
    // 展开的行应渲染输入框，新步骤内容
    const inputs = host.querySelectorAll('input[aria-label="新步骤内容"]');
    expect(inputs.length).toBe(1);
    // 收起的行不应有输入框
    expect(host.querySelectorAll('[data-testid="track-bucket-row"]').length).toBe(2);
    await unmount(root);
    mounted = null;
  });

  it("项目 chip：有 project goal 的轨道行出现项目名", async () => {
    const t1 = trackFactory({ id: "t1", title: "项目轨道" });
    const s1 = stepFactory({ id: "s1", seq: 0, trackId: "t1", tags: [] });
    const stepsByTrack = new Map<string, TrackStep[]>([["t1", [s1]]]);
    await db.goals.add({
      id: "g1",
      title: "项目 Alpha",
      kind: "project",
      status: "active",
      members: [{ kind: "track", id: "t1" }],
      prerequisites: [],
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    } as unknown as Goal);
    const { host, root } = await renderBucketSection({
      tracks: [t1],
      stepsByTrack,
      sessionTrackIds: [],
      expandedTrackIds: new Set(),
      onToggleExpand: vi.fn(),
      onError: vi.fn(),
    });
    // need flush for goals liveQuery
    for (let i = 0; i < 5; i += 1) await flush();
    const chip = host.querySelector('[data-testid="track-project-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("项目 Alpha");
    await unmount(root);
    mounted = null;
  });

  it("HandTrackRows 渲染 inHand 行且空 tracks 时返回 null", async () => {
    // 空时返回 null => 不渲染任何行，section 不存在，手头区空
    const empty = await renderHandRows({
      tracks: [],
      stepsByTrack: new Map(),
      expandedTrackIds: new Set(),
      onToggleExpand: vi.fn(),
      onError: vi.fn(),
    });
    expect(empty.host.querySelector('[data-testid="track-bucket-row"]')).toBeNull();
    // 空时 HandTrackRows 整体应不产生容器（返回 null 导致 host 仅含路由空壳）
    // 通过检查是否没有任何 track 行来判定
    expect(empty.host.textContent).not.toContain("轨道");
    await unmount(empty.root);
    mounted = null;

    const t1 = trackFactory({ id: "t1", title: "手头轨道" });
    await db.tracks.add(t1);
    const s1 = stepFactory({ id: "s1", seq: 0, trackId: "t1", tags: [], content: "手头内容" });
    const stepsByTrack = new Map<string, TrackStep[]>([["t1", [s1]]]);
    const filled = await renderHandRows({
      tracks: [t1],
      stepsByTrack,
      expandedTrackIds: new Set(),
      onToggleExpand: vi.fn(),
      onError: vi.fn(),
    });
    expect(filled.host.querySelector('[data-testid="track-bucket-row"]')).not.toBeNull();
    expect(filled.host.textContent).toContain("手头轨道");
    // inHand 时按钮文案为 移出手头（展开后可见，需展开）
    // 先验证收起态下仍有行，再展开检查按钮
    const expanded = await renderHandRows({
      tracks: [t1],
      stepsByTrack,
      expandedTrackIds: new Set(["t1"]),
      onToggleExpand: vi.fn(),
      onError: vi.fn(),
    });
    for (let i = 0; i < 5; i += 1) await flush();
    expect(expanded.host.querySelector('button[aria-label="移出手头"]')).not.toBeNull();
    await unmount(expanded.root);
    mounted = null;
    await unmount(filled.root);
    mounted = null;
  });

  it("stepsByTrack 缺 key 时照常渲染无步形态，不抛错", async () => {
    const t1 = trackFactory({ id: "t1", title: "有步轨道" });
    const t2 = trackFactory({ id: "t2", title: "缺步轨道" });
    const s1 = stepFactory({ id: "s1", seq: 0, trackId: "t1", tags: [], content: "有步内容" });
    const stepsByTrack = new Map<string, TrackStep[]>([["t1", [s1]]]);
    const { host, root } = await renderBucketSection({
      tracks: [t1, t2],
      stepsByTrack,
      sessionTrackIds: [],
      expandedTrackIds: new Set(),
      onToggleExpand: vi.fn(),
      onError: vi.fn(),
    });
    // 两行都应渲染，不因缺 key 抛错
    expect(host.querySelectorAll('[data-testid="track-bucket-row"]').length).toBe(2);
    expect(host.textContent).toContain("有步轨道");
    expect(host.textContent).toContain("缺步轨道");
    // 缺步轨道的最新动静应显示尚无步骤
    const rows = host.querySelectorAll('[data-testid="track-bucket-latest"]');
    expect(rows.length).toBe(2);
    await unmount(root);
    mounted = null;
  });

  it("projectIndex 空时不渲染项目 chip（显式断言不存在）", async () => {
    const t1 = trackFactory({ id: "t1", title: "无项目轨道" });
    const s1 = stepFactory({ id: "s1", seq: 0, trackId: "t1", tags: [] });
    const stepsByTrack = new Map<string, TrackStep[]>([["t1", [s1]]]);
    // db.goals 为空，projectIndex 必然空
    const { host, root } = await renderBucketSection({
      tracks: [t1],
      stepsByTrack,
      sessionTrackIds: [],
      expandedTrackIds: new Set(),
      onToggleExpand: vi.fn(),
      onError: vi.fn(),
    });
    for (let i = 0; i < 5; i += 1) await flush();
    expect(host.querySelector('[data-testid="track-project-chip"]')).toBeNull();
    expect(host.textContent).toContain("无项目轨道");
    await unmount(root);
    mounted = null;
  });
});
