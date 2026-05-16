const CLOUD_SYNC_ENABLED_KEY = "timedata_cloud_sync_enabled";
const API_URL_KEY = "timedata_api_url";

export function getCloudSyncEnabled(): boolean {
  const saved = localStorage.getItem(CLOUD_SYNC_ENABLED_KEY);
  if (saved === "true") return true;
  if (saved === "false") return false;
  return Boolean(localStorage.getItem(API_URL_KEY));
}

export function setCloudSyncEnabled(enabled: boolean): void {
  localStorage.setItem(CLOUD_SYNC_ENABLED_KEY, enabled ? "true" : "false");
}
