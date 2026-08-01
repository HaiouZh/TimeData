import type { SyncRequestReason } from "./scheduler.js";

export type SyncTransport = "web" | "native-android";

export interface SelectSyncTransportOptions {
  platform: string;
  reason?: SyncRequestReason;
  nativeHttpAvailable?: boolean;
}

export function selectSyncTransport({ platform, reason, nativeHttpAvailable = true }: SelectSyncTransportOptions): SyncTransport {
  return platform === "android" && reason === "resume" && nativeHttpAvailable ? "native-android" : "web";
}
