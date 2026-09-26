import fs from "node:fs";
import path from "node:path";
import {
  type AdminOffsiteBackupResponse,
  type OffsiteBackupRun,
  OffsiteBackupRunSchema,
  type OffsiteBackupVerdict,
} from "@timedata/shared";
import { getDbPath } from "../db/connection.js";

// 判定口径与 Run 仓 backend/run_track/api/system.py 的 backup_verdict 保持一致，改阈值要两边一起改。
export const OFFSITE_BACKUP_STALE_MS = 36 * 60 * 60 * 1000;
export const OFFSITE_BACKUP_RECENT_LIMIT = 7;
// 一天一行、每行约 200 字节；读尾部 64KB 足够覆盖 recent，文件再长也不整读。
const TAIL_BYTES = 64 * 1024;

export function getOffsiteBackupRunsPath(): string {
  return path.join(path.dirname(getDbPath()), "backup_runs.jsonl");
}

/** 读 backup_runs.jsonl 尾部；不存在返回 null（本地开发常态）。 */
export function readOffsiteBackupRunsTail(filePath = getOffsiteBackupRunsPath()): string | null {
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString("utf8");
    // 从中间截断时首行是半行，丢掉
    if (start > 0) text = text.slice(text.indexOf("\n") + 1);
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function parseRuns(text: string): OffsiteBackupRun[] {
  const runs: OffsiteBackupRun[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = OffsiteBackupRunSchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) runs.push(parsed.data);
    } catch {
      // 坏行跳过；全坏由调用方判 failed
    }
  }
  return runs;
}

function judge(last: OffsiteBackupRun, nowMs: number): { verdict: OffsiteBackupVerdict; reason: string | null } {
  const atMs = Date.parse(last.at);
  if (Number.isNaN(atMs)) return { verdict: "failed", reason: "推送时间无法解析" };
  // cron 停了就不再写新行，最后一行永远是上次的成功——必须先于 ok 单独判
  if (nowMs - atMs > OFFSITE_BACKUP_STALE_MS) return { verdict: "stale", reason: "超过 36 小时没有新的推送记录" };
  if (!last.ok) return { verdict: "failed", reason: last.error || "推送失败（未给出原因）" };
  if (last.remote === null) return { verdict: "failed", reason: "读不到冷备机快照状态" };
  const [status, snapshotAt] = last.remote.trim().split(/\s+/);
  if (status !== "OK") return { verdict: "failed", reason: `冷备机快照状态异常：${last.remote}` };
  const snapshotMs = snapshotAt ? Date.parse(snapshotAt) : Number.NaN;
  if (Number.isNaN(snapshotMs)) return { verdict: "failed", reason: "冷备机快照时间无法解析" };
  if (nowMs - snapshotMs > OFFSITE_BACKUP_STALE_MS) return { verdict: "failed", reason: "冷备机快照超过 36 小时没跑" };
  return { verdict: "ok", reason: null };
}

/** 纯函数：文件文本 + 当前时刻 → 接口响应。text 为 null / 空白 → none。 */
export function buildOffsiteBackupStatus(text: string | null, now: Date): AdminOffsiteBackupResponse {
  if (text === null || text.trim() === "") return { verdict: "none", reason: null, last: null, recent: [] };
  const runs = parseRuns(text);
  const last = runs.at(-1) ?? null;
  const recent = runs.slice(-OFFSITE_BACKUP_RECENT_LIMIT).reverse();
  if (last === null) return { verdict: "failed", reason: "冷备记录无法解析", last: null, recent };
  return { ...judge(last, now.getTime()), last, recent };
}
