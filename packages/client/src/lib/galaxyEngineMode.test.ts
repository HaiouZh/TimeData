// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { readGalaxyEngineMode, writeGalaxyEngineMode } from "./galaxyEngineMode.js";

describe("galaxyEngineMode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to deterministic when nothing is stored", () => {
    expect(readGalaxyEngineMode()).toBe("deterministic");
  });

  it("round-trips a written mode", () => {
    writeGalaxyEngineMode("settle");
    expect(readGalaxyEngineMode()).toBe("settle");
    writeGalaxyEngineMode("deterministic");
    expect(readGalaxyEngineMode()).toBe("deterministic");
  });

  it("falls back to deterministic on an unknown stored value", () => {
    localStorage.setItem("timedata_galaxy_engine", "garbage");
    expect(readGalaxyEngineMode()).toBe("deterministic");
  });
});
