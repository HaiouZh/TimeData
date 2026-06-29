// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { Root } from "../test/domHarness.js";
import { renderDom, unmount } from "../test/domHarness.js";
import HighlightedText from "./HighlightedText.js";

async function renderHighlightedText(props: {
  text: string;
  terms: string[];
}): Promise<{ host: HTMLElement; root: Root }> {
  return renderDom(createElement(HighlightedText, props));
}

describe("HighlightedText", () => {
  it("renders matching terms as mark elements", async () => {
    const { host, root } = await renderHighlightedText({ text: "开会议了", terms: ["会议"] });

    const mark = host.querySelector("mark");
    expect(mark?.textContent).toBe("会议");
    expect(mark?.className).toContain("bg-accent-soft");
    expect(mark?.className).toContain("text-accent-ink");

    await unmount(root);
  });

  it("renders plain text without marks when nothing matches", async () => {
    const { host, root } = await renderHighlightedText({ text: "abc", terms: ["xyz"] });

    expect(host.querySelector("mark")).toBeNull();
    expect(host.textContent).toBe("abc");

    await unmount(root);
  });
});
