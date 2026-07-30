import type { AdminRequestLogsResponse } from "@timedata/shared";
import {
  AdminRequestLogClientHintSchema,
  AdminRequestLogOutcomeSchema,
  AdminRequestLogTokenTierSchema,
} from "@timedata/shared";
import { Hono } from "hono";
import { z } from "zod";
import { getGeoipReadiness } from "../../lib/geoip.js";
import { acknowledgeIpScope, listUnacknowledgedNewIpScopes } from "../../lib/knownIps.js";
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
  scopeKey: z.string().min(1),
}).strict();

// 陌生来源提醒:未确认的新来源范围列表与「知道了」确认。
// geoip 就绪状态一并返回:半加载/全缺时收敛档会变宽,不暴露的话用户只看到一片
// 「位置未知」,无从判断是库没传还是功能没生效。
requestLogs.get("/new-ips", (c) => {
  return c.json({ newIps: listUnacknowledgedNewIpScopes(), geoip: getGeoipReadiness() });
});

requestLogs.post("/new-ips/acknowledge", validateBody(acknowledgeBodySchema), (c) => {
  const { tokenTier, scopeKey } = c.var.body;
  acknowledgeIpScope(tokenTier, scopeKey);
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
