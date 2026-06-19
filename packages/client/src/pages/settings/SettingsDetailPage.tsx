import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "@phosphor-icons/react";
import { Icon } from "../../components/Icon.js";

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
    <div className="min-h-full bg-slate-950 text-slate-100">
      <div className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/80 px-4 py-3 backdrop-blur">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-slate-200"
        >
          <Icon icon={ArrowLeft} size={16} />
          {backLabel}
        </Link>
        <h2 className="mt-1.5 text-xl font-semibold text-slate-100">{title}</h2>
      </div>
      <div className="space-y-5 p-4">{children}</div>
    </div>
  );
}
