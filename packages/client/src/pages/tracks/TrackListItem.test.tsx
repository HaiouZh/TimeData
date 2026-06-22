// @vitest-environment jsdom
import type { Track, TrackStep } from "@timedata/shared";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import type { TrackHandoffSignal } from "../../lib/tracksView.js";
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
  props: { signal?: TrackHandoffSignal | null; statusTags?: readonly string[]; onSubmitStep?: (draft: StepDraft) => void } = {},
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
  it("shows active track summary and the latest three steps", async () => {
    const host = await mount(track(), [
      step({ id: "a", seq: 0, content: "旧步骤" }),
      step({ id: "b", seq: 1, content: "开始处理", sourceLabel: "claude", tags: ["agent在做"] }),
      step({ id: "c", seq: 2, content: "等你确认", sourceLabel: "codex", tags: ["等我"] }),
      step({ id: "d", seq: 3, content: "补充证据", source: "user", tags: ["批注"] }),
    ]);
    expect(host.textContent).toContain("轨道派活");
    expect(host.textContent).toContain("把轨道变成接力线");
    expect(host.textContent).toContain("补充证据");
    expect(host.textContent).toContain("等你确认");
    expect(host.textContent).toContain("开始处理");
    expect(host.textContent).not.toContain("旧步骤");
    expect(host.textContent).toContain("我");
    expect(host.textContent).toContain("codex");
    expect(host.textContent).toContain("#等我");
  });

  it("does not show step stream for archived tracks", async () => {
    const host = await mount(track({ status: "concluded" }), [step({ id: "a", seq: 0, content: "已完成步骤" })]);
    expect(host.textContent).toContain("轨道派活");
    expect(host.textContent).not.toContain("已完成步骤");
  });

  it("shows the provided handoff badge and no badge when signal is null", async () => {
    const withSignal = await mount(track(), [step({ id: "a", seq: 0, content: "等你确认", tags: ["等我"] })], {
      signal: { tag: "等我", court: "mine", stepId: "a" },
    });
    expect(withSignal.textContent).toContain("该我了");
    expect(withSignal.textContent).toContain("#等我");

    await unmount(mounted?.root);
    mounted = null;

    const noSignal = await mount(track(), [step({ id: "b", seq: 0, content: "普通推进", tags: [] })], {
      signal: null,
    });
    expect(noSignal.textContent).not.toContain("无信号");
    expect(noSignal.textContent).not.toContain("其他");
  });

  it("keeps inline writer outside the detail link and delegates submit to parent", async () => {
    const submitted: StepDraft[] = [];
    const host = await mount(track(), [step({ id: "a", seq: 0, content: "旧步骤" })], {
      statusTags: ["等我", "agent在做"],
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
});
