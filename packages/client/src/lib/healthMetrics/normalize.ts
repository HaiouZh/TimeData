export function normalizeTo100(values: Array<number | null>): Array<number | null> {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (present.length === 0) return values.map(() => null);
  if (present.length === 1) return values.map((value) => (value == null ? null : 50));
  const min = Math.min(...present);
  const max = Math.max(...present);
  if (min === max) return values.map((value) => (value == null ? null : 50));
  return values.map((value) => (value == null ? null : Math.round(((value - min) / (max - min)) * 100)));
}
