import type { OverviewCluster } from "../../lib/overview/overviewModel.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { OverviewClusterBox } from "./OverviewClusterBox.js";
import type { OpenStarHandler } from "./OverviewStarList.js";

/** 全貌宽屏天空：把所有团排成网格，散着那团占满一行。 */
export function OverviewSky(props: {
  clusters: readonly OverviewCluster[];
  onOpenStar: OpenStarHandler;
}): React.JSX.Element {
  const { clusters, onOpenStar } = props;
  if (clusters.length === 0) {
    return <EmptyState title="天上还没有星星" description="在上面丢一条进来" />;
  }
  return (
    <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3">
      {clusters.map((cluster) => (
        <li key={cluster.key} className={cluster.kind === "loose" ? "col-span-full" : undefined}>
          <OverviewClusterBox cluster={cluster} onOpenStar={onOpenStar} />
        </li>
      ))}
    </ul>
  );
}
