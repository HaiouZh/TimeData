import { describe, expect, it } from "vitest";
import { normalizeTo100 } from "./normalize.js";

describe("normalizeTo100", () => {
  it("线性映射到 0-100", () => {
    expect(normalizeTo100([0, 5, 10])).toEqual([0, 50, 100]);
  });

  it("单个有效值给 50", () => {
    expect(normalizeTo100([null, 7, null])).toEqual([null, 50, null]);
  });

  it("全相等给 50", () => {
    expect(normalizeTo100([4, 4])).toEqual([50, 50]);
  });

  it("空给全 null", () => {
    expect(normalizeTo100([null, null])).toEqual([null, null]);
  });
});
