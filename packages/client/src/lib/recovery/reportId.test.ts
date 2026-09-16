import { describe, expect, it } from "vitest";
import { newReportId } from "./reportId.ts";

describe("newReportId", () => {
  it("10 位 base36", () => {
    expect(newReportId()).toMatch(/^[0-9a-z]{10}$/);
  });

  it("注入随机源可复现", () => {
    let i = 0;
    const seq = [0, 0.5, 0.999];
    expect(newReportId(() => seq[i++ % seq.length])).toBe("0iz0iz0iz0");
  });
});
