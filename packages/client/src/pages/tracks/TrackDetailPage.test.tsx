// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/index.js";
import { addTrack, addTrackStep, listTracks } from "../../lib/tracks.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import TrackDetailPage from "./TrackDetailPage.js";

const now = new Date("2026-06-21T03:00:00.000Z");
let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

beforeEach(async () => {
  await db.open();
  await db.tracks.clear();
  await db.trackSteps.clear();
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
});
