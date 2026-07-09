import { useIsWideScreen } from "../../lib/useIsWideScreen.js";
import { TracksBoard } from "./TracksBoard.js";

// 窄屏：/tracks 就是调度台整页；宽屏：调度台已由 TracksShell 常驻左列，本路由页只出右栏空态。
export default function TracksListPage() {
  const isWideScreen = useIsWideScreen();
  if (isWideScreen) {
    return (
      <div className="flex min-h-full items-center justify-center bg-page px-6 py-16">
        <p className="td-text-body text-ink-3">从左侧选一条轨道查看</p>
      </div>
    );
  }
  return <TracksBoard />;
}
