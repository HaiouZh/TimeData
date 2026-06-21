// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/index.js";
import { setTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
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

  it("surfaces a current step in the 轮到我 inbox when its tag hits a seed actionTag", async () => {
    await addTrack({ title: "等确认的轨道", now });
    const [track] = await listTracks();
    await addTrackStep({
      trackId: track.id,
      source: "agent",
      content: "等你拍方案",
      startedAt: "2026-06-21T01:00:00.000Z",
      endedAt: null,
      tags: ["等我"],
      seq: 0,
      now,
    });
    const host = await renderList();
    await waitForText(host, "等确认的轨道");
    // 默认未配置 → 种子含「等我」;切到「轮到我」
    await click(host.querySelector('[role="radio"][aria-checked="false"]'));
    await waitForText(host, "等你拍方案");
    expect(host.querySelector(`a[href="/tracks/${track.id}"]`)).not.toBeNull();
  });

  it("guides to settings in the 轮到我 inbox when actionTags is explicitly empty", async () => {
    await setTrackActionTags([]);
    await addTrack({ title: "随便一条", now });
    const host = await renderList();
    await waitForText(host, "随便一条");
    await click(host.querySelector('[role="radio"][aria-checked="false"]'));
    await waitForText(host, "还没有配置行动标签");
    expect(host.querySelector('a[href="/settings/tracks"]')).not.toBeNull();
  });

  it("shows an empty inbox hint when configured but nothing is waiting", async () => {
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
    await click(host.querySelector('[role="radio"][aria-checked="false"]'));
    await waitForText(host, "暂无轮到你的步骤");
  });
});
