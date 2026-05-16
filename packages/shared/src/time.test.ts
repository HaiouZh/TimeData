import { describe, it, expect } from "vitest";
import {
  isUtcIso,
  isLocalDateTime,
  localDateTimeToUtc,
  utcToLocalDateTime,
  nowUtcIso,
  APP_TIME_ZONE,
} from "./time.js";

describe("APP_TIME_ZONE", () => {
  it("is Asia/Shanghai", () => {
    expect(APP_TIME_ZONE).toBe("Asia/Shanghai");
  });
});

describe("isUtcIso", () => {
  it("accepts strings ending with Z", () => {
    expect(isUtcIso("2026-05-13T07:00:00.000Z")).toBe(true);
    expect(isUtcIso("2026-05-13T07:00:00Z")).toBe(true);
  });
  it("accepts strings with timezone offset", () => {
    expect(isUtcIso("2026-05-13T15:00:00+08:00")).toBe(true);
  });
  it("rejects local datetime without timezone", () => {
    expect(isUtcIso("2026-05-13T15:00:00")).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(isUtcIso(null)).toBe(false);
    expect(isUtcIso(12345)).toBe(false);
  });
});

describe("isLocalDateTime", () => {
  it("accepts YYYY-MM-DDTHH:mm:ss without timezone", () => {
    expect(isLocalDateTime("2026-05-13T15:00:00")).toBe(true);
  });
  it("rejects UTC with Z", () => {
    expect(isLocalDateTime("2026-05-13T07:00:00Z")).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(isLocalDateTime(null)).toBe(false);
  });
});

describe("localDateTimeToUtc", () => {
  it("converts Shanghai 15:00 to UTC 07:00", () => {
    expect(localDateTimeToUtc("2026-05-13T15:00:00")).toBe("2026-05-13T07:00:00.000Z");
  });
  it("converts Shanghai midnight to previous day UTC 16:00", () => {
    expect(localDateTimeToUtc("2026-05-14T00:00:00")).toBe("2026-05-13T16:00:00.000Z");
  });
  it("returns a string ending with Z", () => {
    const result = localDateTimeToUtc("2026-05-14T09:30:00");
    expect(result.endsWith("Z")).toBe(true);
  });
});

describe("utcToLocalDateTime", () => {
  it("converts UTC 07:00 to Shanghai 15:00", () => {
    expect(utcToLocalDateTime("2026-05-13T07:00:00.000Z")).toBe("2026-05-13T15:00:00");
  });
  it("converts UTC 16:00 to Shanghai next day 00:00", () => {
    expect(utcToLocalDateTime("2026-05-13T16:00:00.000Z")).toBe("2026-05-14T00:00:00");
  });
  it("roundtrips: local → utc → local", () => {
    const local = "2026-05-14T22:30:00";
    expect(utcToLocalDateTime(localDateTimeToUtc(local))).toBe(local);
  });
});

describe("nowUtcIso", () => {
  it("returns a UTC ISO string ending with Z", () => {
    const result = nowUtcIso();
    expect(result.endsWith("Z")).toBe(true);
    expect(new Date(result).getTime()).toBeGreaterThan(0);
  });
});
