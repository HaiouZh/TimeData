import { z } from "zod";
import { NonEmptyTrimmedStringSchema, UtcIsoStringSchema } from "./entitySchemas.js";

export const HealthBlockRangeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("inherit") }),
  z.object({ mode: z.literal("recent"), days: z.number().int().positive() }),
  z
    .object({
      mode: z.literal("manual"),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .refine((range) => range.from <= range.to, "from must be before or equal to to"),
  z.object({ mode: z.literal("all") }),
]);

export const ColorRuleSchema = z
  .object({
    fieldId: NonEmptyTrimmedStringSchema,
    operator: z.enum(["lt", "lte", "gt", "gte", "between"]),
    value: z.number().finite(),
    valueTo: z.number().finite().optional(),
    tone: z.enum(["bad", "warn", "good", "info"]),
  })
  .refine(
    (rule) => rule.operator !== "between" || (rule.valueTo != null && rule.value <= rule.valueTo),
    "between requires valueTo >= value",
  );

const yAxisSchema = z.union([
  z.literal("auto"),
  z
    .object({ min: z.number().finite().optional(), max: z.number().finite().optional() })
    .refine((axis) => axis.min != null || axis.max != null, "manual yAxis requires min or max"),
]);

export const BlockPresentationSchema = z.object({
  exportEnabled: z.boolean().optional(),
  colorRules: z.array(ColorRuleSchema).optional(),
  height: z.number().positive().optional(),
  yAxis: yAxisSchema.optional(),
});

const blockBase = {
  id: NonEmptyTrimmedStringSchema,
  title: z.string(),
  order: z.number().int(),
  range: HealthBlockRangeSchema,
  presentation: BlockPresentationSchema,
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
};

export const StatBlockSchema = z.object({
  ...blockBase,
  view: z.literal("stat"),
  source: z.literal("derived"),
  metricIds: z.array(z.string().min(1)).min(1),
});

export const ChartBlockSchema = z.object({
  ...blockBase,
  view: z.literal("chart"),
  source: z.enum(["healthMetricDaily", "runs"]),
  metricIds: z.array(z.string().min(1)).min(1),
  chartKind: z.enum(["line", "area", "bar"]),
  trendMode: z.enum(["auto", "normalized", "raw"]),
  rollingWindows: z.array(z.number().int().positive()),
  showAverageLine: z.boolean(),
});

export const TableBlockSchema = z.object({
  ...blockBase,
  view: z.literal("table"),
  source: z.enum(["healthMetricDaily", "runs"]),
  columnIds: z.array(z.string().min(1)).min(1),
  rollingWindows: z.array(z.number().int().positive()),
  showRawColumns: z.boolean(),
  showRollingColumns: z.boolean(),
  hideEmptyRows: z.boolean(),
  maxRows: z.number().int().positive().nullable(),
});

export const HealthChartConfigSchema = z.discriminatedUnion("view", [StatBlockSchema, ChartBlockSchema, TableBlockSchema]);

export type StatBlock = z.infer<typeof StatBlockSchema>;
export type ChartBlock = z.infer<typeof ChartBlockSchema>;
export type TableBlock = z.infer<typeof TableBlockSchema>;
export type HealthChartConfig = z.infer<typeof HealthChartConfigSchema>;
export type HealthChartConfigDraft<T extends HealthChartConfig = HealthChartConfig> = T extends HealthChartConfig
  ? Omit<T, "id" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: string }
  : never;
export type HealthChartBlockView = HealthChartConfig["view"];
export type HealthBlockRange = z.infer<typeof HealthBlockRangeSchema>;
export type BlockPresentation = z.infer<typeof BlockPresentationSchema>;
export type ColorRule = z.infer<typeof ColorRuleSchema>;
