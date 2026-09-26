// 导航图标右上角的计数 badge（如轨道「待我处理」回手数）。count<=0 不渲染。
export function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      data-testid="nav-badge"
      aria-hidden="true"
      className="absolute -right-2 -top-1 inline-flex min-w-4 items-center justify-center rounded-pill bg-accent px-1 td-text-caption text-page"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

// 导航图标右上角的告警红点（如「设置」入口的异地冷备异常）。不带数字，只表示「进去有东西要看」。
export function NavAlertDot({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      data-testid="nav-alert-dot"
      aria-hidden="true"
      className="absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-pill bg-danger ring-2 ring-surface-elevated"
    />
  );
}
