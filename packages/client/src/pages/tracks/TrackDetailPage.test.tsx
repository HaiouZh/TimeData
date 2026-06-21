// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/index.js";
import { addTrack, addTrackStep, getTrack, listTracks, listTrackSteps } from "../../lib/tracks.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import TrackDetailPage from "./TrackDetailPage.js";

const syncAfterWriteMock = vi.hoisted(() => vi.fn());
vi.mock("../../contexts/SyncContext.tsx", () => ({ useSyncContext: () => ({ syncAfterWrite: syncAfterWriteMock }) }));

const now = new Date("2026-06-21T03:00:00.000Z");
let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

beforeEach(async () => {
  await db.open();
  await db.tracks.clear();
  await db.trackSteps.clear();
  await db.settings.clear();
  await db.syncLog.clear();
  syncAfterWriteMock.mockClear();
});
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitForText(host: HTMLElement, text: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (host.textContent?.includes(text)) return;
    await flush();
  }
  throw new Error(`Timed out waiting for ${text}`);
}

async function renderDetail(id: string) {
  mounted = await renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: [`/tracks/${id}`] },
      createElement(Routes, null, createElement(Route, { path: "/tracks/:id", element: createElement(TrackDetailPage) })),
    ),
  );
  await flush();
  return mounted.host;
}

async function seedTrack() {
  await addTrack({ title: "全马破三", summary: "base→build→peak", now });
  const [track] = await listTracks();
  await addTrackStep({
    trackId: track.id,
    source: "user",
    content: "决定开练",
    startedAt: "2026-06-21T00:00:00.000Z",
    endedAt: "2026-06-21T01:00:00.000Z",
    seq: 0,
    now,
  });
  await addTrackStep({
    trackId: track.id,
    source: "agent",
    sourceLabel: "coach",
    content: "base 期第一周",
    startedAt: "2026-06-21T01:00:00.000Z",
    endedAt: null,
    tags: ["base期"],
    seq: 1,
    now,
  });
  return track;
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === text || b.getAttribute("aria-label") === text) ?? null;
}

async function typeInput(host: HTMLElement, label: string, value: string): Promise<void> {
  await act(async () => {
    const input = host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    )?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function typeStep(host: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    const textarea = host.querySelector('textarea[aria-label="步骤内容"]') as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setValue?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(host: HTMLElement, text: string): Promise<void> {
  await act(async () => {
    buttonByText(host, text)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

async function submitComposer(host: HTMLElement): Promise<void> {
  await act(async () => {
    (host.querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await flush();
}

describe("TrackDetailPage", () => {
  it("renders title, summary and a reverse timeline with the current step on top", async () => {
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "全马破三");
    await waitForText(host, "base 期第一周");

    expect(host.textContent).toContain("全马破三");
    expect(host.textContent).toContain("base→build→peak");

    const items = [...host.querySelectorAll("li")];
    expect(items.length).toBe(2);
    expect(items[0]?.textContent).toContain("base 期第一周");
    expect(items[0]?.getAttribute("data-current")).toBe("true");
    expect(items[1]?.textContent).toContain("决定开练");
  });

  it("shows an empty hint when the track has no steps", async () => {
    await addTrack({ title: "空轨道", now });
    const [track] = await listTracks();
    const host = await renderDetail(track.id);
    await waitForText(host, "尚无步骤");
    expect(host.textContent).toContain("尚无步骤");
  });

  it("renders a missing state for unknown id", async () => {
    const host = await renderDetail("missing");
    await waitForText(host, "轨道不存在");
    expect(host.textContent).toContain("轨道不存在");
  });

  it("开口执行:加一步闭合上一开口步、成当前步并触发 sync", async () => {
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "base 期第一周");

    await typeStep(host, "我下场盯一段");
    await submitComposer(host);

    const steps = await listTrackSteps(track.id);
    const prevOpen = steps.find((s) => s.content === "base 期第一周");
    const added = steps.find((s) => s.content === "我下场盯一段");
    expect(prevOpen?.endedAt).not.toBeNull();
    expect(added).toMatchObject({ source: "user", endedAt: null });
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
  });

  it("即时点:选预设 tag 记一笔,不闭合当前步", async () => {
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "base 期第一周");

    await clickButton(host, "记一个点");
    await clickButton(host, "#批注");
    await typeStep(host, "这里要回看证据");
    await submitComposer(host);

    const steps = await listTrackSteps(track.id);
    const current = steps.find((s) => s.content === "base 期第一周");
    const note = steps.find((s) => s.content === "这里要回看证据");
    expect(current?.endedAt).toBeNull();
    expect(note).toMatchObject({ source: "user", tags: ["批注"] });
    expect(note?.startedAt).toBe(note?.endedAt);
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
  });

  it("updates title and summary through the existing updateTrack path", async () => {
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "全马破三");

    await clickButton(host, "编辑轨道");
    await typeInput(host, "轨道标题", "标签体系退役");
    await typeInput(host, "轨道摘要", "沉淀为 agent 轨道");
    await clickButton(host, "保存轨道");

    const updated = await getTrack(track.id);
    expect(updated).toMatchObject({ title: "标签体系退役", summary: "沉淀为 agent 轨道" });
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
  });

  it("clears summary by saving an empty summary field", async () => {
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "base→build→peak");

    await clickButton(host, "编辑轨道");
    await typeInput(host, "轨道摘要", "   ");
    await clickButton(host, "保存轨道");

    const updated = await getTrack(track.id);
    expect(updated?.summary).toBeUndefined();
  });

  it("passes configured status tags into the step composer", async () => {
    await db.settings.put({
      key: "track.actionTags.v1",
      value: JSON.stringify(["等我", "agent在做"]),
      updatedAt: now.toISOString(),
    });
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "#agent在做");
    expect(host.textContent).toContain("#等我");
    expect(host.textContent).toContain("#agent在做");
  });

  it("闭合当前步按钮收束开口步", async () => {
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "base 期第一周");

    await clickButton(host, "闭合当前步");

    const steps = await listTrackSteps(track.id);
    expect(steps.find((s) => s.content === "base 期第一周")?.endedAt).not.toBeNull();
    expect(steps.every((s) => s.endedAt !== null)).toBe(true);
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
  });

  it("状态控件收束轨道并闭合开口步", async () => {
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "base 期第一周");

    await clickButton(host, "收束");

    const updated = await getTrack(track.id);
    const steps = await listTrackSteps(track.id);
    expect(updated?.status).toBe("concluded");
    expect(steps.find((s) => s.content === "base 期第一周")?.endedAt).not.toBeNull();
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
  });

  it("非 active 轨道隐藏加步与闭合,状态控件仍在", async () => {
    await addTrack({ title: "已收束轨道", status: "concluded", now });
    const [track] = await listTracks("concluded");
    const host = await renderDetail(track.id);
    await waitForText(host, "已收束轨道");

    expect(host.querySelector('textarea[aria-label="步骤内容"]')).toBeNull();
    expect(buttonByText(host, "闭合当前步")).toBeNull();
    expect(buttonByText(host, "推进中")).not.toBeNull();
  });
});
