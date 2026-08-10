import { useState } from "react";
import { CaretLeft } from "@phosphor-icons/react";
import { Icon } from "../../components/Icon.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { PageBackButton } from "../../components/ui/PageBackButton.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { ActionToastBar } from "../../components/ui/ActionToastBar.js";
import { ConfirmDeleteButton } from "../../components/ui/ConfirmDeleteButton.js";
import { ConfirmSheet } from "../../components/ui/ConfirmSheet.js";
import { SelectSheet } from "../../components/ui/SelectSheet.js";
import { Sheet } from "../../components/ui/Sheet.js";
import { StatusBanner } from "../../components/ui/StatusBanner.js";
import { Switch } from "../../components/ui/Switch.js";
import { useActionToast } from "../../hooks/useActionToast.js";

/** 用户内容身份色（见 ADR 0026）。色块预览与「真实形态验收台」两处共用这一份，不各列一遍。 */
const TINT_TOKENS = Array.from({ length: 9 }, (_, i) => `--color-tint-${i + 1}`);

const COLOR_GROUPS: { title: string; tokens: string[] }[] = [
  { title: "中性底盘", tokens: ["--color-page", "--color-surface", "--color-surface-elevated", "--color-surface-hover", "--color-backdrop"] },
  { title: "文字", tokens: ["--color-ink", "--color-ink-2", "--color-ink-3"] },
  { title: "动作色", tokens: ["--color-accent", "--color-accent-strong", "--color-accent-soft", "--color-accent-ink", "--color-accent-contrast"] },
  { title: "状态色", tokens: ["--color-ok", "--color-warn", "--color-danger"] },
  { title: "边框", tokens: ["--color-border", "--color-border-strong", "--color-border-hairline"] },
  { title: "滚动条滑块", tokens: ["--color-scrollbar-thumb", "--color-scrollbar-thumb-hover"] },
  { title: "Track 调度信号", tokens: ["--color-track-agent"] },
  { title: "Goal scoped 星图", tokens: ["--galaxy-edge", "--galaxy-edge-glow", "--galaxy-star-core"] },
  { title: "用户内容身份色（项目圆点 / 标签 #）", tokens: [...TINT_TOKENS] },
];

const GALAXY_GLOWS = [
  "--shadow-galaxy-ready",
  "--shadow-galaxy-blocked",
  "--shadow-galaxy-completed",
  "--shadow-galaxy-parked",
  "--shadow-galaxy-active",
  "--shadow-galaxy-anchor",
  "--shadow-galaxy-star-core",
  "--shadow-galaxy-star-core-strong",
  "--shadow-galaxy-star-core-wide",
];

const ELEV_SHADOWS = ["--shadow-elev1", "--shadow-elev2"];

const FONT_STACKS: [string, string][] = [
  ["--font-body", "Times New Roman / Tinos / LXGW WenKai Screen / KaiTi / serif"],
  ["--font-mono", "JetBrains Mono / ui-monospace / monospace"],
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
  ["td-eyebrow", "eyebrow · 12px/500/0.16em 大写"],
];

const NUMBER_ROLES: [string, string][] = [
  ["td-num", "12,345"],
  ["td-time", "09:42"],
  ["td-duration", "1h 20m"],
];

const Z_LAYERS = ["--z-dropdown · 30", "--z-backdrop · 40", "--z-modal · 50", "--z-top · 70"];

const SHELL_DEMO_LINES = Array.from({ length: 8 }, (_, i) => `滚动这块区域看 sticky——第 ${i + 1} 行占位内容。`);

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
  const [demoSheetOpen, setDemoSheetOpen] = useState(false);
  const [demoConfirmOpen, setDemoConfirmOpen] = useState<"plain" | "danger" | null>(null);
  const [demoSelect, setDemoSelect] = useState<"low" | "mid" | "high" | null>("mid");
  const { toast: demoToast, showToast: showDemoToast, clearToast: clearDemoToast } = useActionToast();
  const [demoDeleted, setDemoDeleted] = useState(0);

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

        <Section title="身份色的真实形态（验收台）">
          <p className="td-text-caption text-ink-3">
            9 支 tint 在真实尺寸下的样子：项目是 6px 圆点铺在胶囊上，标签是 caption 档的 # 字形。
            色块看着分得开、缩到这个尺寸未必分得开——验收看这一节，不看上面的大色块。
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TINT_TOKENS.map((token, i) => (
              <span
                key={token}
                className="inline-flex items-center gap-1 rounded-pill bg-surface-elevated px-1.5 py-px td-text-caption text-ink-2"
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-pill"
                  style={{ backgroundColor: `var(${token})` }}
                />
                项目 {i + 1}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TINT_TOKENS.map((token, i) => (
              <span
                key={token}
                className="inline-flex items-center gap-1 rounded-pill bg-surface-elevated px-1.5 py-px td-text-caption text-ink-2"
              >
                <span style={{ color: `var(${token})` }}>#</span>
                标签{i + 1}
              </span>
            ))}
          </div>
          <p className="td-text-caption text-ink-3">
            筛选面板的填充态（旧色板在这里是 1.9–3.1:1、12 支无一达标，是换色板的主要动因之一）：
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TINT_TOKENS.map((token, i) => (
              <span
                key={token}
                className="inline-flex min-h-9 items-center rounded-pill border px-2.5 td-text-caption"
                style={{
                  backgroundColor: `var(${token})`,
                  borderColor: `var(${token})`,
                  color: "var(--color-page)",
                }}
              >
                #标签{i + 1}
              </span>
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
            {ELEV_SHADOWS.map((token) => (
              <div key={token} className="flex flex-col items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-16 w-28 rounded-card bg-surface-elevated"
                  style={{ boxShadow: `var(${token})` }}
                />
                <span className="td-text-caption text-ink-2">{token}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="星图光晕（Goal scoped shadow token）">
          <div className="flex flex-wrap gap-3 rounded-card border border-border bg-surface p-4">
            {GALAXY_GLOWS.map((token) => (
              <div key={token} className="flex flex-col items-center gap-1">
                <span
                  aria-hidden="true"
                  className="h-10 w-10 rounded-pill bg-surface-elevated"
                  style={{ boxShadow: `var(${token})` }}
                />
                <span className="td-text-caption text-ink-3">{token}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="字体栈">
          <div className="space-y-2 rounded-card border border-border bg-surface p-4">
            {FONT_STACKS.map(([token, label]) => (
              <div key={token} className="flex items-baseline justify-between gap-4">
                <span style={{ fontFamily: `var(${token})` }} className="text-ink">
                  霞鹭文楷 · The quick brown fox 0123456789
                </span>
                <span className="td-text-caption shrink-0 text-ink-3">{`${token} · ${label}`}</span>
              </div>
            ))}
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

        <Section title="基座组件">
          <div className="space-y-4 rounded-card border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <span className="block mb-1.5 td-text-label text-ink-2">PageBackButton（link 态）</span>
                <PageBackButton to="/dev/styleguide" />
              </div>
              <div>
                <span className="block mb-1.5 td-text-label text-ink-2">PageBackButton（button 态）</span>
                <PageBackButton onClick={() => {}} />
              </div>
              <div>
                <span className="block mb-1.5 td-text-label text-ink-2">热区档 sm / md / lg</span>
                <div className="flex items-center gap-2">
                  <span className="hotarea-sm flex items-center justify-center rounded-pill border border-border bg-surface text-ink-2">
                    <Icon icon={CaretLeft} size={14} />
                  </span>
                  <span className="hotarea-md flex items-center justify-center rounded-pill border border-border bg-surface text-ink-2">
                    <Icon icon={CaretLeft} size={16} />
                  </span>
                  <span className="hotarea-lg flex items-center justify-center rounded-pill border border-border bg-surface text-ink-2">
                    <Icon icon={CaretLeft} size={18} />
                  </span>
                </div>
              </div>
            </div>
            <div>
              <span className="block mb-1.5 td-text-label text-ink-2">EmptyState（card / inline）</span>
              <div className="space-y-2">
                <EmptyState title="还没有记录" description="记录后会出现在这里" />
                <EmptyState variant="inline" title="今天还没有记录" />
              </div>
            </div>
            <div>
              <span className="block mb-1.5 td-text-label text-ink-2">LoadingState</span>
              <LoadingState label="正在加载…" className="rounded-card bg-surface-elevated px-4 py-8" />
            </div>
            <div>
              <span className="block mb-1.5 td-text-label text-ink-2">StatusBanner（info / ok / warn / danger；card / bar）</span>
              <div className="space-y-2">
                <StatusBanner tone="info">同步进行中</StatusBanner>
                <StatusBanner tone="warn">部分记录未同步</StatusBanner>
                <StatusBanner tone="danger">同步失败，请重试</StatusBanner>
                <StatusBanner tone="ok">已生成本周回顾</StatusBanner>
                <StatusBanner tone="danger" variant="bar">日记已被其他窗口修改</StatusBanner>
              </div>
            </div>
            <div>
              <span className="block mb-1.5 td-text-label text-ink-2">内容色点 content-dot</span>
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="content-dot rounded-pill" style={{ backgroundColor: "var(--tint-1)" }} />
                <span aria-hidden="true" className="content-dot rounded-pill" style={{ backgroundColor: "var(--tint-5)" }} />
                <span aria-hidden="true" className="content-dot rounded-pill" style={{ backgroundColor: "var(--tint-9)" }} />
              </div>
            </div>
          </div>
        </Section>

        <Section title="弹层体系">
          <div className="space-y-4 rounded-card border border-border bg-surface p-4">
            <p className="td-text-label text-ink-2">
              全站弹层规范：一律底部抽屉（批 3 已收口 7 个居中弹窗）。删除一个完整对象走 ConfirmSheet；删对象内部一条走就地二次确认（见下一节）。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDemoSheetOpen(true)}
                className="min-h-11 rounded-ctl border border-border px-4 td-text-label text-ink hover:bg-surface-hover"
              >
                打开 Sheet
              </button>
              <button
                type="button"
                onClick={() => setDemoConfirmOpen("plain")}
                className="min-h-11 rounded-ctl border border-border px-4 td-text-label text-ink hover:bg-surface-hover"
              >
                打开 ConfirmSheet（普通）
              </button>
              <button
                type="button"
                onClick={() => setDemoConfirmOpen("danger")}
                className="min-h-11 rounded-ctl border border-border px-4 td-text-label text-danger hover:bg-surface-hover"
              >
                打开 ConfirmSheet（danger）
              </button>
            </div>
            <div className="max-w-xs">
              <span className="block mb-1.5 td-text-label text-ink-2">SelectSheet（trigger + 底部抽屉选择）</span>
              <SelectSheet
                label="演示强度"
                value={demoSelect}
                onChange={setDemoSelect}
                options={[
                  { value: "low", label: "低" },
                  { value: "mid", label: "中" },
                  { value: "high", label: "高" },
                ]}
              />
            </div>
            <Sheet open={demoSheetOpen} onClose={() => setDemoSheetOpen(false)} title="Sheet 演示">
              <p className="td-text-body text-ink-2">底部抽屉壳：Escape / 点遮罩关闭，焦点圈定在面板内。</p>
            </Sheet>
            <ConfirmSheet
              open={demoConfirmOpen === "plain"}
              title="普通确认"
              body="非破坏性动作的确认档。"
              onConfirm={() => setDemoConfirmOpen(null)}
              onCancel={() => setDemoConfirmOpen(null)}
            />
            <ConfirmSheet
              open={demoConfirmOpen === "danger"}
              title="删除这条演示数据？"
              body="danger 档：确认钮 bg-danger，用于删除一个完整对象。"
              danger
              confirmLabel="删除"
              onConfirm={() => setDemoConfirmOpen(null)}
              onCancel={() => setDemoConfirmOpen(null)}
            />
          </div>
        </Section>

        <Section title="反馈动作">
          <div className="space-y-4 rounded-card border border-border bg-surface p-4">
            <div>
              <span className="block mb-1.5 td-text-label text-ink-2">ActionToastBar（出现 → 自动消退，可挂动作钮）</span>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => showDemoToast({ message: "已完成 1 条演示任务", actions: [{ label: "撤销", onClick: () => {} }] })}
                  className="min-h-11 rounded-ctl border border-border px-4 td-text-label text-ink hover:bg-surface-hover"
                >
                  触发 ActionToast
                </button>
                <ActionToastBar toast={demoToast} onDismiss={clearDemoToast} ariaLabel="演示操作提示" />
              </div>
            </div>
            <div>
              <span className="block mb-1.5 td-text-label text-ink-2">
                ConfirmDeleteButton（就地二次确认：首点变「确认删除」，点别处复位）· 已删 {demoDeleted} 次
              </span>
              <ConfirmDeleteButton target="演示条目" onConfirm={() => setDemoDeleted((n) => n + 1)} />
            </div>
          </div>
        </Section>

        <Section title="页面壳">
          <div className="space-y-2">
            <span className="td-text-label text-ink-2">PageHeader（sticky + backdrop-blur；背景 page / surface 两档走 prop，不用 className 覆盖）</span>
            <div className="max-h-56 overflow-y-auto rounded-card border border-border">
              <PageHeader
                title="演示页标题"
                back={<PageBackButton onClick={() => {}} />}
                actions={
                  <button type="button" className="min-h-11 rounded-ctl px-3 td-text-label text-accent hover:bg-surface-hover">
                    动作
                  </button>
                }
              />
              <div className="space-y-3 bg-page p-4">
                {SHELL_DEMO_LINES.map((line) => (
                  <p key={line} className="td-text-body text-ink-2">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
