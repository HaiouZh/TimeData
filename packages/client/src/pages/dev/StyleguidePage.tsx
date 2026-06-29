import { useState } from "react";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { Switch } from "../../components/ui/Switch.js";

const COLOR_GROUPS: { title: string; tokens: string[] }[] = [
  { title: "中性底盘", tokens: ["--color-page", "--color-surface", "--color-surface-elevated", "--color-surface-hover"] },
  { title: "文字", tokens: ["--color-ink", "--color-ink-2", "--color-ink-3"] },
  { title: "动作色", tokens: ["--color-accent", "--color-accent-strong", "--color-accent-soft", "--color-accent-ink"] },
  { title: "状态色", tokens: ["--color-ok", "--color-warn", "--color-danger", "--color-warn-soft", "--color-danger-soft"] },
  { title: "边框", tokens: ["--color-border", "--color-border-strong"] },
  {
    title: "数据色板（仅图表/健康）",
    tokens: [
      "--color-data-blue",
      "--color-data-teal",
      "--color-data-green",
      "--color-data-amber",
      "--color-data-red",
      "--color-data-purple",
    ],
  },
];

const RADII: [string, string][] = [
  ["rounded-ctl", "--radius-ctl · 8px"],
  ["rounded-row", "--radius-row · 12px"],
  ["rounded-card", "--radius-card · 16px"],
  ["rounded-pill", "--radius-pill · 999px"],
];

const TEXT_ROLES: [string, string][] = [
  ["td-text-caption", "caption · 12px"],
  ["td-text-label", "label · 13px"],
  ["td-text-body", "body · 15px"],
  ["td-text-title", "title · 20px"],
  ["td-text-display", "display · 28px"],
];

const NUMBER_ROLES: [string, string][] = [
  ["td-num", "12,345"],
  ["td-time", "09:42"],
  ["td-duration", "1h 20m"],
  ["td-stat", "12.5"],
  ["td-metric", "98%"],
];

const MOTION_TOKENS = [
  "--duration-fast · 150ms",
  "--duration-base · 200ms",
  "--duration-slow · 300ms",
  "--ease-standard · ease-out",
  "--ease-emphasized · cubic-bezier(0.2, 0, 0, 1)",
];

const Z_LAYERS = ["--z-sticky · 20", "--z-dropdown · 30", "--z-backdrop · 40", "--z-modal · 50", "--z-top · 70"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="td-text-title text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default function StyleguidePage() {
  const [seg, setSeg] = useState<"day" | "week" | "month">("week");
  const [switched, setSwitched] = useState(true);

  return (
    <div className="min-h-full bg-page text-ink">
      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 pb-24">
        <header className="space-y-1">
          <h1 className="td-text-display text-ink">设计语言预览</h1>
          <p className="td-text-body text-ink-2">
            全部设计 token + 排版/数字角色 + 自绘控件的一致性镜子，作为换肤/重构验收台（/dev/styleguide）。
          </p>
        </header>

        <Section title="颜色 token">
          <div className="space-y-4">
            {COLOR_GROUPS.map((group) => (
              <div key={group.title} className="space-y-2">
                <h3 className="td-text-label text-ink-2">{group.title}</h3>
                <div className="flex flex-wrap gap-3">
                  {group.tokens.map((token) => (
                    <div key={token} className="flex items-center gap-2 rounded-row border border-border bg-surface p-2">
                      <span
                        aria-hidden="true"
                        className="h-9 w-9 shrink-0 rounded-ctl border border-border"
                        style={{ background: `var(${token})` }}
                      />
                      <span className="td-text-caption text-ink-2">{token}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="圆角阶梯">
          <div className="flex flex-wrap gap-4">
            {RADII.map(([cls, label]) => (
              <div key={cls} className="flex flex-col items-center gap-2">
                <span aria-hidden="true" className={`h-16 w-16 border border-border bg-surface-elevated ${cls}`} />
                <span className="td-text-caption text-ink-2">{label}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="高度阴影（含顶部 hairline 高光）">
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col items-center gap-2">
              <span aria-hidden="true" className="h-16 w-28 rounded-card bg-surface-elevated shadow-elev1" />
              <span className="td-text-caption text-ink-2">shadow-elev1</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <span aria-hidden="true" className="h-16 w-28 rounded-card bg-surface-elevated shadow-elev2" />
              <span className="td-text-caption text-ink-2">shadow-elev2</span>
            </div>
          </div>
        </Section>

        <Section title="排版角色 td-text-*">
          <div className="space-y-2 rounded-card border border-border bg-surface p-4">
            {TEXT_ROLES.map(([cls, label]) => (
              <div key={cls} className="flex items-baseline justify-between gap-4">
                <span className={`${cls} text-ink`}>霞鹭文楷 · The quick brown fox</span>
                <span className="td-text-caption shrink-0 text-ink-3">{`${cls} · ${label.split(" · ")[1]}`}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="数字角色 td-*（tabular-nums）">
          <div className="flex flex-wrap gap-4 rounded-card border border-border bg-surface p-4">
            {NUMBER_ROLES.map(([cls, sample]) => (
              <div key={cls} className="flex flex-col gap-1">
                <span className={`${cls} text-ink`}>{sample}</span>
                <span className="td-text-caption text-ink-3">{cls}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="动效 token">
          <div className="space-y-3">
            <ul className="flex flex-wrap gap-2">
              {MOTION_TOKENS.map((token) => (
                <li key={token} className="rounded-pill border border-border bg-surface px-3 py-1 td-text-caption text-ink-2">
                  {token}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="rounded-ctl border border-border bg-surface px-3 py-2 td-text-label text-ink-2 transition-colors hover:bg-accent-soft hover:text-accent"
              style={{ transitionDuration: "var(--duration-base)", transitionTimingFunction: "var(--ease-standard)" }}
            >
              悬停看过渡（var(--duration-base)）
            </button>
          </div>
        </Section>

        <Section title="z-index 层级阶梯">
          <ul className="flex flex-wrap gap-2">
            {Z_LAYERS.map((token) => (
              <li key={token} className="rounded-pill border border-border bg-surface px-3 py-1 td-text-caption text-ink-2">
                {token}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="自绘控件">
          <div className="space-y-4 rounded-card border border-border bg-surface p-4">
            <div className="space-y-2">
              <span className="td-text-label text-ink-2">SegmentedControl</span>
              <SegmentedControl
                ariaLabel="预览分段控件"
                value={seg}
                onChange={setSeg}
                options={[
                  { value: "day", label: "日" },
                  { value: "week", label: "周" },
                  { value: "month", label: "月" },
                ]}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="td-text-label text-ink-2">Switch</span>
              <Switch ariaLabel="预览开关" checked={switched} onChange={setSwitched} />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
