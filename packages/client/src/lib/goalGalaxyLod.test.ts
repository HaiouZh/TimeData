import { describe, expect, it } from "vitest";
import { clusterLod, GALAXY_LOD_COLLAPSE_PX, GALAXY_LOD_EXPAND_PX } from "./goalGalaxyLod.js";

const bounds = { x: 0, y: 0, width: 1000, height: 1000 };

describe("clusterLod", () => {
  it("expands when apparent size is above the expand threshold", () => {
    const zoom = (GALAXY_LOD_EXPAND_PX + 50) / 1000;

    expect(clusterLod(bounds, { x: 0, y: 0, zoom }, "collapsed")).toBe("expanded");
  });

  it("collapses when apparent size is below the collapse threshold", () => {
    const zoom = (GALAXY_LOD_COLLAPSE_PX - 50) / 1000;

    expect(clusterLod(bounds, { x: 0, y: 0, zoom }, "expanded")).toBe("collapsed");
  });

  it("keeps the current state inside the hysteresis band", () => {
    const zoom = ((GALAXY_LOD_EXPAND_PX + GALAXY_LOD_COLLAPSE_PX) / 2) / 1000;

    expect(clusterLod(bounds, { x: 0, y: 0, zoom }, "expanded")).toBe("expanded");
    expect(clusterLod(bounds, { x: 0, y: 0, zoom }, "collapsed")).toBe("collapsed");
  });
});
