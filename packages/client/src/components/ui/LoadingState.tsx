export interface LoadingStateProps {
  label?: string;
  className?: string;
}

export function LoadingState({ label = "正在加载…", className }: LoadingStateProps) {
  return (
    <div className={`flex items-center justify-center td-text-body text-ink-3 ${className ?? ""}`}>{label}</div>
  );
}
