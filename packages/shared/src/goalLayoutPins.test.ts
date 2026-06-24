import { describe, expect, it } from "vitest";

import {
  decodeGoalLayoutPinKey,
  encodeGoalLayoutPinKey,
  goalLayoutPinKey,
} from "./goalLayoutPins.js";

describe("goal layout pin key", () => {
  it("encodes and decodes a composite pin identity", () => {
    const key = encodeGoalLayoutPinKey("goal|1", "task", "task/1");

    expect(key).toBe("goal%7C1|task|task%2F1");
    expect(decodeGoalLayoutPinKey(key)).toEqual({
      goalId: "goal|1",
      nodeKind: "task",
      nodeId: "task/1",
    });
  });

  it("derives the same key from a pin payload", () => {
    expect(
      goalLayoutPinKey({
        goalId: "goal-1",
        nodeKind: "goal",
        nodeId: "goal-1",
        x: 120,
        y: -30,
        updatedAt: "2026-06-24T00:00:00.000Z",
      }),
    ).toBe("goal-1|goal|goal-1");
  });

  it("rejects malformed keys and invalid node kinds", () => {
    expect(() => decodeGoalLayoutPinKey("goal-1|task")).toThrow(/Invalid goal layout pin key/);
    expect(() => decodeGoalLayoutPinKey("goal-1|note|node-1")).toThrow(/Invalid goal layout pin node kind/);
  });

  it("rejects empty composite identity parts", () => {
    expect(() => decodeGoalLayoutPinKey("|goal|node-1")).toThrow(/Invalid goal layout pin key/);
    expect(() => decodeGoalLayoutPinKey("goal-1|goal|")).toThrow(/Invalid goal layout pin key/);
    expect(() => decodeGoalLayoutPinKey("%20%20|goal|node-1")).toThrow(/Invalid goal layout pin key/);
  });
});
