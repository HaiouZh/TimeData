import { describe, expect, it } from "vitest";
import { parseFlags } from "./args.js";

describe("parseFlags", () => {
  it("supports --flag=value", () => {
    expect(parseFlags(["--start=09:00", "--end=10:00"])).toEqual({ start: "09:00", end: "10:00" });
  });

  it("mixes --flag=value and --flag value", () => {
    expect(parseFlags(["--start=09:00", "--end", "10:00", "--note=hi"])).toEqual({
      start: "09:00",
      end: "10:00",
      note: "hi",
    });
  });

  it("treats empty --flag= values literally", () => {
    expect(parseFlags(["--note=", "--server", "x"])).toEqual({ note: "", server: "x" });
  });
});
