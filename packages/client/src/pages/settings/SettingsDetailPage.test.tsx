import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import SettingsDetailPage from "./SettingsDetailPage.js";

describe("SettingsDetailPage", () => {
  it("renders a title, back link, and children", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(
          SettingsDetailPage,
          {
            title: "数据设置",
          },
          createElement("p", null, "数据内容"),
        ),
      ),
    );

    expect(html).toContain("数据设置");
    expect(html).toContain("返回设置");
    expect(html).toContain('href="/settings"');
    expect(html).toContain("数据内容");
  });
});
