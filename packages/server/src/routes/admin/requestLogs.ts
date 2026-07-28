import type { AdminRequestLogsResponse } from "@timedata/shared";
import {
  AdminRequestLogClientHintSchema,
  AdminRequestLogOutcomeSchema,
  AdminRequestLogTokenTierSchema,
} from "@timedata/shared";
import { Hono } from "hono";
import { z } from "zod";
import { acknowledgeIp, listUnacknowledgedNewIps } from "../../lib/knownIps.js";
import { queryRequestLogs } from "../../lib/requestLog.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";

const requestLogs = new Hono();

const requestLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  status: z.coerce.number().int().optional(),
  outcome: AdminRequestLogOutcomeSchema.optional(),
  tokenTier: AdminRequestLogTokenTierSchema.optional(),
  clientHint: AdminRequestLogClientHintSchema.optional(),
}).strict();

const acknowledgeBodySchema = z.object({
  tokenTier: z.string().min(1),
  ip: z.string().min(1),
}).strict();

// 陌生 IP 提醒:未确认的新来源 IP 列表与「知道了」确认。
requestLogs.get("/new-ips", (c) => {
  return c.json({ newIps: listUnacknowledgedNewIps() });
});

requestLogs.post("/new-ips/acknowledge", validateBody(acknowledgeBodySchema), (c) => {
  const { tokenTier, ip } = c.var.body;
  acknowledgeIp(tokenTier, ip);
  return c.json({ ok: true });
});

requestLogs.get("/", validateQuery(requestLogsQuerySchema), (c) => {
  const query = c.var.query;
  const response: AdminRequestLogsResponse = {
    logs: queryRequestLogs(query),
    limit: query.limit,
  };

  return c.json(response);
});

export default requestLogs;
