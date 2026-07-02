// @vitest-environment jsdom
import type { Ref } from "@timedata/shared";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { RefChip } from "./RefChip.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

async function mount(refItem: Ref) {
  mounted = await renderDom(createElement(MemoryRouter, null, createElement(RefChip, { refItem })));
  return mounted.host;
}

describe("RefChip", () => {
  it("renders an external anchor for url-like refs", async () => {
    const host = await mount({ kind: "url", id: "https://x.test", label: "规格" });
    const anchor = host.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://x.test");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toContain("noreferrer");
    expect(anchor?.textContent).toContain("规格");
  });

  it("links a task ref to the todo deep link (internal, not a new tab)", async () => {
    const host = await mount({ kind: "task", id: "task-1", label: "做地基" });
    const anchor = host.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("/todo?taskId=task-1");
    expect(anchor?.getAttribute("target")).toBeNull();
    expect(anchor?.textContent).toContain("做地基");
  });

  it("links goal and track refs to their detail routes", async () => {
    const goal = await mount({ kind: "goal", id: "goal-9", label: "破三" });
    expect(goal.querySelector("a")?.getAttribute("href")).toBe("/goals/goal-9");
    if (mounted) await unmount(mounted.root);
    const track = await mount({ kind: "track", id: "track-9" });
    expect(track.querySelector("a")?.getAttribute("href")).toBe("/tracks/track-9");
  });

  it("keeps an inert placeholder chip for unknown kinds", async () => {
    const host = await mount({ kind: "commit", id: "abc123" });
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toContain("abc123");
  });

  it("never renders an anchor for a non-http(s) (e.g. javascript:) id", async () => {
    const host = await mount({ kind: "url", id: "javascript:alert(1)", label: "坏链" });
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toContain("坏链");
  });
});
