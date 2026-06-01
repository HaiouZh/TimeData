import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { db, seedDefaultCategories } from "./index.js";

afterEach(async () => {
  await db.delete();
});

describe("Dexie database", () => {
  it("opens the current database as a v3 schema", async () => {
    await db.delete();

    await db.open();
    await seedDefaultCategories();

    expect(db.verno).toBe(3);
    expect(await db.categories.count()).toBeGreaterThan(0);
    expect(await db.timeEntries.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
    expect(await db.quickNotes.count()).toBe(0);
  });
});
