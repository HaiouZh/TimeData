import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateBody, validateQuery } from "./validate.js";

describe("validateQuery", () => {
  it("stores parsed query data on c.var.query when schema passes", async () => {
    const app = new Hono();
    const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
    app.use("/test", validateQuery(schema));
    app.get("/test", (c) => c.json({ date: c.var.query.date }));

    const res = await app.request("/test?date=2026-05-19");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ date: "2026-05-19" });
  });

  it("returns INVALID_REQUEST 400 when query schema fails", async () => {
    const app = new Hono();
    const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
    app.use("/test", validateQuery(schema));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test?date=bad");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });
});

describe("validateBody", () => {
  it("stores parsed body data on c.var.body when schema passes", async () => {
    const app = new Hono();
    const schema = z.object({ name: z.string().min(1) });
    app.use("/test", validateBody(schema));
    app.post("/test", (c) => c.json({ name: c.var.body.name }));

    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "TimeData" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "TimeData" });
  });

  it("returns INVALID_JSON 400 when body is not valid JSON", async () => {
    const app = new Hono();
    const schema = z.object({ name: z.string().min(1) });
    app.use("/test", validateBody(schema));
    app.post("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("returns INVALID_BODY 400 when body schema fails", async () => {
    const app = new Hono();
    const schema = z.object({ name: z.string().min(1) });
    app.use("/test", validateBody(schema));
    app.post("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_BODY");
  });
});
