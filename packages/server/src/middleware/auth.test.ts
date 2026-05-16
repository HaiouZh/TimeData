import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertProductionAuthConfigured, authMiddleware } from "./auth.js";

const originalAuthToken = process.env.AUTH_TOKEN;
const originalNodeEnv = process.env.NODE_ENV;

function createApp() {
  const handler = vi.fn((c) => c.json({ ok: true }));
  const app = new Hono();
  app.use("/api/*", authMiddleware);
  app.get("/api/protected", handler);
  return { app, handler };
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.AUTH_TOKEN;
  process.env.NODE_ENV = originalNodeEnv;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAuthToken === undefined) {
    delete process.env.AUTH_TOKEN;
  } else {
    process.env.AUTH_TOKEN = originalAuthToken;
  }

  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe("authMiddleware", () => {
  it("passes through without AUTH_TOKEN and warns only once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { app, handler } = createApp();

    const first = await app.request("/api/protected");
    const second = await app.request("/api/protected");

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(second.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[auth] AUTH_TOKEN unset — all /api/* endpoints are open. Do NOT use in production.",
    );
  });

  it("passes through for the correct bearer token", async () => {
    process.env.AUTH_TOKEN = "correct-token";
    const { app, handler } = createApp();

    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer correct-token" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("returns 401 when authorization is missing", async () => {
    process.env.AUTH_TOKEN = "correct-token";
    const { app, handler } = createApp();

    const res = await app.request("/api/protected");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong bearer token", async () => {
    process.env.AUTH_TOKEN = "correct-token";
    const { app, handler } = createApp();

    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer wrong-token" },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 for an equal-length wrong bearer token", async () => {
    process.env.AUTH_TOKEN = "correct-token";
    const { app, handler } = createApp();

    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer xorrect-token" },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("assertProductionAuthConfigured", () => {
  it("throws in production when AUTH_TOKEN is unset", () => {
    expect(() => assertProductionAuthConfigured({ NODE_ENV: "production" })).toThrow(
      "AUTH_TOKEN must be set when NODE_ENV=production",
    );
  });

  it("does not throw in production when AUTH_TOKEN is set", () => {
    expect(() =>
      assertProductionAuthConfigured({ NODE_ENV: "production", AUTH_TOKEN: "configured" }),
    ).not.toThrow();
  });
});
