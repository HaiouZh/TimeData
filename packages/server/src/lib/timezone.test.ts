import { describe, expect, it } from "vitest";
import { toAppLocalDateTimeString } from "./timezone";

describe("toAppLocalDateTimeString", () => {
  it("returns YYYY-MM-DDTHH:mm:ss in the app time zone", () => {
    expect(toAppLocalDateTimeString(new Date("2026-05-13T07:00:00Z"))).toBe("2026-05-13T15:00:00");
  });
});
