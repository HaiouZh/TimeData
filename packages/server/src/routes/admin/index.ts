import { Hono } from "hono";
import syncLogRoute from "../syncLog.js";
import analytics from "./analytics.js";
import backups from "./backups.js";
import categories from "./categories.js";
import entries from "./entries.js";
import health from "./health.js";
import requestLogs from "./requestLogs.js";
import summary from "./summary.js";
import sync from "./sync.js";

const admin = new Hono();

admin.route("/summary", summary);
admin.route("/entries", entries);
admin.route("/categories", categories);
admin.route("/sync", sync);
admin.route("/sync-logs", syncLogRoute);
admin.route("/request-logs", requestLogs);
admin.route("/backups", backups);
admin.route("/health-checks", health);
admin.route("/analytics", analytics);

export default admin;
