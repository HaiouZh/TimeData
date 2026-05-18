import { addDays, formatWeekday, getDateString } from "../lib/time.ts";

interface DateNavProps {
  date: string;
  onDateChange: (date: string) => void;
}

export default function DateNav({ date, onDateChange }: DateNavProps) {
  const today = getDateString(new Date());
  const isToday = date === today;
  const weekday = formatWeekday(date);

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-slate-900">
      <button onClick={() => onDateChange(addDays(date, -1))} className="px-3 py-1 text-slate-400 hover:text-slate-200">
        ←
      </button>
      <div className="text-center">
        <span className="text-lg font-medium">{date}</span>
        <span className="ml-2 text-sm text-slate-400">{isToday ? "今天" : weekday}</span>
      </div>
      <button
        onClick={() => onDateChange(addDays(date, 1))}
        className="px-3 py-1 text-slate-400 hover:text-slate-200"
        disabled={isToday}
      >
        →
      </button>
    </div>
  );
}
