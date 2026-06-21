// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/index.js";
import { addTrack, addTrackStep, listTracks, updateTrack } from "../../lib/tracks.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import TracksListPage from "./TracksListPage.js";

vi.mock("../../contexts/SyncContext.tsx", () => ({ useSyncContext: () => ({ syncAfterWrite: () => {} }) }));

const now = new Date("2026-06-21T03:00:00.000Z");
let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

beforeEach(async () => {
  await db.open();
  await db.tracks.clear();
  await db.trackSteps.clear();
  await db.settings.clear();
  await db.syncLog.clear();
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

async function waitForCondition(predicate: () => boolean, label: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (predicate()) return;
    await flush();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function renderList() {
  mounted = await renderDom(createElement(MemoryRouter, { initialEntries: ["/tracks"] }, createElement(TracksListPage)));
  await flush();
  return mounted.host;
}

function facetButton(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing facet button: ${label}`);
  return button;
}

function trackCardsText(host: HTMLElement): string {
  return [...host.querySelectorAll('a[href^="/tracks/"]')].map((item) => item.textContent ?? "").join("\n");
}

describe("TracksListPage", () => {
  it("lists active tracks with status facets, latest steps, and links to detail", async () => {
    await addTrack({ title: "全马破三", now });
    const [track] = await listTracks();
    await updateTrack(track.id, { summary: "base 到 build", now });
    await addTrackStep({
      trackId: track.id,
      source: "agent",
      content: "base 期",
      startedAt: "2026-06-21T01:00:00.000Z",
      endedAt: null,
      tags: ["等我"],
      seq: 0,
      now,
    });
    const host = await renderList();
    await waitForText(host, "全马破三");
    await waitForText(host, "状态标签");
    await waitForText(host, "base 期");
    expect(host.textContent).toContain("等我 1");
    expect(host.textContent).toContain("agent在做 0");
    expect(host.textContent).toContain("base 期");
    expect(host.textContent).toContain("base 到 build");
    await waitForText(host, "当前:第1步");
    expect(host.textContent).toContain("全马破三");
    expect(host.textContent).toContain("当前:第1步");
    expect(host.querySelector(`a[href="/tracks/${track.id}"]`)).not.toBeNull();
  });

  it("tucks concluded/parked tracks into a collapsed archive section", async () => {
    await addTrack({ title: "活的", now });
    await addTrack({ title: "收束的", now });
    const concluded = (await listTracks()).find((t) => t.title === "收束的");
    if (!concluded) throw new Error("missing");
    await updateTrack(concluded.id, { status: "concluded", now });

    const host = await renderList();
    await waitForText(host, "收束的");
    const details = host.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.textContent).toContain("收束的");
  });

  it("creates a track from the composer", async () => {
    const host = await renderList();
    const input = host.querySelector("input") as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setValue?.call(input, "崭新轨道");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (host.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flush();
    expect((await listTracks()).some((t) => t.title === "崭新轨道")).toBe(true);
  });

  it("shows an empty hint when there are no active tracks", async () => {
    const host = await renderList();
    expect(host.textContent).toContain("还没有进行中的轨道");
  });

  it("filters active tracks by selected latest-step status tags with OR semantics", async () => {
    await addTrack({ title: "等确认的轨道", now });
    await addTrack({ title: "agent 执行中", now });
    await addTrack({ title: "普通推进", now });
    const tracks = await listTracks();
    const waiting = tracks.find((t) => t.title === "等确认的轨道");
    const agentDoing = tracks.find((t) => t.title === "agent 执行中");
    const normal = tracks.find((t) => t.title === "普通推进");
    if (!waiting || !agentDoing || !normal) throw new Error("missing seeded track");
    await addTrackStep({
      trackId: waiting.id,
      source: "agent",
      content: "等你拍方案",
      startedAt: "2026-06-21T01:00:00.000Z",
      endedAt: null,
      tags: ["等我"],
      seq: 0,
      now,
    });
    await addTrackStep({
      trackId: agentDoing.id,
      source: "agent",
      content: "正在执行",
      startedAt: "2026-06-21T01:00:00.000Z",
      endedAt: null,
      tags: ["agent在做"],
      seq: 0,
      now,
    });
    await addTrackStep({
      trackId: normal.id,
      source: "agent",
      content: "普通推进",
      startedAt: "2026-06-21T01:00:00.000Z",
      endedAt: null,
      tags: ["复盘"],
      seq: 0,
      now,
    });
    const host = await renderList();
    await waitForText(host, "等确认的轨道");
    expect(host.textContent).toContain("agent 执行中");
    expect(host.textContent).toContain("普通推进");
    await click(facetButton(host, "等我 1"));
    await waitForCondition(
      () =>
        facetButton(host, "等我 1").getAttribute("aria-pressed") === "true" &&
        trackCardsText(host).includes("等确认的轨道") &&
        !trackCardsText(host).includes("agent 执行中") &&
        !trackCardsText(host).includes("普通推进"),
      "等我 facet filtering",
    );
    expect(trackCardsText(host)).toContain("等确认的轨道");
    expect(trackCardsText(host)).not.toContain("agent 执行中");
    expect(trackCardsText(host)).not.toContain("普通推进");
    await click(facetButton(host, "agent在做 1"));
    await waitForCondition(
      () =>
        facetButton(host, "agent在做 1").getAttribute("aria-pressed") === "true" &&
        trackCardsText(host).includes("等确认的轨道") &&
        trackCardsText(host).includes("agent 执行中") &&
        !trackCardsText(host).includes("普通推进"),
      "OR status facet filtering",
    );
    expect(trackCardsText(host)).toContain("等确认的轨道");
    expect(trackCardsText(host)).toContain("agent 执行中");
    expect(trackCardsText(host)).not.toContain("普通推进");
  });

  it("shows an empty active hint when selected status tags match nothing", async () => {
    await addTrack({ title: "进行中无行动标签", now });
    const [track] = await listTracks();
    await addTrackStep({
      trackId: track.id,
      source: "agent",
      content: "推进中",
      startedAt: "2026-06-21T01:00:00.000Z",
      endedAt: null,
      tags: [],
      seq: 0,
      now,
    });
    const host = await renderList();
    await waitForText(host, "进行中无行动标签");
    await click(facetButton(host, "等我 0"));
    await waitForText(host, "没有命中这些状态标签的进行中轨道");
    expect(host.textContent).not.toContain("进行中无行动标签");
  });

  it("drops selected temporary tags after they disappear from latest-step facets", async () => {
    await addTrack({ title: "临时标签轨道", now });
    const [track] = await listTracks();
    await addTrackStep({
      trackId: track.id,
      source: "agent",
      content: "先复盘",
      startedAt: "2026-06-21T01:00:00.000Z",
      endedAt: null,
      tags: ["复盘"],
      seq: 0,
      now,
    });
    const host = await renderList();
    await waitForText(host, "复盘 1");
    await click(facetButton(host, "复盘 1"));
    await waitForCondition(() => facetButton(host, "复盘 1").getAttribute("aria-pressed") === "true", "复盘 selected");

    await addTrackStep({
      trackId: track.id,
      source: "agent",
      content: "改由 agent 接手",
      startedAt: "2026-06-21T02:00:00.000Z",
      endedAt: null,
      tags: ["agent在做"],
      seq: 1,
      now,
    });

    await waitForCondition(
      () => !host.textContent?.includes("复盘 1") && trackCardsText(host).includes("临时标签轨道"),
      "stale temporary facet cleanup",
    );
    expect(host.textContent).toContain("agent在做 1");
    expect(host.textContent).not.toContain("没有命中这些状态标签的进行中轨道");
  });
});
