import { useLiveQuery } from "dexie-react-hooks";
import { lazy, Suspense, useMemo } from "react";
import { Outlet, useMatch } from "react-router-dom";
import { listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { groupStepsByTrack, partitionTracks } from "../../lib/tracksView.js";
import { useIsWideScreen } from "../../lib/useIsWideScreen.js";
import { TracksGanttAside } from "./TracksGanttAside.js";

const TracksGanttPanel = lazy(() => import("./TracksGanttPanel.js"));

// tracks 布局壳：宽屏=左列（列表/详情随路由切）+ 右侧甘特常驻；窄屏=纯透传。
// 数据只为甘特而查：窄屏 bail 返回空数组不触 db；列表页保留自身查询（两份轻量观察者，表小可接受）。
export default function TracksShell() {
  const isWideScreen = useIsWideScreen();
  const tracks = useLiveQuery(() => (isWideScreen ? listTracks() : []), [isWideScreen], []);
  const allSteps = useLiveQuery(() => (isWideScreen ? listAllTrackSteps() : []), [isWideScreen], []);
  const { active } = partitionTracks(tracks);
  const byTrack = useMemo(() => groupStepsByTrack(allSteps), [allSteps]);

  if (!isWideScreen) return <Outlet />;
  return (
    <div className="flex min-h-full bg-page text-ink">
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
      <TracksGanttAside>
        <Suspense fallback={<p className="p-4 td-text-caption text-ink-3">正在加载甘特…</p>}>
          <TracksGanttPanel tracks={active} stepsByTrack={byTrack} />
        </Suspense>
      </TracksGanttAside>
    </div>
  );
}
