export interface CliValidationError {
  code: "INVALID_DATE" | "INVALID_TIME_RANGE";
  message: string;
}

export function validateDate(value: string): CliValidationError | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { code: "INVALID_DATE", message: `Invalid date: ${value}` };
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { code: "INVALID_DATE", message: `Invalid date: ${value}` };
  }
  return null;
}

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function validateTimeRange(start: string, end: string): CliValidationError | null {
  if (!validTime(start) || !validTime(end)) {
    return { code: "INVALID_TIME_RANGE", message: "Start and end must use HH:mm format" };
  }
  if (minutes(end) <= minutes(start)) {
    return { code: "INVALID_TIME_RANGE", message: "End time must be later than start time" };
  }
  return null;
}

export function todayLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
