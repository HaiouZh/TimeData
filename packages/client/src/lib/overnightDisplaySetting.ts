const MERGE_OVERNIGHT_KEY = "timedata_merge_overnight";

export function getMergeOvernightEnabled(): boolean {
  return localStorage.getItem(MERGE_OVERNIGHT_KEY) !== "false";
}

export function setMergeOvernightEnabled(enabled: boolean): void {
  localStorage.setItem(MERGE_OVERNIGHT_KEY, enabled ? "true" : "false");
}
