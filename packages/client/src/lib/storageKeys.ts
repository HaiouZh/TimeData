export const STORAGE_KEYS = {
  apiUrl: "timedata_api_url",
  apiToken: "timedata_api_token",
  lastSyncedSeq: "timedata_last_synced_seq",
  // 纯 UI 展示的“上次同步时间”，不参与任何同步判定（cursor 是 lastSyncedSeq）。
  lastSyncDisplayAt: "timedata_last_sync_at",
  syncFailureCount: "timedata_sync_failure_count",
  cloudSyncEnabled: "timedata_cloud_sync_enabled",
  mergeOvernight: "timedata_merge_overnight",
  sleepCategoryId: "timedata_sleep_category_id",
  schemaNormalizationVersion: "timedata_schema_normalization_version",
  todoWorkbenchSplit: "timedata_todo_workbench_split",
  todoDoneCollapsed: "timedata_todo_done_collapsed",
  todoInboxCollapsed: "timedata_todo_inbox_collapsed",
  todoScheduledCollapsed: "timedata_todo_scheduled_collapsed",
  galaxyEngine: "timedata_galaxy_engine",
  goalTrayWidth: "timedata_goal_tray_width",
  syncPhaseTimings: "timedata_sync_phase_timings",
} as const;
