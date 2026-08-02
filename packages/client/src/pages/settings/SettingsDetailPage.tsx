import type { ReactNode } from "react";
import { PageBackButton } from "../../components/ui/PageBackButton.js";
import { PageHeader } from "../../components/ui/PageHeader.js";

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
      <PageHeader title={title} back={<PageBackButton to={backTo} label={backLabel} />} />
      <div className="space-y-5 p-4">{children}</div>
    </div>
  );
}
