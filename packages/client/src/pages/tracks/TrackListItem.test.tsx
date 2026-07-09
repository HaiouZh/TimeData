// @vitest-environment jsdom
import type { Track, TrackStep } from "@timedata/shared";
import { act, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { TrackBoardSignal } from "../../lib/tracksView.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import type { StepDraft } from "./StepComposer.js";
import { TrackListItem } from "./TrackListItem.js";

const T = "2026-06-21T00:00:00.000Z";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

function track(partial: Partial<Track> = {}): Track {
  return {
    id: "track-1",
    title: "轨道派活",
    summary: "把轨道变成接力线",
    status: "active",
    refs: [],
    createdAt: T,
    updatedAt: T,
    ...partial,
  };
}

function step(partial: Partial<TrackStep> & { id: string; seq: number }): TrackStep {
  return {
    trackId: "track-1",
    source: "agent",
    sourceLabel: "codex",
    content: "",
    startedAt: T,
    endedAt: T,
    refs: [],
    tags: [],
    createdAt: T,
    updatedAt: T,
    ...partial,
  };
}

async function mount(
  item: Track,
  steps: TrackStep[],
  props: {
    signal?: TrackBoardSignal | null;
    badgeTone?: "warn" | "purple" | "default";
    stalledDays?: number | null;
    selected?: boolean;
    statusTags?: readonly string[];
    onSubmitStep?: (draft: StepDraft) => Promise<void> | void;
    compact?: boolean;
  } = {},
) {
  mounted = await renderDom(
    createElement(MemoryRouter, null, createElement(TrackListItem, { track: item, steps, ...props })),
  );
  return mounted.host;
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
  return [...host.querySelectorAll("button")].find((button) => button.textContent === text) ?? null;
}

async function typeTextarea(host: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setValue?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitInlineForm(host: HTMLElement): Promise<void> {
  await act(async () => {
    (host.querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("TrackListItem", () => {
  it("卡片主体=最新步内容，不再显示 当前:第N步/已历时", async () => {
    const host = await mount(track(), [
      step({ id: "a", seq: 0, content: "旧步骤" }),
      step({ id: "b", seq: 1, content: "初具雏形，等确认", source: "user", sourceLabel: "codex" }),
    ]);
    expect(host.textContent).toContain("轨道派活");
    expect(host.textContent).toContain("把轨道变成接力线");
    expect(host.querySelector('[data-testid="track-current-frame"]')?.textContent).toContain("初具雏形");
    expect(host.textContent).not.toContain("旧步骤");
    expect(host.textContent).not.toContain("当前:第");
    expect(host.textContent).not.toContain("已历时");
  });

  it("stalledDays 传入时最后动静位显示 N 天没动静", async () => {
    const host = await mount(track(), [step({ id: "a", seq: 0, content: "最近一步" })], { stalledDays: 13 });
    expect(host.querySelector('[data-testid="track-last-activity"]')?.textContent).toContain("13 天没动静");
  });

  it("selected 时卡片带 accent 边框", async () => {
    const host = await mount(track(), [step({ id: "a", seq: 0, content: "最近一步" })], { selected: true });
    expect(host.querySelector("article")?.className).toContain("border-accent");
  });

  it("shows current frame for archived tracks too (状态卡不区分活跃/归档隐藏内容)", async () => {
    const host = await mount(track({ status: "concluded" }), [step({ id: "a", seq: 0, content: "已完成步骤" })]);
    expect(host.textContent).toContain("轨道派活");
    expect(host.querySelector('[data-testid="track-current-frame"]')?.textContent).toContain("已完成步骤");
  });

  it("shows the provided board signal badge and no badge when signal is null", async () => {
    const withSignal = await mount(track(), [step({ id: "a", seq: 0, content: "等你确认", tags: ["待我处理"] })], {
      signal: { tag: "待我处理", stepId: "a" },
    });
    expect(withSignal.textContent).toContain("#待我处理");
    expect(withSignal.textContent).not.toContain("该我了");

    await unmount(mounted?.root);
    mounted = null;

    const noSignal = await mount(track(), [step({ id: "b", seq: 0, content: "普通推进", tags: [] })], {
      signal: null,
    });
    expect(noSignal.textContent).not.toContain("#待我处理");
    expect(noSignal.textContent).not.toContain("其他");
  });

  it("badgeTone 决定信号徽章语义色：warn/purple/默认 accent", async () => {
    const warn = await mount(track(), [step({ id: "a", seq: 0, tags: ["待我处理"] })], {
      signal: { tag: "待我处理", stepId: "a" },
      badgeTone: "warn",
    });
    expect(warn.querySelector('[data-testid="track-signal-badge"]')?.className).toContain("text-warn");

    await unmount(mounted?.root);
    mounted = null;

    const purple = await mount(track(), [step({ id: "b", seq: 0, tags: ["agent在做"] })], {
      signal: { tag: "agent在做", stepId: "b" },
      badgeTone: "purple",
    });
    expect(purple.querySelector('[data-testid="track-signal-badge"]')?.className).toContain("text-data-purple");

    await unmount(mounted?.root);
    mounted = null;

    const fallback = await mount(track(), [step({ id: "c", seq: 0, tags: ["复盘"] })], {
      signal: { tag: "复盘", stepId: "c" },
    });
    expect(fallback.querySelector('[data-testid="track-signal-badge"]')?.className).toContain("text-accent");
  });

  it("keeps inline writer outside the detail link and delegates submit to parent", async () => {
    const submitted: StepDraft[] = [];
    const host = await mount(track(), [step({ id: "a", seq: 0, content: "旧步骤" })], {
      statusTags: ["待我处理", "agent在做"],
      onSubmitStep: (draft) => submitted.push(draft),
    });

    await click(host.querySelector('button[aria-label="写一步"]'));
    const form = host.querySelector("form");
    expect(form?.closest("a")).toBeNull();
    await typeTextarea(host, "交给 agent 继续");
    await click(buttonByText(host, "#agent在做"));
    await submitInlineForm(host);
    expect(submitted).toEqual([{ content: "交给 agent 继续", mode: "open", tags: ["agent在做"] }]);
  });

  it("keeps the inline writer open and preserves the draft when submit fails", async () => {
    const host = await mount(track(), [step({ id: "a", seq: 0, content: "旧步骤" })], {
      statusTags: ["待我处理"],
      onSubmitStep: () => Promise.reject(new Error("写不进去")),
    });

    await click(host.querySelector('button[aria-label="写一步"]'));
    await typeTextarea(host, "交给 agent 继续");
    await submitInlineForm(host);

    // 失败:composer 不收起、草稿保留、显示 inline 错误(TK-01 收起契约)。
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toBe("交给 agent 继续");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("写不进去");
  });

  it("compact=true 时收成单行：无来源 chip、无 summary、无信号徽章、无写一步按钮", async () => {
    const host = await mount(track(), [step({ id: "a", seq: 0, content: "归档前最后一步", source: "user" })], {
      compact: true,
      signal: { tag: "复盘", stepId: "a" },
      onSubmitStep: () => undefined,
    });

    expect(host.textContent).toContain("轨道派活");
    expect(host.querySelector('[data-testid="track-current-frame"]')?.textContent).toContain("归档前最后一步");
    expect(host.querySelector('[data-source]')).toBeNull();
    expect(host.textContent).not.toContain("把轨道变成接力线");
    expect(host.querySelector('[data-testid="track-signal-badge"]')).toBeNull();
    expect(buttonByText(host, "写一步")).toBeNull();
  });
});
