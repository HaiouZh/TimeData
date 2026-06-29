import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StyleguidePage from "./StyleguidePage.js";

describe("StyleguidePage", () => {
  it("renders token and typography sections", () => {
    const html = renderToStaticMarkup(<StyleguidePage />);
    expect(html).toContain("设计语言预览");
    expect(html).toContain("--color-accent");
  });

  it("lists the typography and number role classes", () => {
    const html = renderToStaticMarkup(<StyleguidePage />);
    expect(html).toContain("td-text-display");
    expect(html).toContain("td-stat");
  });
});
