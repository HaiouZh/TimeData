import { describe, expect, it } from "vitest";
import { formatResult, resolveOutputFormat } from "./format.js";

describe("resolveOutputFormat", () => {
  it("respects explicit --format=json", () => {
    expect(resolveOutputFormat({ isTTY: true, format: "json" })).toBe("json");
  });

  it("respects explicit --format=human", () => {
    expect(resolveOutputFormat({ isTTY: false, format: "human" })).toBe("human");
  });

  it("defaults to human when stdout is a TTY", () => {
    expect(resolveOutputFormat({ isTTY: true, format: undefined })).toBe("human");
  });

  it("defaults to json when stdout is piped", () => {
    expect(resolveOutputFormat({ isTTY: false, format: undefined })).toBe("json");
  });
});

describe("formatResult", () => {
  it("serializes to JSON when format=json", () => {
    expect(formatResult({ ok: true, command: "version", version: "1.0" }, "json")).toContain("\"version\"");
  });

  it("renders version compactly when human", () => {
    expect(formatResult({ ok: true, command: "version", version: "1.0", gitSha: "abc" }, "human")).toBe("timedata 1.0 (abc)");
  });

  it("renders error code and message in human mode", () => {
    const out = formatResult({ ok: false, error: { code: "INVALID_DATE", message: "Bad date" } }, "human");
    expect(out).toContain("[INVALID_DATE]");
    expect(out).toContain("Bad date");
  });

  it("renders entries list in human mode", () => {
    const out = formatResult(
      {
        ok: true,
        entries: [
          { startTime: "2026-05-13T09:00:00.000Z", endTime: "2026-05-13T10:00:00.000Z", category: "Work", durationMinutes: 60, note: null },
        ],
      },
      "human",
    );
    expect(out).toContain("Work");
    expect(out).toContain("60m");
  });
});
