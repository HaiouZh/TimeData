import { CURRENT_BUILD_ID } from "../frontendUpdate.js";
import { stashPendingReport } from "./pendingReports.js";
import { newReportId } from "./reportId.js";
import { createSyncFailureTracker } from "./syncFailureReport.js";

/** 真实依赖装配的同步失败观测单例。逻辑与用例在 syncFailureReport.ts，这里只接线。 */
export const syncFailures = createSyncFailureTracker({
  now: () => Date.now(),
  build: CURRENT_BUILD_ID,
  newId: () => newReportId(),
  stash: (report) => {
    stashPendingReport(report);
  },
});
