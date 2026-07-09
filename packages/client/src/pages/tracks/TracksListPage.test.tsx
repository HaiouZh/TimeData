// @vitest-environment jsdom
import { act, createElement } from "react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

async function renderList() {
  mounted = await renderDom(
    createElement(MemoryRouter, { initialEntries: ["/tracks"] }, createElement(TracksListPage)),
  );
  await flush();
  return mounted.host;
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

// TracksBoard 的分组/停滞判定按真实 Date.now() 计时（非该文件其它用例的固定 `now`），
// 造数须用相对真实当下的时间戳，8 天前才会真正落进「停滞」组。
async function seedDispatchScenario(): Promise<void> {
  const nowMs = Date.now();
  const recentIso = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const staleIso = new Date(nowMs - 8 * 24 * 60 * 60 * 1000).toISOString();

  await addTrack({ title: "等我处理的轨道" });
  const awaiting = (await listTracks()).find((item) => item.title === "等我处理的轨道");
  if (!awaiting) throw new Error("missing awaiting track");
  await addTrackStep({
    trackId: awaiting.id,
    source: "agent",
    content: "等我确认",
    startedAt: recentIso,
    endedAt: recentIso,
    tags: ["待我处理"],
    seq: 0,
  });

  await addTrack({ title: "agent 在跑的轨道" });
  const running = (await listTracks()).find((item) => item.title === "agent 在跑的轨道");
  if (!running) throw new Error("missing running track");
  await addTrackStep({
    trackId: running.id,
    source: "agent",
    content: "agent 执行中",
    startedAt: recentIso,
    endedAt: null,
    tags: ["agent在做"],
    seq: 0,
  });

  await addTrack({ title: "停滞的轨道" });
  const stalled = (await listTracks()).find((item) => item.title === "停滞的轨道");
  if (!stalled) throw new Error("missing stalled track");
  await addTrackStep({
    trackId: stalled.id,
    source: "user",
    content: "很久没动静",
    startedAt: staleIso,
    endedAt: staleIso,
    tags: [],
    seq: 0,
  });
}

describe("TracksListPage", () => {
  it("lists active tracks with latest steps and links to detail", async () => {
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
    await waitForText(host, "base 期");
    expect(host.textContent).toContain("#待我处理");
    expect(host.textContent).toContain("base 到 build");
    expect(host.querySelector('[data-testid="track-current-frame"]')?.textContent).toContain("base 期");
    expect(host.querySelector(`a[href="/tracks/${track.id}"]`)).not.toBeNull();
  });

  it("统计带显示 等我接/agent在跑/停滞 计数", async () => {
    await seedDispatchScenario();
    const host = await renderList();
    await waitForText(host, "等我处理的轨道");
    const stats = host.querySelector('[data-testid="dispatch-stats"]');
    expect(stats?.textContent).toContain("等我接 1");
    expect(stats?.textContent).toContain("agent 在跑 1");
    expect(stats?.textContent).toContain("停滞 1");
  });

  it("卡片按分组落位：等我接组在最上，停滞组沉底", async () => {
    await seedDispatchScenario();
    const host = await renderList();
    await waitForText(host, "等我处理的轨道");
    const groups = [...host.querySelectorAll('[data-testid^="dispatch-group-"]')].map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(groups).toEqual(["dispatch-group-awaiting-me", "dispatch-group-agent-running", "dispatch-group-stalled"]);

    // 视觉分层：等我接=警示色、agent 在跑=紫系，组头与卡片信号徽章同语义。
    const awaitingGroup = host.querySelector('[data-testid="dispatch-group-awaiting-me"]');
    expect(awaitingGroup?.querySelector("h2")?.className).toContain("text-warn");
    expect(awaitingGroup?.querySelector('[data-testid="track-signal-badge"]')?.className).toContain("text-warn");
    const agentGroup = host.querySelector('[data-testid="dispatch-group-agent-running"]');
    expect(agentGroup?.querySelector("h2")?.className).toContain("text-data-purple");
    expect(agentGroup?.querySelector('[data-testid="track-signal-badge"]')?.className).toContain("text-data-purple");
    const stalledGroup = host.querySelector('[data-testid="dispatch-group-stalled"]');
    expect(stalledGroup?.querySelector("h2")?.className).toContain("text-ink-3");
  });

  it("看板信号 facet 面板已退役", async () => {
    await seedDispatchScenario();
    const host = await renderList();
    await waitForText(host, "等我处理的轨道");
    expect(host.textContent).not.toContain("看板信号");
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

  it("窄屏 /tracks 渲染调度台整页而非宽屏空态（jsdom 无 matchMedia，useIsWideScreen 天然 false）", async () => {
    const host = await renderList();
    expect(host.querySelector('[data-testid="dispatch-stats"]')).not.toBeNull();
    expect(host.textContent).not.toContain("从左侧选一条轨道查看");
  });

  it("writes an inline card step through the list page and refreshes its board signal without navigation", async () => {
    await seedTrackWithStep("待处理轨道", ["待我处理"]);
    const host = await renderList();
    await waitForText(host, "待处理轨道");
    await click(host.querySelector('button[aria-label="写一步"]'));
    await typeTextarea(host, "交给 agent 继续");
    await clickButton(host, "#agent在做");
    await submitInlineForm(host);
    await waitForText(host, "#agent在做");
    expect(trackCardsText(host)).toContain("待处理轨道");
  });
});
