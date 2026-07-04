/** 把 YYYY-MM-DD 转成菜单/确认框用的短标签：今天 或 M月D日。 */
export function formatJumpDateLabel(date: string, today: string): string {
  if (date === today) return "今天";
  const [, month, day] = date.split("-");
  return `${Number(month)}月${Number(day)}日`;
}
