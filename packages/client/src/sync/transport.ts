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

/** 安卓且原生 HTTP 插件可用：同步请求走 WebView + 原生双车道（ADR 0038）。 */
export function supportsDualLane({ platform, nativeHttpAvailable = true }: { platform: string; nativeHttpAvailable?: boolean }): boolean {
  return platform === "android" && nativeHttpAvailable;
}
