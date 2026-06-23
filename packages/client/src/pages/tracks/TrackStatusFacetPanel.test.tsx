// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrackStatusFacet } from "../../lib/tracksView.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TrackStatusFacetPanel } from "./TrackStatusFacetPanel.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

async function mount(facets: TrackStatusFacet[], selectedTags: string[] = [], onToggle = vi.fn()) {
  mounted = await renderDom(
    <TrackStatusFacetPanel facets={facets} selectedTags={selectedTags} onToggle={onToggle} />,
  );
  return { host: mounted.host, onToggle };
}

describe("TrackStatusFacetPanel", () => {
  it("renders configured board signal facets with counts", async () => {
    const { host } = await mount([
      { tag: "待我处理", count: 0, suggested: true },
      { tag: "agent在做", count: 2, suggested: true },
    ]);
    expect(host.textContent).toContain("看板信号");
    expect(host.textContent).toContain("待我处理 0");
    expect(host.textContent).toContain("agent在做 2");
  });

  it("marks selected tags with aria-pressed and calls onToggle", async () => {
    const { host, onToggle } = await mount(
      [
        { tag: "待我处理", count: 0, suggested: true },
        { tag: "agent在做", count: 2, suggested: true },
      ],
      ["agent在做"],
    );
    const selected = host.querySelector('button[aria-pressed="true"]') as HTMLButtonElement;
    expect(selected.textContent).toContain("agent在做 2");
    await click(host.querySelector("button"));
    expect(onToggle).toHaveBeenCalledWith("待我处理");
  });
});
