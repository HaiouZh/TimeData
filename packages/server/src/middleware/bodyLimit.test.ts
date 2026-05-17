import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { bodyLimit } from "./bodyLimit.js";

function appWithLimit(maxBytes: number) {
  const app = new Hono();
  app.use("/api/*", bodyLimit(maxBytes));
  app.post("/api/echo", async (c) => c.json({ ok: true, body: await c.req.json() }));
  app.get("/api/echo", (c) => c.json({ ok: true }));
  return app;
}

describe("bodyLimit", () => {
  it("allows GET regardless of length header", async () => {
    const app = appWithLimit(10);
    const res = await app.request("/api/echo", {
      method: "GET",
      headers: { "Content-Length": "1000000" },
    });
    expect(res.status).toBe(200);
  });

  it("allows POST under the limit", async () => {
    const app = appWithLimit(100);
    const body = JSON.stringify({ ok: true });
    const res = await app.request("/api/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(body.length) },
      body,
    });
    expect(res.status).toBe(200);
  });

  it("rejects POST when Content-Length exceeds the limit", async () => {
    const app = appWithLimit(10);
    const body = JSON.stringify({ filler: "x".repeat(100) });
    const res = await app.request("/api/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(body.length) },
      body,
    });
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json).toMatchObject({ error: "payload_too_large", limit: 10 });
  });

  it("skips clone body reads when Content-Length is within the limit", async () => {
    const middleware = bodyLimit(100);
    const next = vi.fn(async () => undefined);
    const c = {
      req: {
        method: "POST",
        header: (name: string) => name === "Content-Length" ? "10" : undefined,
        raw: { clone: vi.fn(() => { throw new Error("clone should not be called"); }) },
      },
      json: vi.fn(),
    };

    await middleware(c as never, next);

    expect(c.req.raw.clone).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects oversized requests without relying on Content-Length", async () => {
    const app = new Hono();
    app.use("*", bodyLimit(5));
    app.post("/upload", async (c) => c.json({ received: await c.req.text() }));

    const response = await app.request("/upload", {
      method: "POST",
      body: "123456",
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ error: "payload_too_large", limit: 5 }));
  });
});
