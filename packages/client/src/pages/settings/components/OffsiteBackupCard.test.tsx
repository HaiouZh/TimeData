import type { AdminOffsiteBackupResponse } from "@timedata/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OffsiteBackupCardView } from "./OffsiteBackupCard.js";

const NOW = new Date("2026-09-26T12:00:00Z");
const run = { at: "2026-09-26T09:00:00Z", ok: true, error: null, remote: "OK 2026-09-26T03:00:00Z" };

function render(status: AdminOffsiteBackupResponse | null): string {
  return renderToStaticMarkup(createElement(OffsiteBackupCardView, { status, now: NOW }));
}

describe("OffsiteBackupCardView", () => {
  it("none / 无状态不渲染", () => {
    expect(render(null)).toBe("");
    expect(render({ verdict: "none", reason: null, last: null, recent: [] })).toBe("");
  });

  it("ok 时安静一行显示最近推送的相对时间，不报警", () => {
    const html = render({ verdict: "ok", reason: null, last: run, recent: [run] });
    expect(html).toContain('data-offsite-backup="ok"');
    expect(html).toContain("最近推送 3小时前");
    expect(html).not.toContain('role="alert"');
  });

  it("stale / failed 时红色告警卡带原因与最近推送时间", () => {
    const stale = render({ verdict: "stale", reason: "超过 36 小时没有新的推送记录", last: run, recent: [run] });
    expect(stale).toContain('role="alert"');
    expect(stale).toContain('data-tone="danger"');
    expect(stale).toContain("异地冷备停了：超过 36 小时没有新的推送记录");
    expect(stale).toContain("最近一次推送");

    const failed = render({ verdict: "failed", reason: "rsync 超时", last: run, recent: [run] });
    expect(failed).toContain("异地冷备失败：rsync 超时");
  });
});
