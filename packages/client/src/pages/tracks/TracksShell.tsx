import { Outlet } from "react-router-dom";
import { useIsWideScreen } from "../../lib/useIsWideScreen.js";
import { TracksBoard } from "./TracksBoard.js";

// tracks 布局壳：宽屏=左列调度台常驻 + 右栏随路由（/tracks=空态、/tracks/:id=详情）；窄屏=纯透传。
// 数据装载在 TracksBoard 与详情页各自内部，壳只管布局。
export default function TracksShell() {
  const isWideScreen = useIsWideScreen();
  if (!isWideScreen) return <Outlet />;
  return (
    <div className="flex min-h-full bg-page text-ink">
      <aside
        aria-label="轨道调度台"
        className="sticky top-0 h-dvh shrink-0 overflow-y-auto border-r border-border"
        style={{ width: 400 }}
      >
        <TracksBoard />
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
