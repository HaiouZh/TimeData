import { localDateString } from "@timedata/shared";
import type { GoalOverview } from "../../lib/goalsView.js";

export interface GoalSummaryLines {
  momentum: string;
  frontline: string;
  completion: string;
}

function datePart(iso: string): string {
  // 用设备本地日历日，与候选列表排期日期同口径；避免 UTC 截断把凌晨活动显示成前一天。
  return localDateString(new Date(iso));
}

export function goalSummaryLines(overview: GoalOverview): GoalSummaryLines {
  const { goal, members, momentum, progress, sections } = overview;
  const momentumText =
    momentum.activeMemberCount > 0 && momentum.lastActivityAt
      ? `在动 · 最近 ${datePart(momentum.lastActivityAt)}`
      : momentum.lastActivityAt
        ? `近${momentum.windowDays}天没动静 · 上次 ${datePart(momentum.lastActivityAt)}`
        : "还没开始推进";

  const frontline =
    members.length === 0
      ? "还没有成员"
      : sections.ready.length === 0 && sections.blocked.length === 0
        ? "全部完成"
        : `▸ ${sections.ready.length} 能推${sections.blocked.length > 0 ? ` · ${sections.blocked.length} 等前置` : ""}`;

  const completed = sections.completed.length;
  const projectTotal = progress.kind === "project" ? progress.total : 0;
  const completion =
    goal.kind === "project" && projectTotal > 0
      ? `✓ ${completed} 完成 · 共 ${projectTotal} 项`
      : `✓ ${completed} 完成`;

  return { momentum: momentumText, frontline, completion };
}
