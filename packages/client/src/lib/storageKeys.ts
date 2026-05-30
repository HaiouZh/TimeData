export const STORAGE_KEYS = {
  apiUrl: "timedata_api_url",
  apiToken: "timedata_api_token",
  lastSynced: "timedata_last_synced",
  lastSyncedSeq: "timedata_last_synced_seq",
  syncFailureCount: "timedata_sync_failure_count",
  legacySnapshotSync: "timedata_legacy_snapshot_sync",
  cloudSyncEnabled: "timedata_cloud_sync_enabled",
  mergeOvernight: "timedata_merge_overnight",
  sleepCategoryId: "timedata_sleep_category_id",
  serverHealthy: "timedata_server_healthy",
} as const;
