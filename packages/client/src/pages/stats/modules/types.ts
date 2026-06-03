import type { Category, TimeEntry } from "@timedata/shared";
import type { ComponentType } from "react";
import type { StatsViewMode } from "../../../lib/stats.ts";

export type StatsModuleId = "overview" | "routine" | "anomalies" | "trend" | "structure";

export const STATS_MODULE_IDS: StatsModuleId[] = ["overview", "routine", "anomalies", "trend", "structure"];

export interface StatsEffectiveRange {
  fromDate: string;
  toDate: string;
  startUtc: string;
  endUtc: string;
}

export interface StatsModuleProps {
  mode: StatsViewMode;
  today: string;
  effectiveRange: StatsEffectiveRange;
  baselineFrom: string;
  entries: TimeEntry[];
  baselineEntries: TimeEntry[];
  categories: Category[];
  parentCategories: Category[];
  parentNameById: Map<string, string>;
  sleepCategoryId: string | null;
}

export interface StatsModuleDescriptor {
  id: StatsModuleId;
  defaultVisible: boolean;
}

export interface StatsModuleDef extends StatsModuleDescriptor {
  title: string;
  eyebrow: string;
  description: string;
  needs?: { baseline?: boolean; sleepCategory?: boolean };
  component: ComponentType<StatsModuleProps>;
}
