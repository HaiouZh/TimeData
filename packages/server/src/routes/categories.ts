import { Hono } from "hono";
import { getDb } from "../db/connection.js";
import { type CategoryRow, rowToCategory } from "../lib/db-rows.js";

const categories = new Hono();

categories.get("/", (c) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM categories WHERE is_archived = 0 ORDER BY sort_order").all() as CategoryRow[];
  return c.json(rows.map(rowToCategory));
});

export default categories;
