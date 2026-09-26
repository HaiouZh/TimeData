import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOffsiteBackupStatus, readOffsiteBackupRunsTail } from "./offsiteBackup.js";

const NOW = new Date("2026-09-26T12:00:00Z");

function line(fields: { at: string; ok?: boolean; error?: string | null; remote?: string | null }): string {
  return JSON.stringify({
    at: fields.at,
    ok: fields.ok ?? true,
    error: fields.error ?? null,
    remote: fields.remote === undefined ? `OK ${fields.at} snapshot=2026-09-26 data=1 timedata=1` : fields.remote,
  });
}

describe("buildOffsiteBackupStatus", () => {
  it("文件不存在或为空 → none", () => {
    expect(buildOffsiteBackupStatus(null, NOW).verdict).toBe("none");
    expect(buildOffsiteBackupStatus("  \n", NOW).verdict).toBe("none");
  });

  it("最后一行成功且快照新鲜 → ok，recent 倒序最多 7 行", () => {
    const text = Array.from({ length: 9 }, (_, i) => line({ at: `2026-09-${String(18 + i).padStart(2, "0")}T01:30:00Z` })).join("\n");
    const status = buildOffsiteBackupStatus(`${text}\n`, NOW);
    expect(status.verdict).toBe("ok");
    expect(status.reason).toBeNull();
    expect(status.last?.at).toBe("2026-09-26T01:30:00Z");
    expect(status.recent.map((r) => r.at.slice(8, 10))).toEqual(["26", "25", "24", "23", "22", "21", "20"]);
  });

  it("最后一行是成功但距今超过 36 小时 → stale（cron 停了）", () => {
    const status = buildOffsiteBackupStatus(line({ at: "2026-09-24T23:59:00Z" }), NOW);
    expect(status.verdict).toBe("stale");
    expect(status.reason).toContain("36 小时");
  });

  it("ok=false → failed，原因取 error", () => {
    const status = buildOffsiteBackupStatus(line({ at: "2026-09-26T01:30:00Z", ok: false, error: "rsync 超时" }), NOW);
    expect(status).toMatchObject({ verdict: "failed", reason: "rsync 超时" });
  });

  it("remote 为 null → failed", () => {
    const status = buildOffsiteBackupStatus(line({ at: "2026-09-26T01:30:00Z", remote: null }), NOW);
    expect(status).toMatchObject({ verdict: "failed", reason: "读不到冷备机快照状态" });
  });

  it("remote 首词不是 OK → failed", () => {
    const remote = "PROBLEM 2026-09-26T03:00:00Z snapshot=2026-09-26 disk full";
    const status = buildOffsiteBackupStatus(line({ at: "2026-09-26T01:30:00Z", remote }), NOW);
    expect(status.verdict).toBe("failed");
    expect(status.reason).toContain("PROBLEM");
  });

  it("冷备机快照时刻超过 36 小时 → failed", () => {
    const remote = "OK 2026-09-24T03:00:00Z snapshot=2026-09-24";
    const status = buildOffsiteBackupStatus(line({ at: "2026-09-26T01:30:00Z", remote }), NOW);
    expect(status).toMatchObject({ verdict: "failed", reason: "冷备机快照超过 36 小时没跑" });
  });

  it("坏行跳过；全是坏行 → failed", () => {
    expect(buildOffsiteBackupStatus(`garbage\n${line({ at: "2026-09-26T01:30:00Z" })}\n{bad`, NOW).verdict).toBe("ok");
    expect(buildOffsiteBackupStatus("garbage\n{bad", NOW)).toMatchObject({ verdict: "failed", reason: "冷备记录无法解析" });
  });
});

describe("readOffsiteBackupRunsTail", () => {
  it("不存在返回 null；超长文件只读尾部并丢掉半行", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-offsite-"));
    try {
      const file = path.join(dir, "backup_runs.jsonl");
      expect(readOffsiteBackupRunsTail(file)).toBeNull();
      const lines = Array.from({ length: 1000 }, () => line({ at: "2026-09-26T01:30:00Z" }));
      fs.writeFileSync(file, `${lines.join("\n")}\n`);
      const tail = readOffsiteBackupRunsTail(file) ?? "";
      expect(tail.length).toBeLessThan(64 * 1024);
      for (const l of tail.split("\n").filter(Boolean)) expect(() => JSON.parse(l)).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
