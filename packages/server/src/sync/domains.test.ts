import { describe, expect, it } from "vitest";
import { SERVER_SYNC_DOMAINS, getServerDomain } from "./domains.js";

describe("server sync domains", () => {
  it("covers every registered shared domain", () => {
    expect(Object.keys(SERVER_SYNC_DOMAINS).sort()).toEqual([
      "categories",
      "health_heart_rate",
      "health_hrv",
      "health_sleep",
      "health_stress",
      "quick_notes",
      "runs",
      "settings",
      "time_entries",
    ]);
  });

  it("lww domains have no custom apply hook (use generic path)", () => {
    expect(getServerDomain("settings").apply).toBeUndefined();
    expect(getServerDomain("quick_notes").apply).toBeUndefined();
    expect(getServerDomain("settings").lww).toBeDefined();
    expect(getServerDomain("quick_notes").lww).toBeDefined();
  });

  it("complex domains keep custom hooks", () => {
    expect(getServerDomain("time_entries").apply).toBeTypeOf("function");
    expect(getServerDomain("categories").apply).toBeTypeOf("function");
    expect(getServerDomain("time_entries").validate).toBeTypeOf("function");
    expect(getServerDomain("categories").validate).toBeTypeOf("function");
    expect(getServerDomain("time_entries").crossValidate).toBeTypeOf("function");
  });

  it("throws on unknown domain", () => {
    expect(() => getServerDomain("nope")).toThrow(/Unknown server sync domain/);
  });
});
