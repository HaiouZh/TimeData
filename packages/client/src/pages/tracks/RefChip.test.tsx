// @vitest-environment jsdom
import type { Ref } from "@timedata/shared";
import { afterEach, describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { RefChip } from "./RefChip.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

async function mount(refItem: Ref) {
  mounted = await renderDom(<RefChip refItem={refItem} />);
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

  it("renders a static placeholder chip for domain refs", async () => {
    const host = await mount({ kind: "task", id: "task-1", label: "做地基" });
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toContain("做地基");
  });

  it("falls back to id when label is absent", async () => {
    const host = await mount({ kind: "commit", id: "abc123" });
    expect(host.textContent).toContain("abc123");
  });
});
