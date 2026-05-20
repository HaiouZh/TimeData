import { UtcIsoStringSchema } from "./schemas.js";

export type UtcIsoString = string & { readonly _brand: "UtcIsoString" };
export type LocalDateTimeString = string & { readonly _brand: "LocalDateTimeString" };

export const APP_TIME_ZONE = "Asia/Shanghai";

type DateTimeParts = {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
};

function parseLocalDateTimeParts(value: string): DateTimeParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  if (!y || !mo || !d || !h || !mi || !s) return null;
  return {
    y: Number(y),
    mo: Number(mo),
    d: Number(d),
    h: Number(h),
    mi: Number(mi),
    s: Number(s),
  };
}

function getFormattedPart(parts: Record<string, string>, key: string): string {
  const value = parts[key];
  if (value === undefined) {
    throw new Error(`Missing formatted date part: ${key}`);
  }
  return value;
}

export function isUtcIso(value: unknown): value is UtcIsoString {
  return UtcIsoStringSchema.safeParse(value).success;
}

export function isLocalDateTime(value: unknown): value is LocalDateTimeString {
  if (typeof value !== "string") return false;
  const parts = parseLocalDateTimeParts(value);
  if (!parts) return false;
  const { y, mo, d, h, mi, s } = parts;
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
  const parsed = parseLocalDateTimeParts(localStr);
  if (!parsed) {
    throw new Error("Invalid local date time string");
  }
  const { y, mo, d, h, mi, s } = parsed;

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
  const hour = getFormattedPart(parts, "hour");
  const displayH = hour === "24" ? 0 : Number.parseInt(hour, 10);
  const displayedLocalMs = Date.UTC(
    Number.parseInt(getFormattedPart(parts, "year"), 10),
    Number.parseInt(getFormattedPart(parts, "month"), 10) - 1,
    Number.parseInt(getFormattedPart(parts, "day"), 10),
    displayH,
    Number.parseInt(getFormattedPart(parts, "minute"), 10),
    Number.parseInt(getFormattedPart(parts, "second"), 10),
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
  const hour = getFormattedPart(parts, "hour");
  const hVal = hour === "24" ? "00" : hour;
  return `${getFormattedPart(parts, "year")}-${getFormattedPart(parts, "month")}-${getFormattedPart(parts, "day")}T${hVal}:${getFormattedPart(parts, "minute")}:${getFormattedPart(parts, "second")}` as LocalDateTimeString;
}

export function nowUtcIso(): UtcIsoString {
  return UtcIsoStringSchema.parse(new Date().toISOString()) as UtcIsoString;
}
