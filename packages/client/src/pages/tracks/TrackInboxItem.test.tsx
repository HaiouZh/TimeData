// @vitest-environment jsdom
import type { InboxEntry } from "../../lib/tracksView.js";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { TrackInboxItem } from "./TrackInboxItem.js";

const T = "2026-06-21T00:00:00.000Z";
const NOW = new Date("2026-06-21T02:00:00.000Z");

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

function entry(): InboxEntry {
  return {
    track: { id: "t1", title: "全马破三", status: "active", refs: [], createdAt: T, updatedAt: T },
    step: {
      id: "s1",
      trackId: "t1",
      source: "agent",
      sourceLabel: "codex",
      content: "等你确认配速表",
      startedAt: T,
      endedAt: null,
      refs: [],
      tags: ["等我"],
      seq: 3,
      createdAt: T,
      updatedAt: T,
    },
  };
}

async function mount(e: InboxEntry) {
  mounted = await renderDom(createElement(MemoryRouter, null, createElement(TrackInboxItem, { entry: e, now: NOW })));
  return mounted.host;
}

describe("TrackInboxItem", () => {
  it("shows track title, current-step content, source, duration and tags", async () => {
    const host = await mount(entry());
    expect(host.textContent).toContain("全马破三");
    expect(host.textContent).toContain("等你确认配速表");
    expect(host.textContent).toContain("codex");
    expect(host.textContent).toContain("进行中");
    expect(host.textContent).toContain("2小时");
    expect(host.textContent).toContain("#等我");
  });

  it("links the whole entry to the track detail page", async () => {
    const host = await mount(entry());
    expect(host.querySelector('a[href="/tracks/t1"]')).not.toBeNull();
  });
});
