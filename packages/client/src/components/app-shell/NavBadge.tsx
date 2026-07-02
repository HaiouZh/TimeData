// 导航图标右上角的计数 badge（如轨道「待我处理」回手数）。count<=0 不渲染。
export function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      data-testid="nav-badge"
      aria-hidden="true"
      className="absolute -right-2 -top-1 inline-flex min-w-4 items-center justify-center rounded-pill bg-accent px-1 td-text-caption leading-none text-page"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
