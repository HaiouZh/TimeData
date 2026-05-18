import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { db, seedDefaultCategories } from "./index.js";

afterEach(async () => {
  await db.delete();
});

describe("Dexie database", () => {
  it("opens the current database as a single v1 schema", async () => {
    await db.delete();

    await db.open();
    await seedDefaultCategories();

    expect(db.verno).toBe(1);
    expect(await db.categories.count()).toBeGreaterThan(0);
    expect(await db.timeEntries.count()).toBe(0);
  });
});
