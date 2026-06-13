import { z } from "zod";
import { CategorySchema, QuickNoteSchema, SettingSchema, TimeEntrySchema } from "./entitySchemas.js";

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
];

export const SYNC_TABLE_NAMES = SYNC_DOMAINS.map((domain) => domain.table) as [string, ...string[]];

export function getSyncDomain(table: string): SyncDomainConfig {
  const domain = SYNC_DOMAINS.find((item) => item.table === table);
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
