import { beforeEach, describe, expect, it } from "vitest";
import { getMergeOvernightEnabled, setMergeOvernightEnabled } from "./overnightDisplaySetting.js";

beforeEach(() => {
  localStorage.clear();
});

describe("overnight display setting", () => {
  it("defaults to enabled", () => {
    expect(getMergeOvernightEnabled()).toBe(true);
  });

  it("uses the explicit saved setting", () => {
    setMergeOvernightEnabled(false);

    expect(getMergeOvernightEnabled()).toBe(false);

    setMergeOvernightEnabled(true);

    expect(getMergeOvernightEnabled()).toBe(true);
  });
});
