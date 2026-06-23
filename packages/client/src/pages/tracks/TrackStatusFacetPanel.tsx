import type { TrackStatusFacet } from "../../lib/tracksView.js";

export function TrackStatusFacetPanel({
  facets,
  selectedTags,
  onToggle,
}: {
  facets: TrackStatusFacet[];
  selectedTags: readonly string[];
  onToggle: (tag: string) => void;
}) {
  const selected = new Set(selectedTags);

  return (
    <section className="mb-3 rounded-card border border-border bg-surface p-3">
      <div className="mb-2 text-xs font-medium text-ink-3">看板信号</div>
      <div className="flex flex-wrap gap-2">
        {facets.map((facet) => {
          const active = selected.has(facet.tag);
          return (
            <button
              key={facet.tag}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(facet.tag)}
              className={`rounded-pill px-2.5 py-1 text-xs transition ${
                active
                  ? "bg-accent-soft text-accent"
                  : facet.suggested
                    ? "bg-surface-elevated text-ink-2 hover:text-ink"
                    : "bg-surface-hover text-ink-2 hover:text-ink"
              }`}
            >
              {facet.tag} {facet.count}
            </button>
          );
        })}
      </div>
    </section>
  );
}
