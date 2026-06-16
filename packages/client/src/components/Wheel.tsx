import { useEffect, useMemo, useRef } from "react";

interface WheelProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}

interface WheelOption {
  key: string;
  value: string;
}

const REPEAT_COUNT = 11;
const ITEM_HEIGHT = 34;

export function wheelScrollTopForIndex(index: number): number {
  return index * ITEM_HEIGHT;
}

export function wheelIndexFromScrollTop(scrollTop: number): number {
  return Math.round(scrollTop / ITEM_HEIGHT);
}

export function Wheel({ value, options, onChange, ariaLabel }: WheelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const normalizedValue = options.includes(value) ? value : options[0];
  const allOptions = useMemo<WheelOption[]>(
    () =>
      Array.from({ length: REPEAT_COUNT }, (_, repeatIndex) =>
        options.map((option) => ({ key: `${repeatIndex}:${option}`, value: option })),
      ).flat(),
    [options],
  );
  const middleSetStart = Math.floor(REPEAT_COUNT / 2) * options.length;

  useEffect(() => {
    const selectedIndex = options.indexOf(normalizedValue);
    const container = containerRef.current;
    if (!container || selectedIndex < 0) return;

    const targetIndex = middleSetStart + selectedIndex;
    const targetTop = wheelScrollTopForIndex(targetIndex);

    if (Math.abs(container.scrollTop - targetTop) > ITEM_HEIGHT / 2) {
      container.scrollTop = targetTop;
    }
  }, [middleSetStart, normalizedValue, options]);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    };
  }, []);

  function settle() {
    const container = containerRef.current;
    if (!container) return;

    const rawIndex = wheelIndexFromScrollTop(container.scrollTop);
    const optionIndex = ((rawIndex % options.length) + options.length) % options.length;
    const next = options[optionIndex];
    const normalizedIndex = middleSetStart + optionIndex;

    container.scrollTo({ top: wheelScrollTopForIndex(normalizedIndex), behavior: "smooth" });

    if (next !== normalizedValue) {
      onChange(next);
    }
  }

  function handleScroll() {
    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = window.setTimeout(settle, 70);
  }

  return (
    <div className="relative h-[102px] overflow-hidden rounded-lg bg-slate-950">
      <div className="pointer-events-none absolute inset-x-1 top-1/2 z-10 h-[34px] -translate-y-1/2 rounded-md border border-blue-400/60 bg-blue-400/10" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-slate-950 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-slate-950 to-transparent" />
      <div
        ref={containerRef}
        role="listbox"
        aria-label={ariaLabel}
        onScroll={handleScroll}
        className="wheel-scroll h-full overflow-y-auto snap-y snap-mandatory py-[34px] overscroll-contain"
      >
        {allOptions.map((option) => {
          const selected = option.value === normalizedValue;
          return (
            <button
              type="button"
              role="option"
              aria-selected={selected}
              key={option.key}
              onClick={() => onChange(option.value)}
              className={`block h-[34px] w-full snap-center text-center text-base tabular-nums transition-colors ${
                selected ? "font-semibold text-slate-50" : "text-slate-500"
              }`}
            >
              {option.value}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default Wheel;
