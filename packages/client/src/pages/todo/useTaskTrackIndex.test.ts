// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/index.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { useTaskTrackIndex, type TaskTrackData } from "./useTaskTrackIndex.js";

beforeEach(async () => {
  await db.tracks.clear();
  await db.trackSteps.clear();
  await db.settings.clear();
});

describe("useTaskTrackIndex ready", () => {
  it("首帧 ready === false，数据到齐后 true", async () => {
    let latest: TaskTrackData | null = null;
    function Probe() {
      latest = useTaskTrackIndex();
      return null;
    }
    const { root } = await renderDom(createElement(Probe));
    expect(latest?.ready).toBe(false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // liveQuery 回流后 ready 应为 true（即使空库也是数据到齐）
    expect(latest?.ready).toBe(true);
    await unmount(root);
  });
});
