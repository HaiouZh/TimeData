import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "./constants.js";

describe("DEFAULT_CATEGORIES", () => {
  it("uses stable ids for seeded categories", () => {
    expect(DEFAULT_CATEGORIES[0].id).toBe("cat-sleep");
    expect(DEFAULT_CATEGORIES[0].children[0].id).toBe("cat-sleep-sleep");
  });
});
