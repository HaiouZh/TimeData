import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getDb } from "./db/connection.js";
import { initializeDatabase } from "./db/schema.js";
import { runUtcResetIfNeeded } from "./db/utcReset.js";
import { authMiddleware } from "./middleware/auth.js";
import { bodyLimit } from "./middleware/bodyLimit.js";
import { allowedOriginsFromEnv } from "./middleware/cors.js";
import { rateLimit } from "./middleware/rateLimit.js";
import adminRoute from "./routes/admin/index.js";
import categoriesRoute from "./routes/categories.js";
import dataRoute from "./routes/data.js";
import entriesRoute from "./routes/entries.js";
import exportRoute from "./routes/export.js";
import quickNotesRoute from "./routes/quick-notes.js";
import syncRoute from "./routes/sync.js";
import { ingestRoutes } from "./routes/ingest.js";
import { garminRoutes } from "./garmin/garminRoutes.js";
import { loadGarminConfig } from "./garmin/garminRoutes.js";
import { updateSchedule } from "./garmin/garminService.js";
import { reconcileInterruptedUpdate } from "./lib/update.js";
import updateRoute from "./routes/update.js";
import versionRoute from "./routes/version.js";
import { cleanupServerBackups } from "./sync/backup.js";

const app = new Hono();
const allowedOrigins = allowedOriginsFromEnv(process.env);

if (allowedOrigins.includes("*")) {
  console.warn(
    "[cors] ALLOWED_ORIGINS includes '*' while credentials are enabled. " +
    "This reflects the request origin back, defeating the browser's same-credentials guard. " +
    "Set ALLOWED_ORIGINS to an explicit comma-separated allowlist in production.",
  );
}
if (allowedOrigins.length === 0) {
  console.warn(
    "[cors] ALLOWED_ORIGINS not configured. All cross-origin /api/* requests will be rejected. " +
    "Set ALLOWED_ORIGINS in the environment to enable client connectivity.",
  );
}

const MAX_BODY_BYTES = Number.parseInt(process.env.MAX_BODY_BYTES || "", 10) || 5 * 1024 * 1024;
const SYNC_RATE_MAX = Number.parseInt(process.env.SYNC_RATE_MAX || "", 10) || 60;
const ADMIN_RATE_MAX = Number.parseInt(process.env.ADMIN_RATE_MAX || "", 10) || 120;
const RATE_WINDOW_MS = 60_000;

// CSP defaults are too strict for the SPA's inline styles / Vite bundles;
// intentionally omit `contentSecurityPolicy` so we don't break the production
// client. A future hardening pass can layer a per-environment CSP here.
app.use(
  "*",
  secureHeaders({
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
  }),
);

app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) {
        return null;
      }
      if (allowedOrigins.includes("*")) {
        return origin;
      }
      return allowedOrigins.includes(origin) ? origin : null;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

app.use("/api/*", bodyLimit(MAX_BODY_BYTES));

app.get("/api/health", (c) => {
  try {
    const row = getDb().prepare("SELECT 1 as ok").get() as { ok: number } | undefined;
    if (row?.ok !== 1) throw new Error("db ping returned unexpected row");
    return c.json({ status: "ok", db: "ok" });
  } catch (err) {
    console.error("[health] db ping failed:", (err as Error).message);
    return c.json({ status: "ok", db: "error" }, 503);
  }
});
app.route("/api/version", versionRoute);

app.use("/api/*", authMiddleware);

app.use("/api/sync/*", rateLimit({ windowMs: RATE_WINDOW_MS, max: SYNC_RATE_MAX }));
app.use("/api/admin/*", rateLimit({ windowMs: RATE_WINDOW_MS, max: ADMIN_RATE_MAX }));

app.route("/api/categories", categoriesRoute);
app.route("/api/entries", entriesRoute);
app.route("/api/quick-notes", quickNotesRoute);
app.route("/api/sync", syncRoute);
app.route("/api/export", exportRoute);
app.route("/api/update", updateRoute);
app.route("/api/data", dataRoute);
app.route("/api/admin", adminRoute);
app.route("/api/health", ingestRoutes);
app.route("/api/admin/garmin", garminRoutes);

app.use("/*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ root: "./public", path: "index.html" }));

initializeDatabase();

try {
  reconcileInterruptedUpdate(process.env.UPDATE_STATE_DIR || "/app/data");
} catch (error) {
  console.warn("[update] startup lock reconciliation failed", error);
}

const utcReset = runUtcResetIfNeeded(getDb());
if (utcReset.ran) {
  console.log(`[utc-reset] business data cleared and defaults seeded at ${utcReset.resetAt}`);
}

try {
  const removed = cleanupServerBackups();
  if (removed.length > 0) console.log(`[backup] startup cleanup removed ${removed.length} old backups`);
} catch (error) {
  console.warn("[backup] startup cleanup failed", error);
}

try {
  const garminConfig = loadGarminConfig();
  if (garminConfig.enabled && garminConfig.schedule) {
    updateSchedule(garminConfig);
  }
} catch (error) {
  console.warn("[garmin] startup schedule init failed", error);
}

if (process.env.SERVER_REPLICAS && Number(process.env.SERVER_REPLICAS) > 1) {
  console.warn(
    "[server] multi-instance detected (SERVER_REPLICAS>1), but force-push tokens and sync stream listeners are in-memory. Use shared storage/pub-sub before multi-instance deployment.",
  );
}

const PORT = Number.parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`TimeData server running on http://localhost:${info.port}`);
});

export default app;
