import { useCallback, useMemo } from "react";
import type { TrendChartKind } from "../pages/stats/InsightCharts.tsx";
import type { TrendWindowSpec } from "./insights/trends.ts";
import { getSetting, setSetting, useSetting } from "./settings/index.ts";

export const STATS_MODULE_TREND_KEY = "stats.module.trend.v1";

export interface StatsModuleTrendConfigV1 {
  window: TrendWindowSpec;
  chart: TrendChartKind;
}

export const DEFAULT_TREND_CONFIG: StatsModuleTrendConfigV1 = {
  window: { kind: "preset", days: 7 },
  chart: "line",
};

function parseConfig(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sanitizeWindow(raw: unknown): TrendWindowSpec {
  const window =
    raw && typeof raw === "object" ? (raw as { kind?: unknown; days?: unknown; from?: unknown; to?: unknown }) : null;
  if (window?.kind === "preset" && isPositiveFiniteNumber(window.days)) {
    return { kind: "preset", days: window.days };
  }
  if (window?.kind === "customDays" && isPositiveFiniteNumber(window.days)) {
    return { kind: "customDays", days: window.days };
  }
  if (window?.kind === "customRange" && typeof window.from === "string" && typeof window.to === "string") {
    return { kind: "customRange", from: window.from, to: window.to };
  }
  return DEFAULT_TREND_CONFIG.window;
}

export function sanitizeTrendConfig(raw: unknown): StatsModuleTrendConfigV1 {
  const config = raw && typeof raw === "object" ? (raw as { window?: unknown; chart?: unknown }) : null;
  return {
    window: sanitizeWindow(config?.window),
    chart: config?.chart === "area" || config?.chart === "line" ? config.chart : "line",
  };
}

export async function getTrendConfig(): Promise<StatsModuleTrendConfigV1> {
  return sanitizeTrendConfig(parseConfig(await getSetting(STATS_MODULE_TREND_KEY)));
}

export function setTrendConfig(config: StatsModuleTrendConfigV1): Promise<void> {
  return setSetting(STATS_MODULE_TREND_KEY, JSON.stringify(config));
}

export function useTrendConfig(): {
  config: StatsModuleTrendConfigV1;
  setConfig: (config: StatsModuleTrendConfigV1) => void;
} {
  const raw = useSetting(STATS_MODULE_TREND_KEY);
  const config = useMemo(() => sanitizeTrendConfig(parseConfig(raw)), [raw]);
  const setConfig = useCallback((next: StatsModuleTrendConfigV1) => {
    void setTrendConfig(next);
  }, []);
  return { config, setConfig };
}
