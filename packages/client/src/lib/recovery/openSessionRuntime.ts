import { latestNetTimingSince } from "../../sync/resourceTimingCache.js";
import { CURRENT_BUILD_ID } from "../frontendUpdate.js";
import { createOpenSessionTracker } from "./openSession.js";
import { stashPendingReport, takeDroppedReportCount } from "./pendingReports.js";
import { newReportId } from "./reportId.js";

/** 真实依赖装配的打开会话收集器单例。逻辑与用例在 openSession.ts，这里只接线。 */
export const openSessions = createOpenSessionTracker({
  now: () => performance.now(),
  wallNow: () => Date.now(),
  build: CURRENT_BUILD_ID,
  newId: () => newReportId(),
  stash: (report) => {
    stashPendingReport(report);
  },
  takeDropped: () => takeDroppedReportCount(),
  netTiming: (sinceMs) => latestNetTimingSince("status", sinceMs),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
});
