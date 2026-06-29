/**
 * 共享重力日期 helper：TodoPage 和设置页共用同一口径，避免日期/时区边界漂移。
 */

export function msUntilNextLocalDay(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1, next.getTime() - now.getTime());
}

export function currentGravityDate(): Date {
  return new Date(Date.now());
}