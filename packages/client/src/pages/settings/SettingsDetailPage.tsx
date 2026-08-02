import type { ReactNode } from "react";
import { PageBackButton } from "../../components/ui/PageBackButton.js";

interface SettingsDetailPageProps {
  title: string;
  backTo?: string;
  backLabel?: string;
  children: ReactNode;
}

export default function SettingsDetailPage({
  title,
  backTo = "/settings",
  backLabel = "返回设置",
  children,
}: SettingsDetailPageProps) {
  return (
    <div className="min-h-full bg-page text-ink">
      <div className="sticky top-0 z-20 border-b border-border bg-page/80 px-4 py-3 backdrop-blur">
        <PageBackButton to={backTo} label={backLabel} />
        <h2 className="mt-1.5 td-text-title text-ink">{title}</h2>
      </div>
      <div className="space-y-5 p-4">{children}</div>
    </div>
  );
}
