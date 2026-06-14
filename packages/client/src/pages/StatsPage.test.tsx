// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import StatsPage from "./StatsPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("StatsPage", () => {
  it("redirects legacy /stats to time stats", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(
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
    });

    expect(host.textContent).toContain("时间统计目标");
    await act(async () => root.unmount());
  });
});
