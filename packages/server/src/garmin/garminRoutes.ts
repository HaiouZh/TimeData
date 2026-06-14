import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { getLatestSeq } from "../sync/seq.js";
import {
  createGarminNoOpResult,
  fetchGarminData,
  getGarminDailyLatestDates,
  getGarminStatus,
  recordGarminFetchAudit,
  resolveGarminFetchRange,
  updateSchedule,
  stopSchedule,
} from "./garminService.js";
import {
  loadGarminConfig,
  saveGarminConfig,
  setGarminLastFetchDate,
} from "./garminConfig.js";

const garminRoutes = new Hono();

function errorBody(code: string, message: string, details?: unknown): Record<string, unknown> {
  return { error: code, code, message, ...(details === undefined ? {} : { details }) };
}

// ── Routes ──────────────────────────────────────────────────────────

garminRoutes.get("/config", (c) => {
  const config = loadGarminConfig();
  return c.json({
    email: config.email,
    password: config.password ? "********" : "",
    isCn: config.isCn,
    schedule: config.schedule,
    enabled: config.enabled,
    lastFetchDate: config.lastFetchDate,
    initialBackfillDays: config.initialBackfillDays,
  });
});

const ConfigUpdateSchema = z
  .object({
    email: z.string().optional(),
    password: z.string().optional(),
    isCn: z.boolean().optional(),
    schedule: z
      .string()
      .regex(/^(\d{2}:\d{2})?$/)
      .optional(),
    enabled: z.boolean().optional(),
    initialBackfillDays: z.number().int().min(1).max(30).optional(),
  })
  .strict();

garminRoutes.put("/config", async (c) => {
  const body = await c.req.json();
  const parsed = ConfigUpdateSchema.safeParse(body);
  if (!parsed.success)
    return c.json(
      { error: "invalid_config", details: parsed.error.issues },
      400,
    );

  saveGarminConfig(parsed.data);
  const config = loadGarminConfig();

  if (config.enabled && config.schedule) {
    updateSchedule(config);
  } else {
    stopSchedule();
  }

  return c.json({ ok: true });
});

const FetchRequestSchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    days: z.number().int().min(1).max(90).optional(),
  })
  .superRefine((value, ctx) => {
    const hasStart = value.startDate !== undefined;
    const hasEnd = value.endDate !== undefined;
    if (value.days !== undefined && (hasStart || hasEnd)) {
      ctx.addIssue({
        code: "custom",
        message: "cannot combine dates with days",
        path: ["days"],
      });
    }
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: "custom",
        message: "startDate and endDate must be provided together",
        path: hasStart ? ["endDate"] : ["startDate"],
      });
    }
  })
  .strict();

garminRoutes.post("/fetch", async (c) => {
  const config = loadGarminConfig();
  if (!config.email || !config.password) {
    return c.json(errorBody("credentials_missing", "Garmin credentials not configured"), 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = FetchRequestSchema.safeParse(body);
  if (!parsed.success)
    return c.json(
      errorBody("invalid_request", "Invalid Garmin fetch request", parsed.error.issues),
      400,
    );

  let range: ReturnType<typeof resolveGarminFetchRange>;
  try {
    range = resolveGarminFetchRange(
      parsed.data,
      config,
      getGarminDailyLatestDates(getDb()),
      new Date(),
    );
  } catch (error) {
    return c.json(
      errorBody("invalid_request", error instanceof Error ? error.message : String(error)),
      400,
    );
  }

  if (range.noOp) {
    const latestSeq = getLatestSeq();
    const result = createGarminNoOpResult("manual", range.startDate, range.endDate);
    recordGarminFetchAudit(getDb(), {
      ...result,
      latestSeqBefore: latestSeq,
      latestSeqAfter: latestSeq,
    });
    return c.json(result);
  }

  const result = await fetchGarminData(config, range.startDate, range.endDate, { trigger: "manual" });

  if (result.success && result.status !== "no_op") {
    setGarminLastFetchDate(result.endDate);
  }

  return c.json(result);
});

garminRoutes.get("/status", (c) => {
  return c.json(getGarminStatus());
});

garminRoutes.post("/test", async (c) => {
  const config = loadGarminConfig();
  if (!config.email || !config.password) {
    return c.json(errorBody("credentials_missing", "Garmin credentials not configured"), 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  const result = await fetchGarminData(config, today, today, { trigger: "test" });
  return c.json({ ok: result.success, errors: result.errors });
});

export { garminRoutes };
