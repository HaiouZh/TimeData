import { z } from "zod";
import { HealthChartConfigSchema } from "./chartSchemas.js";
import {
  CategorySchema,
  GoalLayoutPinSchema,
  GoalSchema,
  QuickNoteSchema,
  SettingSchema,
  TaskSchema,
  TimeEntrySchema,
  TrackSchema,
  TrackStepSchema,
} from "./entitySchemas.js";
import {
  HealthHeartRateSchema, HealthHrvSchema, HealthSleepSchema,
  HealthStressSchema, HealthRunSchema,
} from "./healthSchemas.js";

/** 冲突策略：lww=后写赢自动解决，不进冲突 UI；manual=本地有 pending 修改时弹窗问用户。 */
export type SyncConflictPolicy = "lww" | "manual";

export interface SyncDomainConfig {
  /** 域名 = 服务端表名 = SyncChange.tableName */
  table: string;
  /** upsert payload 的运行时校验 */
  dataSchema: z.ZodTypeAny;
  /** push 批内 upsert 的应用顺序（小者先），保证外键依赖先落库 */
  upsertPriority: number;
  /** push 批内 delete 的应用顺序（大者后），保证 category delete 最后 */
  deletePriority: number;
  conflictPolicy: SyncConflictPolicy;
  /** 是否计入 /api/sync/status 的 counts 与 contentHash 行数摘要 */
  countsInStatus: boolean;
}

export const SYNC_DOMAINS: readonly SyncDomainConfig[] = [
  {
    table: "categories",
    dataSchema: CategorySchema,
    upsertPriority: 10,
    deletePriority: 50,
    conflictPolicy: "manual",
    countsInStatus: true,
  },
  {
    table: "time_entries",
    dataSchema: TimeEntrySchema,
    upsertPriority: 20,
    deletePriority: 20,
    conflictPolicy: "manual",
    countsInStatus: true,
  },
  {
    table: "settings",
    dataSchema: SettingSchema,
    upsertPriority: 30,
    deletePriority: 30,
    conflictPolicy: "lww",
    countsInStatus: false,
  },
  {
    table: "quick_notes",
    dataSchema: QuickNoteSchema,
    upsertPriority: 40,
    deletePriority: 40,
    conflictPolicy: "lww",
    countsInStatus: true,
  },
  {
    table: "tasks",
    dataSchema: TaskSchema,
    upsertPriority: 45,
    deletePriority: 45,
    conflictPolicy: "lww",
    countsInStatus: false,
  },
  {
    table: "health_heart_rate",
    dataSchema: HealthHeartRateSchema,
    upsertPriority: 50,
    deletePriority: 50,
    conflictPolicy: "lww",
    countsInStatus: false,
  },
  {
    table: "health_hrv",
    dataSchema: HealthHrvSchema,
    upsertPriority: 51,
    deletePriority: 51,
    conflictPolicy: "lww",
    countsInStatus: false,
  },
  {
    table: "health_sleep",
    dataSchema: HealthSleepSchema,
    upsertPriority: 52,
    deletePriority: 52,
    conflictPolicy: "lww",
    countsInStatus: false,
  },
  {
    table: "health_stress",
    dataSchema: HealthStressSchema,
    upsertPriority: 53,
    deletePriority: 53,
    conflictPolicy: "lww",
    countsInStatus: false,
  },
  {
    table: "runs",
    dataSchema: HealthRunSchema,
    upsertPriority: 54,
    deletePriority: 54,
    conflictPolicy: "lww",
    countsInStatus: false,
  },
  {
    table: "health_charts",
    dataSchema: HealthChartConfigSchema,
    upsertPriority: 60,
    deletePriority: 60,
    conflictPolicy: "lww",
    countsInStatus: false,
  },
  {
    table: "tracks",
    dataSchema: TrackSchema,
    upsertPriority: 70,
    deletePriority: 71,
    conflictPolicy: "lww",
    countsInStatus: false,
  },
  {
    table: "track_steps",
    dataSchema: TrackStepSchema,
    upsertPriority: 71,
    deletePriority: 70,
    conflictPolicy: "lww",
    countsInStatus: false,
  },
  {
    table: "goals",
    dataSchema: GoalSchema,
    upsertPriority: 72,
    deletePriority: 72,
    conflictPolicy: "lww",
    countsInStatus: false,
  },
  {
    table: "goal_layout_pins",
    dataSchema: GoalLayoutPinSchema,
    upsertPriority: 73,
    deletePriority: 73,
    conflictPolicy: "lww",
    countsInStatus: false,
  },
];

export const SYNC_TABLE_NAMES = SYNC_DOMAINS.map((domain) => domain.table) as [string, ...string[]];

export function getSyncDomain(table: string, registry: readonly SyncDomainConfig[] = SYNC_DOMAINS): SyncDomainConfig {
  const domain = registry.find((item) => item.table === table);
  if (!domain) throw new Error(`Unknown sync domain: ${table}`);
  return domain;
}

/** 按登记簿生成 SyncChange 的运行时校验（每域 upsert + delete 两个成员的判别联合）。 */
export function buildSyncChangeSchema(timestampSchema: z.ZodTypeAny): z.ZodTypeAny {
  const base = z.object({ recordId: z.string().min(1), timestamp: timestampSchema });
  const members = SYNC_DOMAINS.flatMap((domain) => [
    base.extend({ tableName: z.literal(domain.table), action: z.enum(["create", "update"]), data: domain.dataSchema }),
    base.extend({ tableName: z.literal(domain.table), action: z.literal("delete"), data: z.null() }),
  ]);
  return z.union(members as never as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}
