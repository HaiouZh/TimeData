import { describe, expect, it } from "vitest";
import { lodFromZoom } from "./goalGraphLod.js";

describe("lodFromZoom", () => {
  it("zoom 小于 0.72 时返回 far", () => {
    expect(lodFromZoom(0.71)).toBe("far");
  });

  it("非有限数返回 near", () => {
    expect(lodFromZoom(Number.NaN)).toBe("near");
    expect(lodFromZoom(Number.POSITIVE_INFINITY)).toBe("near");
    expect(lodFromZoom(Number.NEGATIVE_INFINITY)).toBe("near");
  });
});
