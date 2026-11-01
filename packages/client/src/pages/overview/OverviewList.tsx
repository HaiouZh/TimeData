import type { OverviewStarKind } from "@timedata/shared";
import { useState } from "react";
import { Link } from "react-router";
import { EmptyState } from "../../components/ui/EmptyState.js";
import type { OverviewCluster } from "../../lib/overview/overviewModel.js";
import { getDateString } from "../../lib/time.js";
import { STAR_KIND_LABELS, StarGlyph, StatusChip } from "./overviewGlyphs.js";
import { type OpenStarHandler, OverviewStarList } from "./OverviewStarList.js";

/** 星种在行里的展示顺序。 */
const KIND_ORDER: readonly OverviewStarKind[] = ["input", "done", "progress", "recurring"];

/** 全貌窄屏清单：一团一行，默认全部收起。 */
export function OverviewList(props: { clusters: readonly OverviewCluster[]; onOpenStar: OpenStarHandler }): React.JSX.Element {
  const { clusters, onOpenStar } = props;
  if (clusters.length === 0) {
    return <EmptyState title="天上还没有星星" description="在上面丢一条进来" />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {clusters.map((cluster) => (
        <OverviewListRow key={cluster.key} cluster={cluster} onOpenStar={onOpenStar} />
      ))}
    </ul>
  );
}

/** 清单里的一行，自带展开状态。 */
function OverviewListRow(props: { cluster: OverviewCluster; onOpenStar: OpenStarHandler }): React.JSX.Element {
  const { cluster, onOpenStar } = props;
  const [open, setOpen] = useState(false);
  const total = cluster.litStars.length + cluster.darkStars.length;
  const countText =
    cluster.lastActivityAt === null
      ? `${total} 颗`
      : `${total} 颗 · ${getDateString(new Date(cluster.lastActivityAt)).slice(-5)} 有动静`;
  const title = cluster.kind === "loose" ? "还没归到哪件事" : cluster.title;
  return (
    <li className="rounded-card border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-card px-3 py-2.5 text-left transition hover:bg-surface-hover"
      >
        <span className="min-w-0 truncate td-text-label text-ink">{title}</span>
        {cluster.kind === "prefix" && <span className="td-text-caption text-ink-3">按标题归的</span>}
        <StatusChip status={cluster.status} quietDays={cluster.quietDays} />
        <span className="inline-flex items-center gap-2 td-text-caption text-ink-2">
          {KIND_ORDER.filter((kind) => cluster.kindCounts[kind] > 0).map((kind) => (
            <span
              key={kind}
              role="img"
              aria-label={`${STAR_KIND_LABELS[kind]}${cluster.kindCounts[kind]} 颗`}
              className="inline-flex items-center gap-1"
            >
              <StarGlyph kind={kind} />
              {cluster.kindCounts[kind]}
            </span>
          ))}
        </span>
        <span className="ml-auto td-text-caption text-ink-3">{countText}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 border-t border-border px-1 pb-2 pt-1">
          {cluster.kind === "goal" && cluster.goalId !== null && (
            <Link
              to={`/goals/${encodeURIComponent(cluster.goalId)}`}
              className="self-start rounded-ctl px-2 py-1.5 td-text-label text-accent-ink transition hover:bg-surface-hover"
            >
              去目标页
            </Link>
          )}
          <OverviewStarList cluster={cluster} layout="rows" onOpenStar={onOpenStar} />
        </div>
      )}
    </li>
  );
}
