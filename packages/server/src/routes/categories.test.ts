import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRouteTestDb, seedCategory, setupRouteTestApp } from "../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;

beforeEach(async () => {
  const setup = await setupRouteTestApp("/api/categories", "../routes/categories.js");
  app = setup.app;
  db = setup.db;
  db.prepare("DELETE FROM categories WHERE parent_id IS NOT NULL").run();
  db.prepare("DELETE FROM categories WHERE parent_id IS NULL").run();
});

afterEach(() => {
  cleanupRouteTestDb(db);
});

describe("GET /api/categories", () => {
  it("returns active categories sorted by sort_order", async () => {
    seedCategory(db, { id: "cat-later", name: "较后", sortOrder: 20 });
    seedCategory(db, { id: "cat-earlier", name: "较前", sortOrder: 10 });

    const res = await app.request("/api/categories");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      expect.objectContaining({ id: "cat-earlier", name: "较前", sortOrder: 10, isArchived: false }),
      expect.objectContaining({ id: "cat-later", name: "较后", sortOrder: 20, isArchived: false }),
    ]);
  });

  it("excludes archived categories", async () => {
    seedCategory(db, { id: "cat-active", name: "保留", isArchived: false });
    seedCategory(db, { id: "cat-archived", name: "归档", isArchived: true });

    const res = await app.request("/api/categories");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; isArchived: boolean }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: "cat-active", isArchived: false });
    expect(body.find((category) => category.id === "cat-archived")).toBeUndefined();
  });
});
