// @vitest-environment jsdom
// biome-ignore assist/source/organizeImports: dbReset must be before trackMilestones to register fake-indexeddb before Dexie
import { db } from "../../../test/dbReset.js";
import type { TrackMilestone } from "@timedata/shared";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addTrack } from "../../../lib/tracks.js";
import * as trackMilestonesModule from "../../../lib/trackMilestones.js";
import { addMilestones, dropMilestone, linkMilestoneTask, listTrackMilestones } from "../../../lib/trackMilestones.js";
import { renderDom, unmount } from "../../../test/domHarness.js";
import { MilestoneRow } from "./MilestoneRow.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await db.tracks.clear();
  await db.trackMilestones.clear();
  await db.trackSteps.clear();
  await db.syncLog.clear();
  await db.settings.clear();
});

afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitForElement<T extends Element>(host: HTMLElement, selector: string): Promise<T> {
  for (let i = 0; i < 200; i += 1) {
    const found = host.querySelector<T>(selector);
    if (found) return found;
    await flush();
  }
  throw new Error(`Timed out waiting for element ${selector}`);
}

async function mountRow(params: {
  milestone: TrackMilestone;
  prevId?: string | null;
  nextNextId?: string | null;
  isLast?: boolean;
  isFirst?: boolean;
  readOnly?: boolean;
  onError?: (msg: string) => void;
}) {
  const onError = params.onError ?? vi.fn();
  mounted = await renderDom(
    createElement(MilestoneRow, {
      milestone: params.milestone,
      prevId: params.prevId ?? null,
      nextNextId: params.nextNextId ?? null,
      isLast: params.isLast ?? false,
      isFirst: params.isFirst ?? false,
      readOnly: params.readOnly,
      onError,
    }),
  );
  await flush();
  return { host: mounted.host, onError: onError as unknown as ReturnType<typeof vi.fn> };
}

async function openMenu(host: HTMLElement): Promise<void> {
  const trigger = host.querySelector('[data-testid="milestone-menu-trigger"]') as HTMLElement | null;
  if (!trigger) throw new Error("menu trigger not found");
  // if content already visible, skip
  if (host.querySelector('[data-testid="milestone-menu-content"]')) return;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

async function clickMenuButton(host: HTMLElement, text: string): Promise<void> {
  await openMenu(host);
  const btn = [...host.querySelectorAll('[data-testid="milestone-menu-content"] button')].find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLElement | undefined;
  if (!btn) throw new Error(`menu button ${text} not found`);
  await act(async () => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
  await flush();
}

async function typeIntoInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

async function clickElement(el: Element | null): Promise<void> {
  if (!el) throw new Error("element not found for click");
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

async function pressKeyOn(input: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
  await flush();
}

describe("MilestoneRow", () => {
  it("⑤ 勾 pending 段 → 库中 status=done；再点 → pending", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    const [m] = await addMilestones(track.id, ["段1"]);
    let current = (await listTrackMilestones(track.id))[0];
    expect(current.status).toBe("pending");

    const onError = vi.fn();
    let { host } = await mountRow({
      milestone: current,
      isFirst: true,
      isLast: true,
      onError,
    });
    const checkbox = await waitForElement<HTMLInputElement>(host, '[data-testid="milestone-checkbox"]');
    expect(checkbox.checked).toBe(false);

    // first toggle -> done (click triggers onChange)
    await clickElement(checkbox);
    for (let i = 0; i < 10; i += 1) await flush();
    let stored = await db.trackMilestones.get(m.id);
    expect(stored?.status).toBe("done");

    // second toggle -> pending, need remount with updated milestone
    current = (await listTrackMilestones(track.id))[0];
    if (mounted) await unmount(mounted.root);
    mounted = null;
    const res2 = await mountRow({
      milestone: current,
      isFirst: true,
      isLast: true,
      onError,
    });
    host = res2.host;
    const checkbox2 = await waitForElement<HTMLInputElement>(host, '[data-testid="milestone-checkbox"]');
    expect(checkbox2.checked).toBe(true);
    await clickElement(checkbox2);
    for (let i = 0; i < 10; i += 1) await flush();
    stored = await db.trackMilestones.get(m.id);
    expect(stored?.status).toBe("pending");
    expect(onError).not.toHaveBeenCalled();
  });

  it("⑥ 点标题改题 Enter → 落库，Esc → 不落", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    const [m] = await addMilestones(track.id, ["旧标题"]);
    const current = (await listTrackMilestones(track.id))[0];
    const onError = vi.fn();
    const { host } = await mountRow({
      milestone: current,
      isFirst: true,
      isLast: true,
      onError,
    });

    // Enter -> save
    const titleBtn = await waitForElement<HTMLElement>(host, '[data-testid="milestone-title"]');
    await clickElement(titleBtn);
    const input = await waitForElement<HTMLInputElement>(host, '[data-testid="milestone-title-input"]');
    expect(input.value).toBe("旧标题");
    await typeIntoInput(input, "新标题");
    await pressKeyOn(input, "Enter");
    for (let i = 0; i < 10; i += 1) await flush();
    let stored = await db.trackMilestones.get(m.id);
    expect(stored?.title).toBe("新标题");

    // Esc -> not saved (need to reopen edit with latest milestone)
    // Remount with updated milestone to get new title in prop
    const updated = (await listTrackMilestones(track.id))[0];
    if (mounted) await unmount(mounted.root);
    mounted = null;
    const { host: host2 } = await mountRow({
      milestone: updated,
      isFirst: true,
      isLast: true,
      onError,
    });
    const titleBtn2 = await waitForElement<HTMLElement>(host2, '[data-testid="milestone-title"]');
    await clickElement(titleBtn2);
    const input2 = await waitForElement<HTMLInputElement>(host2, '[data-testid="milestone-title-input"]');
    await typeIntoInput(input2, "不该落的");
    await pressKeyOn(input2, "Escape");
    await flush();
    // input should disappear, title should remain 新标题
    expect(host2.querySelector('[data-testid="milestone-title-input"]')).toBeNull();
    const titleAgain = host2.querySelector('[data-testid="milestone-title"]');
    expect(titleAgain?.textContent).toContain("新标题");
    stored = await db.trackMilestones.get(m.id);
    expect(stored?.title).toBe("新标题");
  });

  it("⑦ 菜单上移（中段）→ 顺序变化落库", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    const milestones = await addMilestones(track.id, ["A", "B", "C"]);
    const listBefore = await listTrackMilestones(track.id);
    expect(listBefore.map((m) => m.title)).toEqual(["A", "B", "C"]);
    const b = listBefore[1];
    const a = listBefore[0];
    // B is middle: prevId = A, nextNextId = null (since next is C, no nextNext), isFirst false isLast false (but B is not last)
    const onError = vi.fn();
    const { host } = await mountRow({
      milestone: b,
      prevId: a.id,
      nextNextId: null,
      isFirst: false,
      isLast: false,
      onError,
    });
    await clickMenuButton(host, "上移");
    for (let i = 0; i < 10; i += 1) await flush();
    const listAfter = await listTrackMilestones(track.id);
    expect(listAfter.map((m) => m.title)).toEqual(["B", "A", "C"]);
    expect(listAfter.map((m) => m.position)).toEqual([0, 1, 2]);
    expect(onError).not.toHaveBeenCalled();
    void milestones;
  });

  it("⑧ 菜单加塞 → 新段插入该段前重编号", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    const [orig] = await addMilestones(track.id, ["原段"]);
    const current = (await listTrackMilestones(track.id))[0];
    const onError = vi.fn();
    const { host } = await mountRow({
      milestone: current,
      isFirst: true,
      isLast: true,
      onError,
    });
    await clickMenuButton(host, "在此段前加塞");
    const insertInput = await waitForElement<HTMLInputElement>(host, '[data-testid="milestone-insert-input"]');
    await typeIntoInput(insertInput, "新段");
    // press Enter
    await pressKeyOn(insertInput, "Enter");
    for (let i = 0; i < 10; i += 1) await flush();
    const list = await listTrackMilestones(track.id);
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.title)).toEqual(["新段", "原段"]);
    expect(list.map((m) => m.position)).toEqual([0, 1]);
    void orig;
  });

  it("⑨ 砍掉留痕带 note → status=dropped、note 落库、行划线显示 note、checkbox 消失", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    const [m] = await addMilestones(track.id, ["待砍"]);
    const current = (await listTrackMilestones(track.id))[0];
    const onError = vi.fn();
    const { host } = await mountRow({
      milestone: current,
      isFirst: true,
      isLast: true,
      onError,
    });
    await clickMenuButton(host, "砍掉留痕");
    const noteInput = await waitForElement<HTMLInputElement>(host, '[data-testid="milestone-drop-note-input"]');
    await typeIntoInput(noteInput, "不需要了");
    // click confirm button "确认砍掉"
    const confirmBtn = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "确认砍掉",
    ) as HTMLElement;
    expect(confirmBtn).toBeDefined();
    await clickElement(confirmBtn);
    for (let i = 0; i < 10; i += 1) await flush();
    const stored = await db.trackMilestones.get(m.id);
    expect(stored?.status).toBe("dropped");
    expect(stored?.note).toBe("不需要了");

    // UI verification via remount with dropped milestone
    const dropped = (await listTrackMilestones(track.id))[0];
    if (mounted) await unmount(mounted.root);
    mounted = null;
    const { host: host2 } = await mountRow({
      milestone: dropped,
      isFirst: true,
      isLast: true,
      onError,
    });
    const titleEl = await waitForElement<HTMLElement>(host2, '[data-testid="milestone-title"]');
    expect(titleEl.className).toContain("line-through");
    expect(titleEl.className).toContain("text-ink-3");
    const noteEl = await waitForElement<HTMLElement>(host2, '[data-testid="milestone-note"]');
    expect(noteEl.textContent).toContain("不需要了");
    expect(host2.querySelector('[data-testid="milestone-checkbox"]')).toBeNull();
  });

  it("⑩ dropped 行菜单「恢复为待办」→ pending", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    const [m] = await addMilestones(track.id, ["待砍"]);
    await dropMilestone(m.id, "备注");
    const dropped = (await listTrackMilestones(track.id))[0];
    expect(dropped.status).toBe("dropped");
    const onError = vi.fn();
    const { host } = await mountRow({
      milestone: dropped,
      isFirst: true,
      isLast: true,
      onError,
    });
    // menu should only have restore
    await openMenu(host);
    const content = host.querySelector('[data-testid="milestone-menu-content"]');
    expect(content?.textContent).toContain("恢复为待办");
    expect(content?.textContent).not.toContain("上移");
    expect(content?.textContent).not.toContain("砍掉留痕");
    await clickMenuButton(host, "恢复为待办");
    for (let i = 0; i < 10; i += 1) await flush();
    const stored = await db.trackMilestones.get(m.id);
    expect(stored?.status).toBe("pending");
    expect(stored?.note).toBe("备注");
  });

  it("⑪ taskId 段显示「任务」chip、菜单有解挂 → 点解挂 taskId=null", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    const [m] = await addMilestones(track.id, ["需挂任务"]);
    await linkMilestoneTask(m.id, "task-123");
    const linked = (await listTrackMilestones(track.id))[0];
    expect(linked.taskId).toBe("task-123");
    const onError = vi.fn();
    const { host } = await mountRow({
      milestone: linked,
      isFirst: true,
      isLast: true,
      onError,
    });
    const chip = await waitForElement<HTMLElement>(host, '[data-testid="milestone-task-chip"]');
    expect(chip.textContent).toContain("任务");
    await clickMenuButton(host, "解挂任务");
    for (let i = 0; i < 10; i += 1) await flush();
    const stored = await db.trackMilestones.get(m.id);
    expect(stored?.taskId).toBeNull();

    // remount should hide chip
    const unlinked = (await listTrackMilestones(track.id))[0];
    if (mounted) await unmount(mounted.root);
    mounted = null;
    const { host: host2 } = await mountRow({
      milestone: unlinked,
      isFirst: true,
      isLast: true,
      onError,
    });
    expect(host2.querySelector('[data-testid="milestone-task-chip"]')).toBeNull();
    // menu should not have 解挂任务 now
    await openMenu(host2);
    const content = host2.querySelector('[data-testid="milestone-menu-content"]');
    expect(content?.textContent).not.toContain("解挂任务");
  });

  it("⑫ 写入抛错（mock setMilestoneStatus reject）→ onError 收到消息", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    const [m] = await addMilestones(track.id, ["段1"]);
    const current = (await listTrackMilestones(track.id))[0];
    const onError = vi.fn();
    const spy = vi.spyOn(trackMilestonesModule, "setMilestoneStatus").mockRejectedValue(new Error("boom"));
    const { host } = await mountRow({
      milestone: current,
      isFirst: true,
      isLast: true,
      onError,
    });
    const checkbox = await waitForElement<HTMLInputElement>(host, '[data-testid="milestone-checkbox"]');
    await clickElement(checkbox);
    for (let i = 0; i < 10; i += 1) await flush();
    expect(onError).toHaveBeenCalledWith("boom");
    spy.mockRestore();
    void m;
  });

  it("readOnly 时 checkbox 禁用、菜单与行内编辑不渲染", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    const [m] = await addMilestones(track.id, ["只读段"]);
    const current = (await listTrackMilestones(track.id))[0];
    const onError = vi.fn();
    const { host } = await mountRow({
      milestone: current,
      isFirst: true,
      isLast: true,
      readOnly: true,
      onError,
    });
    const checkbox = await waitForElement<HTMLInputElement>(host, '[data-testid="milestone-checkbox"]');
    expect(checkbox.disabled).toBe(true);
    expect(host.querySelector('[data-testid="milestone-menu"]')).toBeNull();
    // title should be span not button (no click to edit)
    const titleEl = host.querySelector('[data-testid="milestone-title"]');
    expect(titleEl?.tagName.toLowerCase()).toBe("span");
    // clicking title should not open input
    await clickElement(titleEl);
    expect(host.querySelector('[data-testid="milestone-title-input"]')).toBeNull();
    void m;
  });

  it("dropped readOnly 也不渲染菜单", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    const [m] = await addMilestones(track.id, ["段"]);
    await dropMilestone(m.id, "note");
    const dropped = (await listTrackMilestones(track.id))[0];
    const onError = vi.fn();
    const { host } = await mountRow({
      milestone: dropped,
      isFirst: true,
      isLast: true,
      readOnly: true,
      onError,
    });
    expect(host.querySelector('[data-testid="milestone-menu"]')).toBeNull();
    expect(host.querySelector('[data-testid="milestone-checkbox"]')).toBeNull();
  });
});
