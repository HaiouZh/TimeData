import { describe, expect, it } from "vitest";
import { APP_BRAND, documentTitleForPath } from "./documentTitle.js";

describe("documentTitleForPath", () => {
  it("uses the brand name alone on the home timeline", () => {
    expect(documentTitleForPath("/")).toBe("TimeData");
    expect(documentTitleForPath("/entries/new")).toBe("TimeData");
    expect(documentTitleForPath("/entries/entry-1/edit")).toBe("TimeData");
  });

  it("prefixes each main section with its nav label", () => {
    expect(documentTitleForPath("/quick-notes")).toBe("记录 · TimeData");
    expect(documentTitleForPath("/todo")).toBe("待办 · TimeData");
    expect(documentTitleForPath("/tracks")).toBe("轨道 · TimeData");
    expect(documentTitleForPath("/goals")).toBe("目标 · TimeData");
    expect(documentTitleForPath("/stats/time")).toBe("时间 · TimeData");
    expect(documentTitleForPath("/stats/health")).toBe("健康 · TimeData");
    expect(documentTitleForPath("/settings")).toBe("设置 · TimeData");
  });

  it("normalizes detail and nested paths to their section title", () => {
    expect(documentTitleForPath("/goals/goal-1")).toBe("目标 · TimeData");
    expect(documentTitleForPath("/tracks/track-1")).toBe("轨道 · TimeData");
    expect(documentTitleForPath("/settings/categories")).toBe("设置 · TimeData");
    expect(documentTitleForPath("/stats")).toBe("时间 · TimeData");
  });

  it("falls back to the brand name for unknown paths", () => {
    expect(documentTitleForPath("/bogus")).toBe("TimeData");
  });

  it("exposes the brand constant", () => {
    expect(APP_BRAND).toBe("TimeData");
  });
});
