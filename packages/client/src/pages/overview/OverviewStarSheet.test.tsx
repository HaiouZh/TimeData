// @vitest-environment jsdom
import type { QuickNote, Task } from "@timedata/shared";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { buildOverviewStars, type OverviewStar } from "../../lib/overview/overviewStars.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { OverviewStarSheet } from "./OverviewStarSheet.js";

const now = new Date("2026-11-01T12:00:00.000Z");
const AT = "2026-10-30T12:00:00.000Z";

function task(overrides: Partial<Task> & Pick<Task, "id">): Task {
  return {
    id: overrides.id,
    parentId: null,
    title: overrides.title ?? overrides.id,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    weight: 0,
    completedAt: null,
    tags: [],
    ruleId: null,
    sessionId: null,
    skipped: false,
    sortOrder: 0,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function note(overrides: Partial<QuickNote> & Pick<QuickNote, "id" | "text">): QuickNote {
  return {
    occurredAt: AT,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function starOf(key: string, parts: { tasks?: Task[]; quickNotes?: QuickNote[] }): OverviewStar {
  const index = buildOverviewStars({
    tasks: parts.tasks ?? [],
    tracks: [],
    steps: [],
    quickNotes: parts.quickNotes ?? [],
    now,
  });
  const found = index.stars.find((star) => star.key === key);
  if (!found) throw new Error(`missing star ${key}`);
  return found;
}

function dialog(host: HTMLElement): HTMLElement {
  const element = host.querySelector('[role="dialog"]');
  if (!(element instanceof HTMLElement)) throw new Error("missing dialog");
  return element;
}

function linkByText(host: HTMLElement, text: string): HTMLAnchorElement {
  const element = [...host.querySelectorAll("a")].find((link) => link.textContent === text);
  if (!(element instanceof HTMLAnchorElement)) throw new Error(`missing link ${text}`);
  return element;
}

async function renderSheet(star: OverviewStar | null, clusterTitles: readonly string[] = [], onClose = vi.fn()) {
  return renderDom(
    <MemoryRouter>
      <OverviewStarSheet star={star} clusterTitles={clusterTitles} onClose={onClose} />
    </MemoryRouter>,
  );
}

describe("OverviewStarSheet", () => {
  it("速记星显示全文，「去原处」指向那天的速记", async () => {
    const star = starOf("quick_note:n1", { quickNotes: [note({ id: "n1", text: "第一行\n第二行写得很长" })] });
    const { host, root } = await renderSheet(star, ["还没归到哪件事"]);
    expect(dialog(host).querySelector("h2")?.textContent).toBe("你丢的");
    expect(dialog(host).textContent ?? "").toContain("第二行写得很长");
    expect(linkByText(host, "去原处").getAttribute("href")).toBe(star.href);
    expect(linkByText(host, "去原处").getAttribute("href")?.startsWith("/quick-notes?date=")).toBe(true);
    await unmount(root);
  });

  it("待办星显示标题，「去原处」指向那条待办", async () => {
    const star = starOf("task:t1", { tasks: [task({ id: "t1", title: "写周报" })] });
    const { host, root } = await renderSheet(star, ["TimeData"]);
    expect(dialog(host).textContent ?? "").toContain("写周报");
    expect(linkByText(host, "去原处").getAttribute("href")).toBe("/todo?taskId=t1");
    await unmount(root);
  });

  it("列出所在的团与最近动静", async () => {
    const star = starOf("task:t1", { tasks: [task({ id: "t1", title: "写周报" })] });
    const { host, root } = await renderSheet(star, ["TimeData", "还没归到哪件事"]);
    expect(dialog(host).textContent ?? "").toContain("在：TimeData、还没归到哪件事");
    expect(dialog(host).textContent ?? "").toContain("最近动静 2026-10-30");
    await unmount(root);
  });

  it("点「去原处」先关详情", async () => {
    const star = starOf("task:t1", { tasks: [task({ id: "t1", title: "写周报" })] });
    const onClose = vi.fn();
    const { host, root } = await renderSheet(star, ["TimeData"], onClose);
    await click(linkByText(host, "去原处"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("没有星时不渲染弹层", async () => {
    const { host, root } = await renderSheet(null);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await unmount(root);
  });
});
