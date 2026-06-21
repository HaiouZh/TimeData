// @vitest-environment jsdom
import type { Track, TrackStep } from "@timedata/shared";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
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

async function mount(item: Track, steps: TrackStep[]) {
  mounted = await renderDom(createElement(MemoryRouter, null, createElement(TrackListItem, { track: item, steps })));
  return mounted.host;
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
});
