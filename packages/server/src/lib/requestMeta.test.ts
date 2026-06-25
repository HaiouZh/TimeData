import { describe, expect, it } from "vitest";
import { deviceLabelFromHeaders, getClientIpFromHeaders, normalizeClientHint } from "./requestMeta.js";

describe("requestMeta", () => {
  it("uses X-Real-IP before X-Forwarded-For", () => {
    const headers = new Headers({
      "X-Real-IP": " 203.0.113.10 ",
      "X-Forwarded-For": "198.51.100.7, 198.51.100.8",
    });

    expect(getClientIpFromHeaders(headers)).toBe("203.0.113.10");
  });

  it("falls back to the first X-Forwarded-For segment", () => {
    const headers = new Headers({ "X-Forwarded-For": "198.51.100.7, 198.51.100.8" });

    expect(getClientIpFromHeaders(headers)).toBe("198.51.100.7");
  });

  it("returns null when no proxy IP header exists", () => {
    expect(getClientIpFromHeaders(new Headers())).toBeNull();
  });

  it("normalizes client hints to the shared enum", () => {
    expect(normalizeClientHint("web")).toBe("web");
    expect(normalizeClientHint("android")).toBe("android");
    expect(normalizeClientHint("cli")).toBe("cli");
    expect(normalizeClientHint("agent")).toBe("agent");
    expect(normalizeClientHint("ios")).toBe("unknown");
    expect(normalizeClientHint(null)).toBe("unknown");
  });

  it("prefers client hint for device labels and falls back to user agent", () => {
    expect(deviceLabelFromHeaders(new Headers({ "X-TimeData-Client": "cli", "User-Agent": "Mozilla/5.0" }))).toBe(
      "cli",
    );
    expect(deviceLabelFromHeaders(new Headers({ "User-Agent": "Mozilla/5.0 Android" }))).toBe("android");
    expect(deviceLabelFromHeaders(new Headers({ "User-Agent": "Mozilla/5.0 iPhone" }))).toBe("ios");
    expect(deviceLabelFromHeaders(new Headers({ "User-Agent": "Mozilla/5.0" }))).toBe("web");
    expect(deviceLabelFromHeaders(new Headers({ "User-Agent": "curl/8" }))).toBeNull();
  });
});
