// @vitest-environment jsdom
import type { Track } from "@timedata/shared";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { TodoTrackRow } from "../../lib/tasks/todoTrackRows.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { WaitingSection } from "./WaitingSection.js";

function makeRow(id: string, title: string): TodoTrackRow {
  const track: Track = {
    id,
    title,
    status: "active",
    refs: [],
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-14T12:00:00.000Z",
  };
  return { track, steps: [], zone: "waiting", stepCount: 3, hasOpenStep: false };
}

describe("WaitingSection", () => {
  it("渲染区标题、条数与每条轨道行", async () => {
    const { host, root } = await renderDom(
      <MemoryRouter>
        <WaitingSection rows={[makeRow("tr1", "速记 sticky 日期条"), makeRow("tr2", "同步重构")]} />
      </MemoryRouter>,
    );
    const section = host.querySelector('[data-testid="todo-section-waiting"]');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("在等");
    expect(section?.textContent).toContain("速记 sticky 日期条");
    expect(section?.textContent).toContain("同步重构");
    expect(host.querySelectorAll('[data-testid="todo-track-row"]').length).toBe(2);
    await unmount(root);
  });

  it("没有停滞轨道时整块不渲染", async () => {
    const { host, root } = await renderDom(
      <MemoryRouter>
        <WaitingSection rows={[]} />
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-testid="todo-section-waiting"]')).toBeNull();
    await unmount(root);
  });
});
