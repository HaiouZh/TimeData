// @vitest-environment jsdom
import { act, createElement } from "react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { addTrack, addTrackStep, listTracks, updateTrack } from "../../lib/tracks.js";
import { db } from "../../test/dbReset.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import TracksListPage from "./TracksListPage.js";

const now = new Date("2026-06-21T03:00:00.000Z");
let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

function DetailProbe() {
  const { id } = useParams<{ id: string }>();
  return createElement("div", null, `DETAIL:${id}`);
}

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
  mounted = await renderDom(
    createElement(MemoryRouter, { initialEntries: ["/tracks"] }, createElement(TracksListPage)),
  );
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
  it("lists active tracks with board signal facets, latest steps, and links to detail", async () => {
    await addTrack({ title: "全马破三", now });
    const [track] = await listTracks();
    await updateTrack(track.id, { summary: "base 到 build", now });
    await addTrackStep({
      trackId: track.id,
      source: "agent",
      content: "base 期",
      startedAt: "2026-06-21T01:00:00.000Z",
      endedAt: null,
      tags: ["待我处理"],
      seq: 0,
      now,
    });
    const host = await renderList();
    await waitForText(host, "全马破三");
    await waitForText(host, "看板信号");
    await waitForText(host, "base 期");
    expect(host.textContent).toContain("待我处理 1");
    expect(host.textContent).toContain("agent在做 0");
    expect(host.textContent).toContain("#待我处理");
    expect(host.textContent).toContain("base 到 build");
    expect(host.textContent).toContain("当前:第1步");
    expect(host.textContent).not.toContain("按该谁了分组");
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

  it("navigates into the new track detail after creating (TK-15)", async () => {
    mounted = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/tracks"] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: "/tracks", element: createElement(TracksListPage) }),
          createElement(Route, { path: "/tracks/:id", element: createElement(DetailProbe) }),
        ),
      ),
    );
    const host = mounted.host;
    await flush();
    const input = host.querySelector('input[aria-label="新建轨道标题"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setValue?.call(input, "落点轨道");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (host.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flush();
    const track = (await listTracks()).find((t) => t.title === "落点轨道");
    expect(track).toBeDefined();
    await waitForText(host, `DETAIL:${track?.id}`);
  });

  it("shows an empty hint when there are no active tracks", async () => {
    const host = await renderList();
    expect(host.textContent).toContain("还没有进行中的轨道");
  });

  it("filters active tracks by selected board signal tags with OR semantics", async () => {
    await seedTrackWithStep("待我确认的轨道", ["待我处理"]);
    await seedTrackWithStep("agent 执行中", ["agent在做"]);
    await seedTrackWithStep("普通推进", ["复盘"]);

    const host = await renderList();
    await waitForText(host, "待我确认的轨道");
    expect(trackCardsText(host)).toContain("agent 执行中");
    expect(trackCardsText(host)).toContain("普通推进");
    await waitForText(host, "待我处理 1");
    await waitForText(host, "agent在做 1");
    await click(facetButton(host, "待我处理 1"));
    await waitForCondition(
      () =>
        facetButton(host, "待我处理 1").getAttribute("aria-pressed") === "true" &&
        trackCardsText(host).includes("待我确认的轨道") &&
        !trackCardsText(host).includes("agent 执行中") &&
        !trackCardsText(host).includes("普通推进"),
      "待我处理 facet filtering",
    );
    await click(facetButton(host, "agent在做 1"));
    await waitForCondition(
      () =>
        facetButton(host, "agent在做 1").getAttribute("aria-pressed") === "true" &&
        trackCardsText(host).includes("待我确认的轨道") &&
        trackCardsText(host).includes("agent 执行中") &&
        !trackCardsText(host).includes("普通推进"),
      "OR board signal filtering",
    );
  });

  it("shows an empty active hint when selected board signal tags match nothing", async () => {
    await seedTrackWithStep("进行中无行动标签", []);
    const host = await renderList();
    await waitForText(host, "进行中无行动标签");
    await click(facetButton(host, "待我处理 0"));
    await waitForText(host, "没有命中这些看板信号的进行中轨道");
    expect(trackCardsText(host)).not.toContain("进行中无行动标签");
  });

  it("keeps a board signal after later ordinary tag or untagged steps", async () => {
    await addTrack({ title: "agent 执行中", now });
    const [track] = await listTracks();
    await addTrackStep({
      trackId: track.id,
      source: "user",
      content: "派给 agent",
      startedAt: "2026-06-21T01:00:00.000Z",
      endedAt: null,
      tags: ["agent在做"],
      seq: 0,
      now,
    });
    await addTrackStep({
      trackId: track.id,
      source: "user",
      content: "补充一个决策点",
      startedAt: "2026-06-21T02:00:00.000Z",
      endedAt: "2026-06-21T02:00:00.000Z",
      tags: ["决策"],
      seq: 1,
      now,
    });
    await addTrackStep({
      trackId: track.id,
      source: "user",
      content: "无标签补充",
      startedAt: "2026-06-21T02:30:00.000Z",
      endedAt: "2026-06-21T02:30:00.000Z",
      tags: [],
      seq: 2,
      now,
    });
    const host = await renderList();
    await waitForText(host, "agent在做 1");
    await click(facetButton(host, "agent在做 1"));
    await waitForCondition(() => trackCardsText(host).includes("agent 执行中"), "sticky agent signal");
  });

  it("clears selected board-signal filters when the configured signal disappears", async () => {
    await setTrackActionTags(["待我处理", "agent在做"]);
    await seedTrackWithStep("需要我处理", ["待我处理"]);

    const host = await renderList();
    await waitForText(host, "待我处理 1");
    await click(facetButton(host, "待我处理 1"));
    await waitForCondition(() => trackCardsText(host).includes("需要我处理"), "filter applied");

    await act(async () => {
      await setTrackActionTags(["agent在做"]);
    });

    await waitForText(host, "agent在做 0");
    await waitForCondition(() => trackCardsText(host).includes("需要我处理"), "stale selected filter cleared");
  });

  it("writes an inline card step through the list page and refreshes board signal without navigation", async () => {
    await seedTrackWithStep("待处理轨道", ["待我处理"]);
    const host = await renderList();
    await waitForText(host, "待处理轨道");
    await click(host.querySelector('button[aria-label="写一步"]'));
    await typeTextarea(host, "交给 agent 继续");
    await clickButton(host, "#agent在做");
    await submitInlineForm(host);
    await waitForText(host, "agent在做 1");
    expect(trackCardsText(host)).toContain("待处理轨道");
  });
});
