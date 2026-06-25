import type { AdminRequestLogClientHint } from "@timedata/shared";

export function getClientIpFromHeaders(headers: Headers): string | null {
  const realIp = headers.get("X-Real-IP")?.trim();
  if (realIp) return realIp.slice(0, 128);

  const forwardedFor = headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return forwardedFor ? forwardedFor.slice(0, 128) : null;
}

export function normalizeClientHint(value: string | null): AdminRequestLogClientHint {
  return value === "web" || value === "android" || value === "cli" || value === "agent" ? value : "unknown";
}

export function deviceLabelFromHeaders(headers: Headers): string | null {
  const hint = normalizeClientHint(headers.get("X-TimeData-Client"));
  if (hint !== "unknown") return hint;

  const userAgent = (headers.get("User-Agent") ?? "").toLowerCase();
  if (userAgent.includes("android")) return "android";
  if (userAgent.includes("iphone") || userAgent.includes("ipad")) return "ios";
  if (userAgent.includes("mozilla")) return "web";
  return null;
}
