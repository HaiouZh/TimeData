// @vitest-environment jsdom
import type { Track } from "@timedata/shared";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { TodoTrackRow } from "../../lib/tasks/todoTrackRows.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { TrackRow } from "./TrackRow.js";

const track: Track = {
  id: "tr1",
  title: "推进轴投影层",
  status: "active",
  refs: [],
  createdAt: "2026-08-11T12:00:00.000Z",
  updatedAt: "2026-08-13T12:00:00.000Z",
};

const row: TodoTrackRow = { track, steps: [], zone: "today", stepCount: 12, hasOpenStep: true };

describe("TrackRow", () => {
  it("渲染标题与步数，链接指向轨道详情", async () => {
    const { host, root } = await renderDom(
      <MemoryRouter>
        <TrackRow row={row} />
      </MemoryRouter>,
    );
    expect(host.textContent).toContain("推进轴投影层");
    expect(host.textContent).toContain("12 步");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/tracks/tr1");
    await unmount(root);
  });

  it("没有开口步时不显示「进行中」，且永远不渲染复选框——轨道没有 done", async () => {
    const { host, root } = await renderDom(
      <MemoryRouter>
        <TrackRow row={{ ...row, hasOpenStep: false }} />
      </MemoryRouter>,
    );
    expect(host.textContent).not.toContain("进行中");
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    await unmount(root);
  });
});
