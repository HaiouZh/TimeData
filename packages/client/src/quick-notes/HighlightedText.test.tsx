// @vitest-environment jsdom
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import HighlightedText from "./HighlightedText.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderHighlightedText(props: { text: string; terms: string[] }): HTMLDivElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(HighlightedText, props));
  });
  return host;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("HighlightedText", () => {
  it("renders matching terms as mark elements", () => {
    const host = renderHighlightedText({ text: "开会议了", terms: ["会议"] });

    const mark = host.querySelector("mark");
    expect(mark?.textContent).toBe("会议");
  });

  it("renders plain text without marks when nothing matches", () => {
    const host = renderHighlightedText({ text: "abc", terms: ["xyz"] });

    expect(host.querySelector("mark")).toBeNull();
    expect(host.textContent).toBe("abc");
  });
});
