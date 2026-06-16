import { weekdayIndex } from "./time.ts";

export function buildMonthGrid(year: number, month: number): (number | null)[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError("buildMonthGrid expects month to be 1..12");
  }

  const monthText = String(month).padStart(2, "0");
  const leadingBlanks = weekdayIndex(`${year}-${monthText}-01`);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
}
