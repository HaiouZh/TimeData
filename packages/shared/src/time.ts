import { UtcIsoStringSchema } from "./schemas.js";

export type UtcIsoString = string & { readonly _brand: "UtcIsoString" };
export type LocalDateTimeString = string & { readonly _brand: "LocalDateTimeString" };

export const APP_TIME_ZONE = "Asia/Shanghai";

export function isUtcIso(value: unknown): value is UtcIsoString {
  return UtcIsoStringSchema.safeParse(value).success;
}

export function isLocalDateTime(value: unknown): value is LocalDateTimeString {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const [datePart, timePart] = value.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi, s] = timePart.split(":").map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === mo - 1 &&
    probe.getUTCDate() === d &&
    probe.getUTCHours() === h &&
    probe.getUTCMinutes() === mi &&
    probe.getUTCSeconds() === s
  );
}

export function localDateTimeToUtc(localStr: string, timeZone = APP_TIME_ZONE): UtcIsoString {
  // 把 localStr（YYYY-MM-DDTHH:mm:ss）当作 timeZone 内的挂钟时间，输出 UTC ISO。
  // 算法：先把 localStr 当作 UTC 构造一个 Date（approxUtc），
  // 再用 Intl 求出 approxUtc 在 timeZone 内对应的本地时间，
  // 最后用差值修正得到正确的 UTC。
  // 中国无夏令时，此算法无歧义；带夏令时的时区（如美国）在时钟拨回时可能解析到两者之一。
  const [datePart, timePart] = localStr.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const tParts = timePart.split(":");
  const h = Number(tParts[0]);
  const mi = Number(tParts[1]);
  const s = Number(tParts[2] ?? 0);

  const approxUtc = new Date(Date.UTC(y, mo - 1, d, h, mi, s));

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(approxUtc)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  const displayH = parts.hour === "24" ? 0 : Number.parseInt(parts.hour, 10);
  const displayedLocalMs = Date.UTC(
    Number.parseInt(parts.year, 10),
    Number.parseInt(parts.month, 10) - 1,
    Number.parseInt(parts.day, 10),
    displayH,
    Number.parseInt(parts.minute, 10),
    Number.parseInt(parts.second, 10),
  );

  const targetLocalMs = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetMs = approxUtc.getTime() - displayedLocalMs;

  return UtcIsoStringSchema.parse(new Date(targetLocalMs + offsetMs).toISOString()) as UtcIsoString;
}

export function utcToLocalDateTime(utcStr: string, timeZone = APP_TIME_ZONE): LocalDateTimeString {
  const date = new Date(utcStr);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  const hVal = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hVal}:${parts.minute}:${parts.second}` as LocalDateTimeString;
}

export function nowUtcIso(): UtcIsoString {
  return UtcIsoStringSchema.parse(new Date().toISOString()) as UtcIsoString;
}
