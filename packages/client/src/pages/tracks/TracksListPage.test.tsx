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
  localStorage.clear();
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
  return [...host.querySelectorAll("li")].map((item) => item.textContent ?? "").join("\n");
}

async function typeTextarea(host: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setValue?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickButton(host: HTMLElement, text: string): Promise<void> {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}`);
  return click(button);
}

async function submitInlineForm(host: HTMLElement): Promise<void> {
  await act(async () => {
    const forms = [...host.querySelectorAll("form")];
    const inline = forms.find((form) => form.querySelector("textarea"));
    if (!(inline instanceof HTMLFormElement)) throw new Error("Missing inline form");
    inline.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function seedTrackWithStep(title: string, tags: string[]) {
  await addTrack({ title, now });
  const track = (await listTracks()).find((item) => item.title === title);
  if (!track) throw new Error(`missing seeded track ${title}`);
  await addTrackStep({
    trackId: track.id,
    source: "agent",
    content: `${title} step`,
    startedAt: "2026-06-21T01:00:00.000Z",
    endedAt: null,
    tags,
    seq: 0,
    now,
  });
  return track;
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
    await waitForText(host, "交棒筛选");
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
    await waitForText(host, "等我 1");
    await waitForText(host, "agent在做 1");
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

  it("keeps a blocked track in the blocked facet after a later untagged step", async () => {
    await addTrack({ title: "卡住但有进展", now });
    const [track] = await listTracks();
    await addTrackStep({
      trackId: track.id,
      source: "agent",
      content: "缺权限",
      startedAt: "2026-06-21T01:00:00.000Z",
      endedAt: null,
      tags: ["卡住"],
      seq: 0,
      now,
    });
    await addTrackStep({
      trackId: track.id,
      source: "user",
      content: "补了一句无标签进展",
      startedAt: "2026-06-21T02:00:00.000Z",
      endedAt: "2026-06-21T02:00:00.000Z",
      tags: [],
      seq: 1,
      now,
    });
    const host = await renderList();
    await waitForText(host, "卡住 1");
    await click(facetButton(host, "卡住 1"));
    await waitForCondition(() => trackCardsText(host).includes("卡住但有进展"), "sticky blocked filter");
  });

  it("floats mine-side tracks in flat mode", async () => {
    await seedTrackWithStep("agent 手上", ["agent在做"]);
    await seedTrackWithStep("该我确认", ["等我"]);
    const host = await renderList();
    await waitForText(host, "该我确认");
    const cards = [...host.querySelectorAll('a[href^="/tracks/"]')].map((item) => item.textContent ?? "");
    expect(cards[0]).toContain("该我确认");
  });

  it("switches to grouped handoff lanes, persists the local view choice, and ignores hidden facet filters", async () => {
    await seedTrackWithStep("该我确认", ["等我"]);
    await seedTrackWithStep("agent 手上", ["agent在做"]);
    const host = await renderList();
    await waitForText(host, "等我 1");
    await click(facetButton(host, "等我 1"));
    await waitForCondition(() => !trackCardsText(host).includes("agent 手上"), "flat filter applied");

    const groupedButton = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("按该谁了分组"));
    await click(groupedButton);
    await waitForText(host, "该我了");
    expect(localStorage.getItem("timedata_tracks_board_view")).toBe("grouped");
    expect(host.textContent).not.toContain("交棒筛选");
    expect(trackCardsText(host)).toContain("agent 手上");
    // 设计稿 §4.2：该我了泳道默认展开，非我侧泳道默认折叠（点开才看别人手上的）。
    const lane = (label: string): HTMLDetailsElement => {
      const found = [...host.querySelectorAll("details")].find((item) =>
        item.querySelector("summary")?.textContent?.includes(label),
      );
      if (!(found instanceof HTMLDetailsElement)) throw new Error(`Missing lane: ${label}`);
      return found;
    };
    expect(lane("该我了").open).toBe(true);
    expect(lane("等 agent").open).toBe(false);
  });

  it("writes an inline card step through the list page and refreshes handoff placement without navigation", async () => {
    await seedTrackWithStep("待处理轨道", ["等我"]);
    const host = await renderList();
    await waitForText(host, "待处理轨道");
    await click(host.querySelector('button[aria-label="写一步"]'));
    await typeTextarea(host, "交给 agent 继续");
    await clickButton(host, "#agent在做");
    await submitInlineForm(host);
    await waitForText(host, "agent在做 1");
    expect(host.textContent).toContain("待处理轨道");
  });
});
