import type { OverviewStarKind } from "@timedata/shared";
import { useState } from "react";
import type { OverviewTally } from "../../lib/overview/overviewModel.js";
import type { OverviewExclusionReason } from "../../lib/overview/overviewStars.js";
import { STAR_KIND_LABELS } from "./overviewGlyphs.js";

/** 四种星在明细里的顺序。 */
const KIND_ORDER: readonly OverviewStarKind[] = ["input", "done", "progress", "recurring"];

/** 不上天的原因在明细里的顺序。 */
const EXCLUSION_ORDER: readonly OverviewExclusionReason[] = [
  "occurrence",
  "child",
  "rule-exhausted",
  "done-old",
  "track-concluded",
  "track-parked",
];

/** 不上天的原因写给人看的样子。 */
export const OVERVIEW_EXCLUSION_LABELS: Record<OverviewExclusionReason, string> = {
  occurrence: "重复的某一次",
  child: "子任务（跟着父任务那颗）",
  "rule-exhausted": "已结束的重复",
  "done-old": "30 天前做完的",
  "track-concluded": "已结束的轨道",
  "track-parked": "已归档的轨道",
};

/** 全貌底部对账面板：默认收起，点开逐行对账。 */
export function OverviewTallyPanel(props: { tally: OverviewTally }): React.JSX.Element {
  const { tally } = props;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="self-start rounded-ctl px-2 py-1.5 td-text-label text-ink-2 transition hover:bg-surface-hover hover:text-ink">
        怎么算的
      </button>
      {open && (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3 td-text-caption text-ink-2">
          <p className="td-text-body text-ink">{`天上 ${tally.totalStars} 颗：亮着 ${tally.litStars}，暗处 ${tally.darkStars}`}</p>
          <ul className="flex flex-col gap-1">
            {KIND_ORDER.map((kind) => (
              <li key={kind}>{`${STAR_KIND_LABELS[kind]} ${tally.starsByKind[kind]} 颗`}</li>
            ))}
          </ul>
          <div className="flex flex-col gap-1">
            <p className="td-text-label text-ink">不上天的</p>
            <ul className="flex flex-col gap-1">
              {EXCLUSION_ORDER.map((reason) => (
                <li key={reason}>{`${OVERVIEW_EXCLUSION_LABELS[reason]}：${tally.exclusions[reason]}`}</li>
              ))}
            </ul>
          </div>
          <p>{`目标里指向已删除东西的 ${tally.danglingMemberRefs} 处`}</p>
          <p>{`归档的目标 ${tally.archivedGoals} 个（不成团）`}</p>
        </div>
      )}
    </div>
  );
}
