// @vitest-environment jsdom
import type { TrackStep } from "@timedata/shared";
import { afterEach, describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { TrackStepRow } from "./TrackStepRow.js";

const T = "2026-06-21T00:00:00.000Z";
const NOW = new Date("2026-06-21T02:00:00.000Z");

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

function step(partial: Partial<TrackStep> & { id: string }): TrackStep {
  return {
    trackId: "t1",
    source: "agent",
    content: "推进了一步",
    startedAt: T,
    endedAt: T,
    refs: [],
    tags: [],
    seq: 0,
    createdAt: T,
    updatedAt: T,
    ...partial,
  };
}

async function mount(props: { step: TrackStep; isCurrent: boolean; now: Date }) {
  mounted = await renderDom(<TrackStepRow {...props} />);
  return mounted.host;
}

describe("TrackStepRow", () => {
  it("shows sourceLabel for agent steps and 我 for user steps", async () => {
    const a = await mount({ step: step({ id: "a", source: "agent", sourceLabel: "codex" }), isCurrent: false, now: NOW });
    expect(a.textContent).toContain("codex");
    expect(a.textContent).toContain("推进了一步");
    if (mounted) await unmount(mounted.root);
    const b = await mount({ step: step({ id: "b", source: "user", sourceLabel: undefined }), isCurrent: false, now: NOW });
    expect(b.querySelector('[data-source="user"]')?.textContent).toContain("我");
  });

  it("renders 决策 as an ordinary retrieval tag without a special badge", async () => {
    const decided = await mount({ step: step({ id: "d", source: "agent", tags: ["决策"] }), isCurrent: false, now: NOW });
    expect(decided.textContent).toContain("#决策");
    expect(decided.textContent).not.toContain("决策步");
    expect(decided.querySelector("[data-decision]")).toBeNull();
  });

  it("renders tags, refs and an in-progress duration for the current open step", async () => {
    const host = await mount({
      step: step({
        id: "c",
        endedAt: null,
        startedAt: T,
        tags: ["base期"],
        refs: [{ kind: "url", id: "https://x.test", label: "spec" }],
      }),
      isCurrent: true,
      now: NOW,
    });
    expect(host.textContent).toContain("#base期");
    expect(host.querySelector('[data-testid="ref-chip"]')).not.toBeNull();
    expect(host.textContent).toContain("进行中");
    expect(host.textContent).toContain("2小时");
    // 当前步高亮:accent token,不裸色
    expect(host.querySelector('[data-current="true"]')?.className).toContain("border-accent");
  });

  it("renders the duration label with a tabular number role", async () => {
    const host = await mount({ step: step({ id: "dur" }), isCurrent: false, now: NOW });
    const duration = host.querySelector(".td-duration");
    expect(duration).not.toBeNull();
    expect(duration?.textContent).toContain("历时");
  });
});
