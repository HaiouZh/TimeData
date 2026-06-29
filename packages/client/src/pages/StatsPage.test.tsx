// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";
import StatsPage from "./StatsPage.js";

describe("StatsPage", () => {
  it("redirects legacy /stats to time stats", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/stats"] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: "/stats", element: createElement(StatsPage) }),
          createElement(Route, { path: "/stats/time", element: createElement("div", null, "时间统计目标") }),
        ),
      ),
    );

    expect(host.textContent).toContain("时间统计目标");
    await unmount(root);
  });
});
