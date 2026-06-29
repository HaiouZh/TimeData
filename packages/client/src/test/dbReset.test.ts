import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "./dbReset.js";

beforeEach(resetDb);
afterEach(resetDb);

describe("resetDb", () => {
  it("opens the shared db and leaves all tables empty", async () => {
    expect(db.isOpen()).toBe(true);
    const counts = await Promise.all(db.tables.map((t) => t.count()));
    expect(counts.every((n) => n === 0)).toBe(true);
  });

  it("clears data from a previous run without rebuilding schema (no delete)", async () => {
    await db.settings.put({ key: "k", value: "v", updatedAt: new Date().toISOString() });
    expect(await db.settings.count()).toBe(1);
    await resetDb();
    expect(await db.settings.count()).toBe(0);
    expect(db.isOpen()).toBe(true); // 没走 delete → 仍开着
  });
});
