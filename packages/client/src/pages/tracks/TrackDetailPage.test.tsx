// @vitest-environment jsdom
import { act, createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { addTrack, addTrackStep, getTrack, listTrackSteps, listTracks } from "../../lib/tracks.js";
import { db } from "../../test/dbReset.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import TrackDetailPage from "./TrackDetailPage.js";

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

// 等到顶部当前帧卡的内容包含指定文本——waitForText 会被历史区/其他节点的同名文本抢跑，卡片断言必须盯卡片本体。
async function waitForCardText(host: HTMLElement, text: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const card = host.querySelector('[data-testid="current-frame-card"]');
    if (card?.textContent?.includes(text)) return;
    await flush();
  }
  throw new Error(`Timed out waiting for current-frame-card text ${text}`);
}

async function renderDetail(id: string) {
  mounted = await renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: [`/tracks/${id}`] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: "/tracks/:id", element: createElement(TrackDetailPage) }),
      ),
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
  return (
    [...host.querySelectorAll("button")].find((b) => b.textContent === text || b.getAttribute("aria-label") === text) ??
    null
  );
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

async function openHistory(host: HTMLElement): Promise<void> {
  await act(async () => {
    const details = host.querySelector("details");
    if (details) {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    }
  });
  await flush();
}

describe("TrackDetailPage", () => {
  it("renders title, summary, and puts the current step in the top current-frame card", async () => {
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "全马破三");
    await waitForText(host, "base 期第一周");

    expect(host.textContent).toContain("全马破三");
    expect(host.textContent).toContain("base→build→peak");

    const card = host.querySelector('[data-testid="current-frame-card"]');
    expect(card?.textContent).toContain("base 期第一周");

    await openHistory(host);
    const items = [...host.querySelectorAll("li")];
    expect(items.length).toBe(1);
    expect(items[0]?.textContent).toContain("决定开练");
  });

  it("当前帧卡置顶显示最新步全文，不显示历时", async () => {
    const track = await seedTrack();
    await addTrackStep({
      trackId: track.id,
      source: "user",
      content: "初具雏形，先跑个 15k 看反馈",
      startedAt: "2026-06-21T02:00:00.000Z",
      endedAt: null,
      seq: 2,
      now,
    });
    const host = await renderDetail(track.id);
    await waitForText(host, "初具雏形");

    const card = host.querySelector('[data-testid="current-frame-card"]');
    expect(card?.textContent).toContain("初具雏形");
    expect(card?.textContent).not.toContain("已历时");
    expect(card?.textContent).not.toContain("历时");
  });

  it("历史步默认折叠且计数不含当前帧，展开后可见旧步", async () => {
    const track = await seedTrack();
    await addTrackStep({
      trackId: track.id,
      source: "user",
      content: "初具雏形，先跑个 15k 看反馈",
      startedAt: "2026-06-21T02:00:00.000Z",
      endedAt: null,
      seq: 2,
      now,
    });
    const host = await renderDetail(track.id);
    await waitForText(host, "初具雏形");

    const details = host.querySelector("details");
    expect(details?.open).toBe(false);
    expect(host.textContent).toContain("历史");
    expect(details?.textContent).toContain("2");

    await openHistory(host);
    expect(host.textContent).toContain("决定开练");
  });

  it("hash 锚点命中历史步时历史区默认展开", async () => {
    const track = await seedTrack();
    const steps = await listTrackSteps(track.id);
    const oldStep = steps.find((s) => s.content === "决定开练");
    mounted = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: [`/tracks/${track.id}#step-${oldStep?.id}`] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: "/tracks/:id", element: createElement(TrackDetailPage) }),
        ),
      ),
    );
    await flush();
    const host = mounted.host;
    await waitForText(host, "base 期第一周");

    expect(host.querySelector("details")?.open).toBe(true);
  });

  it("当前帧卡可就地编辑（user 步）", async () => {
    const track = await seedTrack();
    await addTrackStep({
      trackId: track.id,
      source: "user",
      content: "初具雏形，先跑个 15k 看反馈",
      startedAt: "2026-06-21T02:00:00.000Z",
      endedAt: null,
      seq: 2,
      now,
    });
    const host = await renderDetail(track.id);
    await waitForText(host, "初具雏形");

    const card = host.querySelector('[data-testid="current-frame-card"]');
    await act(async () => {
      card
        ?.querySelector('button[aria-label="编辑步骤"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await typeInput(host, "编辑步骤内容", "初具雏形，跑量已回稳");
    await clickButton(host, "保存");

    await waitForText(host, "初具雏形，跑量已回稳");
    const updatedCard = host.querySelector('[data-testid="current-frame-card"]');
    expect(updatedCard?.textContent).toContain("初具雏形，跑量已回稳");
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

  it("开口执行:加一步闭合全部开口步、成当前步并触发 sync", async () => {
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

    // 端到端：写入后新步立刻成为顶部当前帧卡的内容
    await waitForCardText(host, "我下场盯一段");
    const card = host.querySelector('[data-testid="current-frame-card"]');
    expect(card?.textContent).toContain("我下场盯一段");
    expect(card?.textContent).not.toContain("base 期第一周");
  });

  it("当前帧卡删除 user 步需两段确认，删除后前一步顶上当前帧", async () => {
    const track = await seedTrack();
    await addTrackStep({
      trackId: track.id,
      source: "user",
      content: "误记的一步待删除",
      startedAt: "2026-06-21T02:00:00.000Z",
      endedAt: null,
      seq: 2,
      now,
    });
    const host = await renderDetail(track.id);
    await waitForText(host, "误记的一步待删除");

    const card = host.querySelector('[data-testid="current-frame-card"]');
    expect(card?.textContent).toContain("误记的一步待删除");

    // 第一段：点删除只进入确认态，步骤仍在
    await act(async () => {
      card
        ?.querySelector('button[aria-label="删除步骤"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect((await listTrackSteps(track.id)).some((s) => s.content === "误记的一步待删除")).toBe(true);

    // 第二段：确认删除后，前一步（base 期第一周）顶上当前帧卡
    await act(async () => {
      host
        .querySelector('[data-testid="current-frame-card"] button[aria-label="确认删除步骤"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect((await listTrackSteps(track.id)).some((s) => s.content === "误记的一步待删除")).toBe(false);
    await waitForCardText(host, "base 期第一周");
    const nextCard = host.querySelector('[data-testid="current-frame-card"]');
    expect(nextCard?.textContent).toContain("base 期第一周");
    expect(nextCard?.textContent).not.toContain("误记的一步待删除");
  });

  it("写一步:批注类标签走 instant,不打断进行中的开口步 (TK-03)", async () => {
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "base 期第一周");

    await clickButton(host, "#批注");
    await typeStep(host, "这里要回看证据");
    await submitComposer(host);

    const steps = await listTrackSteps(track.id);
    const current = steps.find((s) => s.content === "base 期第一周");
    const note = steps.find((s) => s.content === "这里要回看证据");
    // 开口步未被截断
    expect(current?.endedAt).toBeNull();
    expect(note).toMatchObject({ source: "user", tags: ["批注"] });
    // 瞬时步:endedAt === startedAt
    expect(note?.endedAt).toBe(note?.startedAt);
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
  });

  it("编辑 user 步会更新内容并打 editedAt", async () => {
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "决定开练");
    await openHistory(host);

    const userItem = [...host.querySelectorAll("li")].find((item) => item.textContent?.includes("决定开练"));
    await act(async () => {
      userItem
        ?.querySelector('button[aria-label="编辑步骤"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await typeInput(host, "编辑步骤内容", "决定改练节奏跑");
    await clickButton(host, "保存");

    const steps = await listTrackSteps(track.id);
    const edited = steps.find((s) => s.content === "决定改练节奏跑");
    expect(edited?.editedAt).toBeDefined();
  });

  it("删除 user 步需确认，agent 步不显示入口", async () => {
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "决定开练");

    const agentCard = host.querySelector('[data-testid="current-frame-card"]');
    expect(agentCard?.textContent).toContain("base 期第一周");
    expect(agentCard?.querySelector('button[aria-label="删除步骤"]')).toBeNull();

    await openHistory(host);
    const userItem = [...host.querySelectorAll("li")].find((item) => item.textContent?.includes("决定开练"));
    await act(async () => {
      userItem
        ?.querySelector('button[aria-label="删除步骤"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flush();
    await act(async () => {
      userItem
        ?.querySelector('button[aria-label="确认删除步骤"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect((await listTrackSteps(track.id)).some((s) => s.content === "决定开练")).toBe(false);
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

  it("passes configured board signal tags into the step composer", async () => {
    await setTrackActionTags(["需我确认", "agent在做"]);
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "#agent在做");
    expect(host.textContent).toContain("#需我确认");
    expect(host.textContent).toContain("#agent在做");
    expect(host.textContent).not.toContain("#等我");
  });

  it("闭合当前步按钮闭合开口步", async () => {
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "base 期第一周");

    await clickButton(host, "闭合当前步");

    const steps = await listTrackSteps(track.id);
    expect(steps.find((s) => s.content === "base 期第一周")?.endedAt).not.toBeNull();
    expect(steps.every((s) => s.endedAt !== null)).toBe(true);
  });

  it("shows lifecycle as active or archived and archives through concluded", async () => {
    const track = await seedTrack();
    const host = await renderDetail(track.id);
    await waitForText(host, "状态 · 推进中");
    expect(buttonByText(host, "归档")).not.toBeNull();
    expect(buttonByText(host, "收束")).toBeNull();
    expect(buttonByText(host, "搁置")).toBeNull();

    await clickButton(host, "归档");

    const updated = await getTrack(track.id);
    const steps = await listTrackSteps(track.id);
    expect(updated?.status).toBe("concluded");
    expect(steps.find((s) => s.content === "base 期第一周")?.endedAt).not.toBeNull();
  });

  it("shows old parked tracks as archived and can reopen them", async () => {
    await addTrack({ title: "已搁置轨道", status: "parked", now });
    const [track] = await listTracks("parked");
    const host = await renderDetail(track.id);
    await waitForText(host, "状态 · 已归档");
    await clickButton(host, "重新推进");
    const updated = await getTrack(track.id);
    expect(updated?.status).toBe("active");
  });

  it("非 active 轨道隐藏加步与闭合,状态控件仍在", async () => {
    await addTrack({ title: "已收束轨道", status: "concluded", now });
    const [track] = await listTracks("concluded");
    const host = await renderDetail(track.id);
    await waitForText(host, "已收束轨道");
    await waitForText(host, "状态 · 已归档");

    expect(host.querySelector('textarea[aria-label="步骤内容"]')).toBeNull();
    expect(buttonByText(host, "闭合当前步")).toBeNull();
    expect(buttonByText(host, "重新推进")).not.toBeNull();
  });

  it("删除轨道需确认并跳回 /tracks", async () => {
    const track = await seedTrack();
    mounted = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: [`/tracks/${track.id}`] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: "/tracks/:id", element: createElement(TrackDetailPage) }),
          createElement(Route, { path: "/tracks", element: createElement("p", null, "轨道列表") }),
        ),
      ),
    );
    await flush();
    const host = mounted.host;
    await waitForText(host, "全马破三");

    await clickButton(host, "删除轨道");
    expect(await getTrack(track.id)).toBeDefined();
    await clickButton(host, "确认删除轨道");

    await waitForText(host, "轨道列表");
    expect(await getTrack(track.id)).toBeUndefined();
  });
});
