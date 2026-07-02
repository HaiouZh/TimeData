import { describe, expect, it, vi } from "vitest";
import { executeAndroidBackAction, resolveAndroidBackAction } from "./androidBackNavigation.ts";

describe("resolveAndroidBackAction", () => {
  it("returns settings parent for settings detail pages", () => {
    expect(resolveAndroidBackAction("/settings/data")).toEqual({ type: "navigate", to: "/settings", replace: true });
    expect(resolveAndroidBackAction("/settings/server")).toEqual({ type: "navigate", to: "/settings", replace: true });
    expect(resolveAndroidBackAction("/settings/nav")).toEqual({ type: "navigate", to: "/settings", replace: true });
    expect(resolveAndroidBackAction("/settings/tracks")).toEqual({ type: "navigate", to: "/settings", replace: true });
    expect(resolveAndroidBackAction("/settings/insights")).toEqual({ type: "navigate", to: "/settings", replace: true });
    expect(resolveAndroidBackAction("/settings/health-range")).toEqual({
      type: "navigate",
      to: "/settings",
      replace: true,
    });
    expect(resolveAndroidBackAction("/settings/stats-layout")).toEqual({
      type: "navigate",
      to: "/settings",
      replace: true,
    });
    expect(resolveAndroidBackAction("/settings/garmin")).toEqual({ type: "navigate", to: "/settings", replace: true });
    expect(resolveAndroidBackAction("/settings/todo-gravity")).toEqual({
      type: "navigate",
      to: "/settings",
      replace: true,
    });
  });

  it("goes back for entry editor pages", () => {
    expect(resolveAndroidBackAction("/entries/new")).toEqual({ type: "back", fallbackTo: "/" });
    expect(resolveAndroidBackAction("/entries/entry-1/edit")).toEqual({ type: "back", fallbackTo: "/" });
  });

  it("returns home from secondary tab pages", () => {
    expect(resolveAndroidBackAction("/quick-notes")).toEqual({ type: "navigate", to: "/", replace: true });
    expect(resolveAndroidBackAction("/stats")).toEqual({ type: "navigate", to: "/", replace: true });
    expect(resolveAndroidBackAction("/stats/time")).toEqual({ type: "navigate", to: "/", replace: true });
    expect(resolveAndroidBackAction("/stats/health")).toEqual({ type: "navigate", to: "/", replace: true });
    expect(resolveAndroidBackAction("/categories")).toEqual({ type: "navigate", to: "/", replace: true });
    expect(resolveAndroidBackAction("/settings")).toEqual({ type: "navigate", to: "/", replace: true });
  });

  it("exits app on home page", () => {
    expect(resolveAndroidBackAction("/")).toEqual({ type: "exit" });
  });

  it("returns settings parent for /settings/categories list", () => {
    expect(resolveAndroidBackAction("/settings/categories")).toEqual({
      type: "navigate",
      to: "/settings",
      replace: true,
    });
  });

  it("returns categories list parent for /settings/categories/:id detail", () => {
    expect(resolveAndroidBackAction("/settings/categories/abc-123")).toEqual({
      type: "navigate",
      to: "/settings/categories",
      replace: true,
    });
  });

  it("returns tracks list parent for /tracks/:id detail", () => {
    expect(resolveAndroidBackAction("/tracks/track-1")).toEqual({
      type: "navigate",
      to: "/tracks",
      replace: true,
    });
  });

  it("returns goals list parent for /goals/:id detail", () => {
    expect(resolveAndroidBackAction("/goals/goal-1")).toEqual({
      type: "navigate",
      to: "/goals",
      replace: true,
    });
  });

  it("returns settings parent for /settings/admin-insights", () => {
    expect(resolveAndroidBackAction("/settings/admin-insights")).toEqual({
      type: "navigate",
      to: "/settings",
      replace: true,
    });
  });
});

describe("executeAndroidBackAction", () => {
  it("navigates back for entry pages when React Router has an app history entry", () => {
    const navigate = vi.fn();
    const exitApp = vi.fn();

    executeAndroidBackAction({ type: "back", fallbackTo: "/" }, "abc123", navigate, exitApp);

    expect(navigate).toHaveBeenCalledWith(-1);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("uses fallback for entry pages opened as the initial app route", () => {
    const navigate = vi.fn();
    const exitApp = vi.fn();

    executeAndroidBackAction({ type: "back", fallbackTo: "/" }, "default", navigate, exitApp);

    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("exits only for exit actions", () => {
    const navigate = vi.fn();
    const exitApp = vi.fn();

    executeAndroidBackAction({ type: "exit" }, "default", navigate, exitApp);

    expect(exitApp).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });
});
