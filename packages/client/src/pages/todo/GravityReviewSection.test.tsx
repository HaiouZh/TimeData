// @vitest-environment jsdom

import type { Task } from "@timedata/shared";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TODO_GRAVITY_SETTINGS } from "../../lib/tasks/gravity.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import type { GravitySurfacedMap } from "../../lib/tasks/gravity.js";
import { GravityReviewSection } from "./GravityReviewSection.js";

const NOW = new Date("2026-06-28T00:00:00.000Z");

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? "t1",
    parentId: null,
    title: overrides.title ?? "水下想法",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    weight: 0,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

const handlers = {
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onToToday: vi.fn(),
  onToInbox: vi.fn(),
  onAfterChildWrite: vi.fn(),
};

async function openReview(host: HTMLElement): Promise<void> {
  const details = host.querySelector("details") as HTMLDetailsElement;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GravityReviewSection", () => {
  it("draws cards on expand and marks them as surfaced via onMarkSurfaced", async () => {
    const onMarkSurfaced = vi.fn().mockResolvedValue({ a: NOW.toISOString() });
    const { host, root } = await renderDom(
      <GravityReviewSection
        sunkenTasks={[task({ id: "a" }), task({ id: "b" })]}
        settings={{ ...DEFAULT_TODO_GRAVITY_SETTINGS, drawM: 1 }}
        surfaced={{}}
        now={NOW}
        onMarkSurfaced={onMarkSurfaced}
        onBump={vi.fn()}
        {...handlers}
      />,
    );

    expect(host.textContent).toContain("水下 2 条");
    expect(host.textContent).toContain("给你备了 1 张");

    await openReview(host);

    expect(host.textContent).toContain("水下想法");
    expect(onMarkSurfaced).toHaveBeenCalledWith(["a"], NOW);
    await unmount(root);
  });

  it("limits bumping to pickN and redraws after a bump", async () => {
    const onBump = vi.fn();
    const onMarkSurfaced = vi.fn().mockResolvedValue({});
    const candidates = [task({ id: "a", title: "A" }), task({ id: "b", title: "B" }), task({ id: "c", title: "C" })];
    const { host, root } = await renderDom(
      <GravityReviewSection
        sunkenTasks={candidates}
        settings={{ ...DEFAULT_TODO_GRAVITY_SETTINGS, drawM: 2, pickN: 1 }}
        surfaced={{}}
        now={NOW}
        onMarkSurfaced={onMarkSurfaced}
        onBump={onBump}
        {...handlers}
      />,
    );

    await openReview(host);
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="顶一下 A"]'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(onBump).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("C");
    expect(host.textContent).not.toContain("A");
    await unmount(root);
  });

  it("removes a bumped card from the current batch before pickN is exhausted", async () => {
    const onBump = vi.fn();
    const onMarkSurfaced = vi.fn().mockResolvedValue({});
    const candidates = [task({ id: "a", title: "A" }), task({ id: "b", title: "B" }), task({ id: "c", title: "C" })];
    const { host, root } = await renderDom(
      <GravityReviewSection
        sunkenTasks={candidates}
        settings={{ ...DEFAULT_TODO_GRAVITY_SETTINGS, drawM: 2, pickN: 2 }}
        surfaced={{}}
        now={NOW}
        onMarkSurfaced={onMarkSurfaced}
        onBump={onBump}
        {...handlers}
      />,
    );

    await openReview(host);
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="顶一下 A"]'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(onBump).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("A");
    expect(host.textContent).toContain("B");
    expect(host.textContent).toContain("C");
    await unmount(root);
  });

  it("does not redraw the same task immediately after 再翻几张", async () => {
    const onMarkSurfaced = vi.fn().mockResolvedValue({});
    // 3 candidates, drawM=1: first draw picks 1, then 再翻几张 should pick a different one.
    const candidates = [
      task({ id: "a", title: "Alpha" }),
      task({ id: "b", title: "Bravo" }),
      task({ id: "c", title: "Charlie" }),
    ];
    const { host, root } = await renderDom(
      <GravityReviewSection
        sunkenTasks={candidates}
        settings={{ ...DEFAULT_TODO_GRAVITY_SETTINGS, drawM: 1 }}
        surfaced={{}}
        now={NOW}
        onMarkSurfaced={onMarkSurfaced}
        onBump={vi.fn()}
        {...handlers}
      />,
    );

    await openReview(host);

    const firstTitle = host.textContent?.match(/Alpha|Bravo|Charlie/)?.[0];
    expect(firstTitle).toBeTruthy();

    // Click 再翻几张 — session memory should exclude the just-shown card.
    await click(host.querySelector<HTMLButtonElement>('button:not([aria-label])'));
    await act(async () => {
      await Promise.resolve();
    });

    const secondTitle = host.textContent?.match(/Alpha|Bravo|Charlie/)?.[0];
    expect(secondTitle).toBeTruthy();
    expect(secondTitle).not.toBe(firstTitle);
    await unmount(root);
  });

  it("does not block rendering when onMarkSurfaced rejects", async () => {
    const onMarkSurfaced = vi.fn().mockRejectedValue(new Error("settings write failed"));
    const { host, root } = await renderDom(
      <GravityReviewSection
        sunkenTasks={[task({ id: "a" })]}
        settings={{ ...DEFAULT_TODO_GRAVITY_SETTINGS, drawM: 1 }}
        surfaced={{}}
        now={NOW}
        onMarkSurfaced={onMarkSurfaced}
        onBump={vi.fn()}
        {...handlers}
      />,
    );

    await openReview(host);

    // Card is still shown despite settings write failure.
    expect(host.textContent).toContain("水下想法");
    await unmount(root);
  });
});