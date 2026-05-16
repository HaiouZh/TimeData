import { describe, expect, it } from "vitest";
import { runVersion } from "./version.js";

describe("runVersion", () => {
  it("returns env-derived version metadata", () => {
    const result = runVersion({ TIMEDATA_CLI_VERSION: "1.2.3", TIMEDATA_CLI_SHA: "abc1234" });
    expect(result).toEqual({ ok: true, command: "version", version: "1.2.3", gitSha: "abc1234" });
  });

  it("falls back to dev defaults", () => {
    const result = runVersion({});
    expect(result.version).toBe("0.1.0");
    expect(result.gitSha).toBe("dev");
  });
});
