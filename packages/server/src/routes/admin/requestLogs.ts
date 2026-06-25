import type { AdminRequestLogsResponse } from "@timedata/shared";
import {
  AdminRequestLogClientHintSchema,
  AdminRequestLogOutcomeSchema,
  AdminRequestLogTokenTierSchema,
} from "@timedata/shared";
import { Hono } from "hono";
import { z } from "zod";
import { queryRequestLogs } from "../../lib/requestLog.js";
import { validateQuery } from "../../middleware/validate.js";

const requestLogs = new Hono();

const requestLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  status: z.coerce.number().int().optional(),
  outcome: AdminRequestLogOutcomeSchema.optional(),
  tokenTier: AdminRequestLogTokenTierSchema.optional(),
  clientHint: AdminRequestLogClientHintSchema.optional(),
}).strict();

requestLogs.get("/", validateQuery(requestLogsQuerySchema), (c) => {
  const query = c.var.query;
  const response: AdminRequestLogsResponse = {
    logs: queryRequestLogs(query),
    limit: query.limit,
  };

  return c.json(response);
});

export default requestLogs;
