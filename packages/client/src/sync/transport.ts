import type { SyncRequestReason } from "./scheduler.js";

export type SyncTransport = "web" | "native-android";

export interface SelectSyncTransportOptions {
  platform: string;
  reason?: SyncRequestReason;
}

export function selectSyncTransport({ platform, reason }: SelectSyncTransportOptions): SyncTransport {
  return platform === "android" && reason === "resume" ? "native-android" : "web";
}
