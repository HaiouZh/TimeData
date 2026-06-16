import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { buildMonthGrid } from "../lib/calendar.ts";
import { addMonths, getDateString } from "../lib/time.ts";
import { Icon } from "./Icon.tsx";

interface MonthCalendarProps {
  value: string | null;
  onChange: (date: string) => void;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;

function monthKeyFromDate(date: string): string {
  return date.slice(0, 7);
}

function currentMonthKey(): string {
  return monthKeyFromDate(getDateString(new Date()));
}

function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

function padTrailingBlanks(cells: (number | null)[]): (number | null)[] {
  const remainder = cells.length % 7;
  if (remainder === 0) return cells;
  return [...cells, ...Array.from({ length: 7 - remainder }, () => null)];
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthLabel(year: number, month: number): string {
  return `${year}年${month}月`;
}

const navButtonClass =
  "flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";

function dayButtonClass(selected: boolean, today: boolean): string {
  const base =
    "flex aspect-square min-h-9 w-full items-center justify-center rounded-lg border text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";

  if (selected) return `${base} border-sky-400/70 bg-sky-500/20 font-semibold text-sky-50`;
  if (today) return `${base} border-slate-600 bg-slate-950/80 text-slate-100`;
  return `${base} border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-600 hover:bg-slate-800`;
}

export function MonthCalendar({ value, onChange }: MonthCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => monthKeyFromDate(value ?? getDateString(new Date())));

  useEffect(() => {
    if (value) setVisibleMonth(monthKeyFromDate(value));
  }, [value]);

  const { year, month } = parseMonthKey(visibleMonth);
  const today = currentMonthKey() === visibleMonth ? getDateString(new Date()) : null;
  const cells = useMemo(() => padTrailingBlanks(buildMonthGrid(year, month)), [year, month]);
  const viewCells = useMemo(() => {
    let blankOrdinal = 0;
    return cells.map((day) => {
      if (day === null) {
        blankOrdinal += 1;
        return { key: `blank:${visibleMonth}:${blankOrdinal}`, day };
      }
      return { key: formatDate(year, month, day), day };
    });
  }, [cells, month, visibleMonth, year]);

  function moveMonth(offset: number): void {
    setVisibleMonth(monthKeyFromDate(addMonths(`${visibleMonth}-01`, offset)));
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-slate-100" aria-label="月历">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button type="button" aria-label="上个月" onClick={() => moveMonth(-1)} className={navButtonClass}>
          <Icon icon={CaretLeft} size={18} weight="bold" />
        </button>
        <div className="text-sm font-semibold text-slate-100">{monthLabel(year, month)}</div>
        <button type="button" aria-label="下个月" onClick={() => moveMonth(1)} className={navButtonClass}>
          <Icon icon={CaretRight} size={18} weight="bold" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday}>{weekday}</div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1">
        {viewCells.map(({ day, key }) => {
          if (day === null) {
            return <div key={key} aria-hidden="true" className="aspect-square min-h-9 rounded-lg" />;
          }

          const date = formatDate(year, month, day);
          const selected = value === date;

          return (
            <button
              type="button"
              key={key}
              aria-label={date}
              aria-pressed={selected}
              onClick={() => onChange(date)}
              className={dayButtonClass(selected, today === date)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default MonthCalendar;
