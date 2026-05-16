import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface SettingsDetailPageProps {
  title: string;
  backTo?: string;
  backLabel?: string;
  children: ReactNode;
}

export default function SettingsDetailPage({ title, backTo = "/settings", backLabel = "返回设置", children }: SettingsDetailPageProps) {
  return (
    <div className="min-h-full bg-slate-950 text-slate-100">
      <div className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <Link to={backTo} className="text-sm text-blue-400 hover:text-blue-300">{backLabel}</Link>
        <h2 className="mt-2 text-lg font-medium">{title}</h2>
      </div>
      <div className="space-y-5 p-4">
        {children}
      </div>
    </div>
  );
}
