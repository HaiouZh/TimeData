import { describe, expect, it } from "vitest";

import { describeDomainCounts } from "./domainLabels.js";

describe("describeDomainCounts", () => {
  it("labels track domains in backup summaries", () => {
    expect(describeDomainCounts({ goals: 1, tracks: 1, track_steps: 2 })).toBe("1 条目标，1 条轨道，2 条轨道步骤");
  });
});
