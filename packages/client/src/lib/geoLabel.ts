/** 把归属地拼成一行展示文本。归属地是按 IP 段推测的大致位置,不是定位。 */
export function geoLabel(country: string | null, city: string | null): string {
  const parts = [country, city].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : "位置未知";
}
