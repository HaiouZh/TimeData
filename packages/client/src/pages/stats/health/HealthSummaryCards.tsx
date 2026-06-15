import type { HealthSummaryCardItem, HealthSummaryTone } from "../../../lib/healthBlocks/index.ts";

export type { HealthSummaryCardItem, HealthSummaryTone };

export function HealthSummaryCards({ items }: { items: HealthSummaryCardItem[] }) {
  return (
    <section className="health-summary-grid" aria-label="健康摘要">
      {items.map((item) => (
        <article key={item.id} className={`health-summary-card health-summary-card-${item.tone}`}>
          <div className="health-summary-label">{item.label}</div>
          <div className="health-summary-value">{item.value}</div>
          <div className="health-summary-detail">{item.detail}</div>
        </article>
      ))}
    </section>
  );
}
