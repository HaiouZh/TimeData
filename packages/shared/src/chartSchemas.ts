import { z } from "zod";
import { NonEmptyTrimmedStringSchema, UtcIsoStringSchema } from "./entitySchemas.js";

const blockBase = {
  id: NonEmptyTrimmedStringSchema,
  order: z.number().int(),
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
};

export const MetricChartBlockSchema = z.object({
  ...blockBase,
  type: z.literal("metricChart"),
  title: z.string(),
  metricIds: z.array(z.string().min(1)).min(1),
  chartKind: z.enum(["line", "area", "bar"]),
  trendMode: z.enum(["auto", "normalized", "raw"]),
  rollingWindows: z.array(z.number().int().positive()),
  showAverageLine: z.boolean(),
});

export const RunTrendBlockSchema = z.object({
  ...blockBase,
  type: z.literal("runTrend"),
  title: z.string(),
});

export const SummaryBlockSchema = z.object({
  ...blockBase,
  type: z.literal("summary"),
  title: z.string(),
});

export const HealthChartConfigSchema = z.discriminatedUnion("type", [
  MetricChartBlockSchema,
  RunTrendBlockSchema,
  SummaryBlockSchema,
]);

export type MetricChartBlock = z.infer<typeof MetricChartBlockSchema>;
export type HealthChartConfig = z.infer<typeof HealthChartConfigSchema>;
export type HealthChartBlockType = HealthChartConfig["type"];
