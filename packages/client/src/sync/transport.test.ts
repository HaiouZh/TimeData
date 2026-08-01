import { describe, expect, it } from "vitest";
import { selectSyncTransport } from "./transport.js";

describe("selectSyncTransport", () => {
  it("uses native Android transport only for resume sync", () => {
    expect(selectSyncTransport({ platform: "android", reason: "resume" })).toBe("native-android");
  });

  it("falls back to web when the CapacitorHttp plugin is unavailable", () => {
    expect(selectSyncTransport({ platform: "android", reason: "resume", nativeHttpAvailable: false })).toBe("web");
  });

  it.each(["startup", "write", "bump", "reconnect", "fallback", "flush"] as const)(
    "keeps Android %s sync on the web transport",
    (reason) => {
      expect(selectSyncTransport({ platform: "android", reason })).toBe("web");
    },
  );

  it("keeps web resume sync on the web transport", () => {
    expect(selectSyncTransport({ platform: "web", reason: "resume" })).toBe("web");
  });
});
