import Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRouteTestDb, seedCategory, seedEntry, setupRouteTestApp } from "../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;

beforeEach(async () => {
  const setup = await setupRouteTestApp("/api/export", "../routes/export.js");
  app = setup.app;
  db = setup.db;
  db.prepare("DELETE FROM time_entries").run();
  db.prepare("DELETE FROM categories WHERE parent_id IS NOT NULL").run();
  db.prepare("DELETE FROM categories WHERE parent_id IS NULL").run();
});

afterEach(() => {
  cleanupRouteTestDb(db);
});

function seedExportData() {
  seedCategory(db, { id: "cat-work", name: "工作", sortOrder: 1 });
  seedCategory(db, { id: "cat-code", name: "编程", parentId: "cat-work", sortOrder: 1 });
  seedEntry(db, {
    id: "entry-code",
    categoryId: "cat-code",
    startTime: "2026-05-13T09:00:00.000Z",
    endTime: "2026-05-13T10:00:00.000Z",
    note: "写测试",
  });
}

describe("GET /api/export", () => {
  it("returns jsonl by default", async () => {
    seedExportData();

    const res = await app.request("/api/export");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
    const lines = (await res.text()).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ type: "category", id: "cat-work", name: "工作", parentId: null }),
      expect.objectContaining({ type: "category", id: "cat-code", name: "编程", parentId: "cat-work" }),
      expect.objectContaining({ type: "entry", id: "entry-code", category: "工作/编程", note: "写测试" }),
    ]);
  });

  it("keeps explicit JSONL export available", async () => {
    seedExportData();

    const res = await app.request("/api/export?format=jsonl");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"type":"category"');
  });

  it("returns csv when format=csv without unnecessary quotes", async () => {
    seedExportData();

    const res = await app.request("/api/export?format=csv");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv");
    expect(await res.text()).toBe(
      "category,start,end,note\n" +
      "工作/编程,2026-05-13T09:00:00.000Z,2026-05-13T10:00:00.000Z,写测试\n",
    );
  });

  it("rejects unknown format", async () => {
    const res = await app.request("/api/export?format=xml");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unsupported format. Use jsonl or csv." });
  });
});

describe("export route CSV escaping", () => {
  it("quotes cells containing commas", async () => {
    seedCategory(db, { id: "cat-comma", name: "工作,会议", sortOrder: 1 });
    seedEntry(db, {
      id: "entry-comma",
      categoryId: "cat-comma",
      startTime: "2026-05-13T09:00:00.000Z",
      endTime: "2026-05-13T10:00:00.000Z",
      note: "普通记录",
    });

    const res = await app.request("/api/export?format=csv");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      "category,start,end,note\n" +
      "\"工作,会议\",2026-05-13T09:00:00.000Z,2026-05-13T10:00:00.000Z,普通记录\n",
    );
  });

  it("doubles internal double quotes in exported category names and notes", async () => {
    seedCategory(db, { id: "cat-quote", name: "研究\"开发", sortOrder: 1 });
    seedEntry(db, {
      id: "entry-quote",
      categoryId: "cat-quote",
      startTime: "2026-05-13T10:00:00.000Z",
      endTime: "2026-05-13T11:00:00.000Z",
      note: "记录\"引用\"内容",
    });

    const res = await app.request("/api/export?format=csv");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      "category,start,end,note\n" +
      "\"研究\"\"开发\",2026-05-13T10:00:00.000Z,2026-05-13T11:00:00.000Z,\"记录\"\"引用\"\"内容\"\n",
    );
  });

  it("quotes cells containing newlines and preserves the final newline", async () => {
    seedCategory(db, { id: "cat-newline", name: "复盘", sortOrder: 1 });
    seedEntry(db, {
      id: "entry-newline",
      categoryId: "cat-newline",
      startTime: "2026-05-13T11:00:00.000Z",
      endTime: "2026-05-13T12:00:00.000Z",
      note: "第一行\n第二行",
    });

    const res = await app.request("/api/export?format=csv");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      "category,start,end,note\n" +
      "复盘,2026-05-13T11:00:00.000Z,2026-05-13T12:00:00.000Z,\"第一行\n第二行\"\n",
    );
  });

  it("prefixes formula-like cells with apostrophes to prevent spreadsheet injection", async () => {
    seedCategory(db, { id: "cat-formula", name: "@自动化", sortOrder: 1 });
    seedEntry(db, {
      id: "entry-formula",
      categoryId: "cat-formula",
      startTime: "2026-05-13T12:00:00.000Z",
      endTime: "2026-05-13T13:00:00.000Z",
      note: "=SUM(A1:A2)",
    });

    const res = await app.request("/api/export?format=csv");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      "category,start,end,note\n" +
      "'@自动化,2026-05-13T12:00:00.000Z,2026-05-13T13:00:00.000Z,'=SUM(A1:A2)\n",
    );
  });
});

describe("POST /api/export/import", () => {
  it("does not expose server-side JSONL import", async () => {
    const res = await app.request("/api/export/import", {
      method: "POST",
      body: '{"type":"category"}',
    });

    expect(res.status).toBe(404);
  });
});
