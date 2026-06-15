import { HealthChartConfigSchema, type HealthChartConfig } from "@timedata/shared";

export interface HealthChartRow {
  id: string;
  type: string;
  sort_order: number;
  config: string;
  created_at: string;
  updated_at: string;
}

export function healthChartToRow(data: unknown): Record<string, string | number | null> {
  const block = HealthChartConfigSchema.parse(data);
  return {
    id: block.id,
    type: block.type,
    sort_order: block.order,
    config: JSON.stringify(block),
    created_at: block.createdAt,
  };
}

export function rowToHealthChart(row: HealthChartRow): HealthChartConfig {
  return HealthChartConfigSchema.parse(JSON.parse(row.config));
}
