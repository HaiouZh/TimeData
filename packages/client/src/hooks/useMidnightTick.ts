import { useEffect, useRef } from "react";

/**
 * Fires `onMidnight` once each time the wall-clock crosses local midnight.
 *
 * The implementation re-schedules a single `setTimeout` for the next midnight
 * after each fire, so it tolerates tab suspension better than a 60s polling
 * interval. The `+1000` cushion avoids edge cases where the timer fires a few
 * milliseconds before midnight.
 */
export function useMidnightTick(onMidnight: () => void): void {
  const onMidnightRef = useRef(onMidnight);
  onMidnightRef.current = onMidnight;

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(24, 0, 0, 0);
      const delay = Math.max(1000, next.getTime() - now.getTime() + 1000);
      timeoutId = setTimeout(() => {
        onMidnightRef.current();
        schedule();
      }, delay);
    };

    schedule();
    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, []);
}
