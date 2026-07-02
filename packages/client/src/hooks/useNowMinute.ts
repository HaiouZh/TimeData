import { useEffect, useState } from "react";
import { useAppResumeRefresh } from "./useAppResumeRefresh.ts";

// 分钟粒度的“现在”：引用只在跨分钟边界、回前台时更新。
export function useNowMinute(): Date {
  const [now, setNow] = useState(() => new Date());

  useAppResumeRefresh(() => setNow(new Date()));

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      const current = new Date();
      const untilNextMinute = 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds());
      timeoutId = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, Math.max(250, untilNextMinute + 50));
    };

    schedule();
    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, []);

  return now;
}
