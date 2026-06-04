import { describe, expect, it } from "vitest";
import { readAndroidVersionCode, readBuildId } from "./viteVersion";

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

describe("readBuildId", () => {
  it("uses TIMEDATA_BUILD_ID when provided", () => {
    expect(readBuildId({ TIMEDATA_BUILD_ID: "deadbeef" }, new Date("2026-06-04T07:00:00Z"))).toBe("deadbeef");
  });

  it("falls back to the millisecond timestamp", () => {
    const now = new Date("2026-06-04T07:00:00Z");
    expect(readBuildId({}, now)).toBe(String(now.getTime()));
  });
});
