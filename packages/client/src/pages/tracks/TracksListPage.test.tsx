// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/index.js";
import { addTrack, addTrackStep, listTracks, updateTrack } from "../../lib/tracks.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import TracksListPage from "./TracksListPage.js";

vi.mock("../../contexts/SyncContext.tsx", () => ({ useSyncContext: () => ({ syncAfterWrite: () => {} }) }));

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

async function renderList() {
  mounted = await renderDom(createElement(MemoryRouter, { initialEntries: ["/tracks"] }, createElement(TracksListPage)));
  await flush();
  return mounted.host;
}

describe("TracksListPage", () => {
  it("lists active tracks with a progress summary and links to detail", async () => {
    await addTrack({ title: "全马破三", now });
    const [track] = await listTracks();
    await addTrackStep({
      trackId: track.id,
      source: "agent",
      content: "base 期",
      startedAt: "2026-06-21T01:00:00.000Z",
      endedAt: null,
      seq: 0,
      now,
    });
    const host = await renderList();
    await waitForText(host, "全马破三");
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
});
