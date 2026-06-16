import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authMiddleware, createAuthMiddleware, createScopedAuthMiddleware, scopedAuthMiddleware } from "./auth.js";

const originalAuthToken = process.env.AUTH_TOKEN;
const originalAgentToken = process.env.AGENT_TOKEN;
const originalNodeEnv = process.env.NODE_ENV;
const originalAllowUnauthenticatedDev = process.env.ALLOW_UNAUTHENTICATED_DEV;

function createApp() {
  const handler = vi.fn((c) => c.json({ ok: true }));
  const app = new Hono();
  app.use("/api/*", authMiddleware);
  app.get("/api/protected", handler);
  return { app, handler };
}

function createScopedApp() {
  const handler = vi.fn((c) => c.json({ ok: true }));
  const app = new Hono();
  app.use("/api/*", scopedAuthMiddleware);
  app.get("/api/protected", handler);
  return { app, handler };
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.AUTH_TOKEN;
  delete process.env.AGENT_TOKEN;
  delete process.env.ALLOW_UNAUTHENTICATED_DEV;
  process.env.NODE_ENV = originalNodeEnv;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAuthToken === undefined) {
    delete process.env.AUTH_TOKEN;
  } else {
    process.env.AUTH_TOKEN = originalAuthToken;
  }

  if (originalAgentToken === undefined) {
    delete process.env.AGENT_TOKEN;
  } else {
    process.env.AGENT_TOKEN = originalAgentToken;
  }

  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }

  if (originalAllowUnauthenticatedDev === undefined) {
    delete process.env.ALLOW_UNAUTHENTICATED_DEV;
  } else {
    process.env.ALLOW_UNAUTHENTICATED_DEV = originalAllowUnauthenticatedDev;
  }
});

describe("authMiddleware", () => {
  it("returns 500 when AUTH_TOKEN and ALLOW_UNAUTHENTICATED_DEV are unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { app, handler } = createApp();

    const res = await app.request("/api/protected");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Server misconfigured: AUTH_TOKEN not set" });
    expect(handler).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("passes through without AUTH_TOKEN only when ALLOW_UNAUTHENTICATED_DEV is enabled and warns once", async () => {
    process.env.ALLOW_UNAUTHENTICATED_DEV = "1";
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
      "[auth] AUTH_TOKEN unset — all /api/* endpoints are open. ALLOW_UNAUTHENTICATED_DEV=1 is set.",
    );
  });

  it("records unauthorized requests through the audit hook", async () => {
    const audit = vi.fn();
    const app = new Hono();
    app.use("/api/*", createAuthMiddleware({ recordAuthFailure: audit }));
    app.get("/api/protected", (c) => c.json({ ok: true }));
    process.env.AUTH_TOKEN = "correct-token";

    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer wrong-token" },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(audit).toHaveBeenCalledTimes(1);
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

  it("rejects tokens of different length without length-based early return", async () => {
    process.env.AUTH_TOKEN = "long-token-value";
    const { app, handler } = createApp();

    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer short" },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("scopedAuthMiddleware", () => {
  it("passes through for the master bearer token when both scoped tokens are configured", async () => {
    process.env.AUTH_TOKEN = "master-token";
    process.env.AGENT_TOKEN = "agent-token";
    const { app, handler } = createScopedApp();

    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer master-token" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("passes through for the agent bearer token", async () => {
    process.env.AUTH_TOKEN = "master-token";
    process.env.AGENT_TOKEN = "agent-token";
    const { app, handler } = createScopedApp();

    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer agent-token" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("records unauthorized scoped requests through the audit hook", async () => {
    const audit = vi.fn();
    const handler = vi.fn((c) => c.json({ ok: true }));
    const app = new Hono();
    app.use("/api/*", createScopedAuthMiddleware({ recordAuthFailure: audit }));
    app.get("/api/protected", handler);
    process.env.AUTH_TOKEN = "master-token";
    process.env.AGENT_TOKEN = "agent-token";

    const res = await app.request("/api/protected", {
      headers: {
        Authorization: "Bearer wrong-token",
        "X-Forwarded-For": "203.0.113.7",
      },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(handler).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith({ path: "/api/protected", ip: "203.0.113.7" });
  });

  it("returns 500 when scoped tokens and ALLOW_UNAUTHENTICATED_DEV are unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { app, handler } = createScopedApp();

    const res = await app.request("/api/protected");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Server misconfigured: AUTH_TOKEN and AGENT_TOKEN not set" });
    expect(handler).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("passes through without scoped tokens only when ALLOW_UNAUTHENTICATED_DEV is enabled", async () => {
    process.env.ALLOW_UNAUTHENTICATED_DEV = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { app, handler } = createScopedApp();

    const res = await app.request("/api/protected");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
