import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { initializeDatabase } from "./db/schema.js";
import { getDb } from "./db/connection.js";
import { runUtcResetIfNeeded } from "./db/utcReset.js";
import { assertProductionAuthConfigured, authMiddleware } from "./middleware/auth.js";
import { bodyLimit } from "./middleware/bodyLimit.js";
import { allowedOriginsFromEnv } from "./middleware/cors.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { cleanupServerBackups } from "./sync/backup.js";
import categoriesRoute from "./routes/categories.js";
import entriesRoute from "./routes/entries.js";
import syncRoute from "./routes/sync.js";
import syncLogRoute from "./routes/syncLog.js";
import exportRoute from "./routes/export.js";
import versionRoute from "./routes/version.js";
import updateRoute from "./routes/update.js";
import dataRoute from "./routes/data.js";
import adminRoute from "./routes/admin/index.js";

const app = new Hono();
const allowedOrigins = allowedOriginsFromEnv(process.env);

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

app.get("/api/health", (c) => c.json({ status: "ok" }));
app.route("/api/version", versionRoute);

app.use("/api/*", authMiddleware);

app.use("/api/sync/*", rateLimit({ windowMs: RATE_WINDOW_MS, max: SYNC_RATE_MAX }));
app.use("/api/admin/*", rateLimit({ windowMs: RATE_WINDOW_MS, max: ADMIN_RATE_MAX }));

app.route("/api/categories", categoriesRoute);
app.route("/api/entries", entriesRoute);
app.route("/api/sync", syncRoute);
app.route("/api/sync-logs", syncLogRoute);
app.route("/api/export", exportRoute);
app.route("/api/update", updateRoute);
app.route("/api/data", dataRoute);
app.route("/api/admin", adminRoute);

app.use("/*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ root: "./public", path: "index.html" }));

assertProductionAuthConfigured();
initializeDatabase();

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

if (process.env.SERVER_REPLICAS && Number(process.env.SERVER_REPLICAS) > 1) {
  console.warn(
    "[force-push] multi-instance detected (SERVER_REPLICAS>1), but force-push tokens are in-memory. Use SQLite-backed token store instead.",
  );
}

const PORT = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`TimeData server running on http://localhost:${info.port}`);
});

export default app;
