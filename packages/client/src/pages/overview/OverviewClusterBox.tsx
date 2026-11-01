import { Link } from "react-router";
import type { OverviewCluster } from "../../lib/overview/overviewModel.js";
import { getDateString } from "../../lib/time.js";
import { StatusChip } from "./overviewGlyphs.js";
import { OverviewStarList, type OpenStarHandler } from "./OverviewStarList.js";

/** 全貌上的一团：团名、状态章、颗数与星。 */
export function OverviewClusterBox(props: {
  cluster: OverviewCluster;
  onOpenStar: OpenStarHandler;
}): React.JSX.Element {
  const { cluster, onOpenStar } = props;
  const total = cluster.litStars.length + cluster.darkStars.length;
  const countText =
    cluster.lastActivityAt === null
      ? `${total} 颗`
      : `${total} 颗 · ${getDateString(new Date(cluster.lastActivityAt)).slice(-5)} 有动静`;

  return (
    <div className="flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="min-w-0 truncate td-text-label text-ink">
          {cluster.kind === "goal" && cluster.goalId !== null ? (
            <Link
              to={`/goals/${encodeURIComponent(cluster.goalId)}`}
              aria-label={`打开目标「${cluster.title}」`}
              className="transition hover:text-accent-ink"
            >
              {cluster.title}
            </Link>
          ) : cluster.kind === "loose" ? (
            "还没归到哪件事"
          ) : (
            cluster.title
          )}
        </h2>
        {cluster.kind === "prefix" && <span className="td-text-caption text-ink-3">按标题归的</span>}
        <StatusChip status={cluster.status} quietDays={cluster.quietDays} />
        <span className="ml-auto td-text-caption text-ink-3">{countText}</span>
      </div>
      <OverviewStarList cluster={cluster} layout="flow" onOpenStar={onOpenStar} />
    </div>
  );
}
