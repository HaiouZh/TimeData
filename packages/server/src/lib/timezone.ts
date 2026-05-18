import { APP_TIME_ZONE } from "@timedata/shared";
export { APP_TIME_ZONE };

export function toAppLocalDateTimeString(value: Date): string {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(value);

  const get = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get(dateParts, "year")}-${get(dateParts, "month")}-${get(dateParts, "day")}T${get(timeParts, "hour")}:${get(timeParts, "minute")}:${get(timeParts, "second")}`;
}

export function currentAppLocalDateTimeString(): string {
  return toAppLocalDateTimeString(new Date());
}
