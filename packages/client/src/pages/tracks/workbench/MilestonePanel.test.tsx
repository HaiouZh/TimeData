// @vitest-environment jsdom
// biome-ignore assist/source/organizeImports: dbReset must be before track modules to register fake-indexeddb before Dexie
import { db } from "../../../test/dbReset.js";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addTrack } from "../../../lib/tracks.js";
import { addMilestones, listTrackMilestones } from "../../../lib/trackMilestones.js";
import { renderDom, unmount } from "../../../test/domHarness.js";
import { MilestonePanel } from "./MilestonePanel.js";

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

async function mountPanel(trackId: string, opts?: { readOnly?: boolean; onError?: (msg: string) => void }) {
  const onError = opts?.onError ?? vi.fn();
  mounted = await renderDom(createElement(MilestonePanel, { trackId, readOnly: opts?.readOnly, onError }));
  // wait for liveQuery initial flush
  for (let i = 0; i < 20; i += 1) await flush();
  return { host: mounted.host, onError };
}

async function typeTextarea(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setValue?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

async function typeInput(input: HTMLInputElement, value: string): Promise<void> {
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

describe("MilestonePanel", () => {
  it("① 空态显示立骨架 textarea，输入三行（含空行与前后空格）提交 → addMilestones 效果落库 3 段、textarea 消失列表出现", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    const onError = vi.fn();
    const { host } = await mountPanel(track.id, { onError });

    const textarea = await waitForElement<HTMLTextAreaElement>(host, '[data-testid="milestone-skeleton-textarea"]');
    expect(textarea.placeholder).toContain("一行一段");
    expect(textarea.placeholder).toContain("调研");
    // progress bar should show 未立骨架
    expect(host.textContent).toContain("未立骨架");

    await typeTextarea(textarea, "  调研  \n\n  打样\n上线  ");
    const btn = await waitForElement<HTMLElement>(host, '[data-testid="milestone-skeleton-submit"]');
    expect(btn.textContent).toContain("立骨架");
    await clickElement(btn);

    for (let i = 0; i < 20; i += 1) await flush();

    const list = await listTrackMilestones(track.id);
    expect(list).toHaveLength(3);
    expect(list.map((m) => m.title)).toEqual(["调研", "打样", "上线"]);
    expect(list.map((m) => m.position)).toEqual([0, 1, 2]);

    // textarea should disappear, list should appear
    expect(host.querySelector('[data-testid="milestone-skeleton-textarea"]')).toBeNull();
    expect(host.querySelector('[data-testid="milestone-skeleton-creator"]')).toBeNull();
    const rows = host.querySelectorAll('[data-testid="milestone-row"]');
    expect(rows.length).toBe(3);
    expect(host.textContent).toContain("调研");
    expect(host.textContent).toContain("打样");
    expect(host.textContent).toContain("上线");
    expect(onError).not.toHaveBeenCalled();
  });

  it("② 有段渲染 N 行 + 加一段输入", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    await addMilestones(track.id, ["A", "B", "C"]);
    const { host } = await mountPanel(track.id);

    // wait for rows
    const rows = await waitForElement<HTMLElement>(host, '[data-testid="milestone-row"]');
    void rows;
    // ensure 3 rows
    for (let i = 0; i < 20; i += 1) await flush();
    const allRows = host.querySelectorAll('[data-testid="milestone-row"]');
    expect(allRows.length).toBe(3);
    expect(host.textContent).toContain("A");
    expect(host.textContent).toContain("B");
    expect(host.textContent).toContain("C");

    const addInput = await waitForElement<HTMLInputElement>(host, '[data-testid="milestone-add-input"]');
    expect(addInput).not.toBeNull();
    const addBtn = await waitForElement<HTMLElement>(host, '[data-testid="milestone-add-submit"]');
    expect(addBtn.textContent).toContain("加一段");
    // skeleton should not exist
    expect(host.querySelector('[data-testid="milestone-skeleton-textarea"]')).toBeNull();
  });

  it("③ 加一段提交追加末尾 position 续接", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    await addMilestones(track.id, ["第一段", "第二段"]);
    const before = await listTrackMilestones(track.id);
    expect(before.map((m) => m.position)).toEqual([0, 1]);

    const { host } = await mountPanel(track.id);
    await waitForElement<HTMLElement>(host, '[data-testid="milestone-row"]');
    for (let i = 0; i < 10; i += 1) await flush();

    const addInput = await waitForElement<HTMLInputElement>(host, '[data-testid="milestone-add-input"]');
    await typeInput(addInput, "第三段");
    const addBtn = await waitForElement<HTMLElement>(host, '[data-testid="milestone-add-submit"]');
    await clickElement(addBtn);
    for (let i = 0; i < 20; i += 1) await flush();

    const after = await listTrackMilestones(track.id);
    expect(after).toHaveLength(3);
    expect(after.map((m) => m.title)).toEqual(["第一段", "第二段", "第三段"]);
    expect(after.map((m) => m.position)).toEqual([0, 1, 2]);
    expect(after[2].position).toBe(2);

    // also test Enter key path: add fourth
    const addInput2 = await waitForElement<HTMLInputElement>(host, '[data-testid="milestone-add-input"]');
    await typeInput(addInput2, "第四段");
    await act(async () => {
      addInput2.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    for (let i = 0; i < 20; i += 1) await flush();
    const after2 = await listTrackMilestones(track.id);
    expect(after2).toHaveLength(4);
    expect(after2[3].title).toBe("第四段");
    expect(after2[3].position).toBe(3);
  });

  it("④ readOnly 不渲染立骨架/加一段", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    // empty + readOnly
    const { host: hostEmpty } = await mountPanel(track.id, { readOnly: true });
    for (let i = 0; i < 10; i += 1) await flush();
    expect(hostEmpty.querySelector('[data-testid="milestone-skeleton-textarea"]')).toBeNull();
    expect(hostEmpty.querySelector('[data-testid="milestone-skeleton-creator"]')).toBeNull();
    expect(hostEmpty.querySelector('[data-testid="milestone-add-input"]')).toBeNull();
    expect(hostEmpty.querySelector('[data-testid="milestone-add-one"]')).toBeNull();
    // progress bar still renders
    expect(hostEmpty.querySelector('[data-testid="segment-progress-bar"]')).not.toBeNull();

    if (mounted) await unmount(mounted.root);
    mounted = null;

    // with data + readOnly
    await addMilestones(track.id, ["A", "B"]);
    const { host: hostWith } = await mountPanel(track.id, { readOnly: true });
    await waitForElement<HTMLElement>(hostWith, '[data-testid="milestone-row"]');
    for (let i = 0; i < 10; i += 1) await flush();
    expect(hostWith.querySelectorAll('[data-testid="milestone-row"]').length).toBe(2);
    expect(hostWith.querySelector('[data-testid="milestone-add-input"]')).toBeNull();
    expect(hostWith.querySelector('[data-testid="milestone-skeleton-textarea"]')).toBeNull();
    // rows should be readOnly: checkbox disabled, menu hidden
    const checkbox = hostWith.querySelector(
      '[data-testid="milestone-checkbox-host"] input[type="checkbox"]',
    ) as HTMLInputElement | null;
    if (checkbox) expect(checkbox.disabled).toBe(true);
    expect(hostWith.querySelector('[data-testid="milestone-menu"]')).toBeNull();
  });

  it("空集合输入仅空白行不调用写入", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    const { host } = await mountPanel(track.id);
    const textarea = await waitForElement<HTMLTextAreaElement>(host, '[data-testid="milestone-skeleton-textarea"]');
    await typeTextarea(textarea, "   \n \n  ");
    const btn = await waitForElement<HTMLElement>(host, '[data-testid="milestone-skeleton-submit"]');
    await clickElement(btn);
    for (let i = 0; i < 10; i += 1) await flush();
    const list = await listTrackMilestones(track.id);
    expect(list).toHaveLength(0);
    // still shows skeleton
    expect(host.querySelector('[data-testid="milestone-skeleton-textarea"]')).not.toBeNull();
  });

  it("顶部渲染 SegmentProgressBar", async () => {
    const track = await addTrack({ title: "T1", now: new Date("2026-06-21T00:00:00.000Z") });
    const { host } = await mountPanel(track.id);
    const bar = await waitForElement<HTMLElement>(host, '[data-testid="segment-progress-bar"]');
    expect(bar).not.toBeNull();
    // after adding segments, progress text appears
    await addMilestones(track.id, ["A"]);
    for (let i = 0; i < 20; i += 1) await flush();
    expect(host.textContent).toContain("0/1");
  });
});
