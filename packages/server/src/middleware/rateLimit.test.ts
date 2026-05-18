import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimit } from "./rateLimit.js";

function appWithLimit(max: number, windowMs: number) {
  const app = new Hono();
  app.use("/api/*", rateLimit({ max, windowMs }));
  app.get("/api/ping", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimit", () => {
  it("allows up to `max` requests in the window", async () => {
    const app = appWithLimit(3, 60_000);
    const headers = { Authorization: "Bearer tok" };
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/api/ping", { headers });
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 with Retry-After when exceeded", async () => {
    const app = appWithLimit(2, 60_000);
    const headers = { Authorization: "Bearer tok" };
    await app.request("/api/ping", { headers });
    await app.request("/api/ping", { headers });
    const res = await app.request("/api/ping", { headers });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
    expect(await res.json()).toMatchObject({ error: "rate_limited" });
  });

  it("keeps independent buckets per identifier", async () => {
    const app = appWithLimit(1, 60_000);
    const first = await app.request("/api/ping", { headers: { Authorization: "Bearer A" } });
    expect(first.status).toBe(200);
    const secondToken = await app.request("/api/ping", { headers: { Authorization: "Bearer B" } });
    expect(secondToken.status).toBe(200);
    const replayFirst = await app.request("/api/ping", { headers: { Authorization: "Bearer A" } });
    expect(replayFirst.status).toBe(429);
  });

  it("does not expose raw Authorization header in rate limit keys", async () => {
    const app = appWithLimit(1, 60_000);

    const first = await app.request("/api/ping", { headers: { Authorization: "Bearer secret-token-123" } });
    expect(first.status).toBe(200);
    const second = await app.request("/api/ping", { headers: { Authorization: "Bearer secret-token-123" } });
    expect(second.status).toBe(429);
    const third = await app.request("/api/ping", { headers: { Authorization: "Bearer different-token-456" } });
    expect(third.status).toBe(200);
  });

  it("uses IP-based identifier when no Authorization header is present", async () => {
    const app = appWithLimit(1, 60_000);

    const first = await app.request("/api/ping", { headers: { "X-Real-IP": "1.2.3.4" } });
    expect(first.status).toBe(200);
    const second = await app.request("/api/ping", { headers: { "X-Real-IP": "1.2.3.4" } });
    expect(second.status).toBe(429);
    const third = await app.request("/api/ping", { headers: { "X-Real-IP": "5.6.7.8" } });
    expect(third.status).toBe(200);
  });
});
