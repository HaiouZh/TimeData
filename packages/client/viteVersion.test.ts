import { describe, expect, it } from "vitest";
import { readAndroidVersionCode } from "./viteVersion";

describe("readAndroidVersionCode", () => {
  it("uses TIMEDATA_ANDROID_VERSION_CODE when provided", () => {
    expect(readAndroidVersionCode({ TIMEDATA_ANDROID_VERSION_CODE: "12345" }, new Date("2026-05-13T07:00:00Z"))).toBe(
      "12345",
    );
  });

  it("falls back to YYMMDD01 from the provided date", () => {
    expect(readAndroidVersionCode({}, new Date(2026, 4, 13, 15, 0, 0))).toBe("26051301");
  });
});
