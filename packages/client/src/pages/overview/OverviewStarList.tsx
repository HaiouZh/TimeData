import { useState } from "react";
import type { OverviewCluster } from "../../lib/overview/overviewModel.js";
import type { OverviewStar } from "../../lib/overview/overviewStars.js";
import { getDateString } from "../../lib/time.js";
import { STAR_KIND_LABELS, StarGlyph } from "./overviewGlyphs.js";

/** 一团里默认展示的星数上限（散着那团除外）。 */
export const OVERVIEW_CLUSTER_STAR_CAP = 12;

/** 散着那团默认展示的星数上限。 */
export const OVERVIEW_LOOSE_STAR_CAP = 24;

/** 暗处点开后最多渲染的星数。 */
export const OVERVIEW_DARK_RENDER_CAP = 200;

/** 亮处点开后最多渲染的星数。 */
export const OVERVIEW_LIT_RENDER_CAP = 200;

/** 点中一颗星时交出去的回调。 */
export type OpenStarHandler = (star: OverviewStar) => void;

/** 一团里的星：亮处默认只露一部分，暗处默认一颗都不渲染。 */
export function OverviewStarList(props: {
  cluster: OverviewCluster;
  layout: "flow" | "rows";
  onOpenStar: OpenStarHandler;
}): React.JSX.Element {
  const { cluster, layout, onOpenStar } = props;
  const [showAllLit, setShowAllLit] = useState(false);
  const [darkOpen, setDarkOpen] = useState(false);

  const cap = cluster.kind === "loose" ? OVERVIEW_LOOSE_STAR_CAP : OVERVIEW_CLUSTER_STAR_CAP;
  const litOverflow = cluster.litStars.length > cap;
  const visibleLit = cluster.litStars.slice(0, showAllLit ? OVERVIEW_LIT_RENDER_CAP : cap);
  const unrenderedLitCount = cluster.litStars.length - OVERVIEW_LIT_RENDER_CAP;
  const visibleDark = darkOpen ? cluster.darkStars.slice(0, OVERVIEW_DARK_RENDER_CAP) : [];
  const unrenderedDarkCount = cluster.darkStars.length - OVERVIEW_DARK_RENDER_CAP;

  const listClassName = layout === "flow" ? "flex flex-wrap gap-1.5" : "flex flex-col";

  // 单颗星按钮：flow 版是胶囊只露标题，rows 版末尾多一个 MM-DD。
  function renderStarButton(star: OverviewStar, dark: boolean): React.JSX.Element {
    const label = `${STAR_KIND_LABELS[star.kind]}：${star.title}`;
    if (layout === "flow") {
      return (
        <li key={star.key} className="max-w-full">
          <button
            type="button"
            aria-label={label}
            onClick={() => onOpenStar(star)}
            className={`flex max-w-60 items-center gap-1.5 rounded-pill px-2 py-0.5 td-text-caption transition hover:bg-surface-hover ${dark ? "text-ink-3" : "text-ink-2"}`}
          >
            <StarGlyph kind={star.kind} dimmed={dark} />
            <span className="min-w-0 truncate">{star.title}</span>
          </button>
        </li>
      );
    }
    return (
      <li key={star.key} className="max-w-full">
        <button
          type="button"
          aria-label={label}
          onClick={() => onOpenStar(star)}
          className={`flex w-full items-center gap-2 rounded-row px-2 py-1.5 text-left td-text-body transition hover:bg-surface-hover ${dark ? "text-ink-3" : "text-ink"}`}
        >
          <StarGlyph kind={star.kind} dimmed={dark} />
          <span className="min-w-0 flex-1 truncate">{star.title}</span>
          <span className="shrink-0 td-text-caption text-ink-3">{getDateString(new Date(star.at)).slice(-5)}</span>
        </button>
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label={cluster.title}>
      {cluster.litStars.length > 0 && (
        <ul className={listClassName}>
          {visibleLit.map((star) => renderStarButton(star, false))}
          {litOverflow && (
            <li className="max-w-full">
              <button
                type="button"
                aria-expanded={showAllLit}
                onClick={() => setShowAllLit((open) => !open)}
                className="rounded-pill px-2 py-0.5 td-text-caption text-ink-3 transition hover:bg-surface-hover hover:text-ink"
              >
                {showAllLit ? "收起" : `还有 ${cluster.litStars.length - cap} 颗`}
              </button>
            </li>
          )}
        </ul>
      )}
      {showAllLit && unrenderedLitCount > 0 && (
        <p className="px-2 td-text-caption text-ink-3">{`还有 ${unrenderedLitCount} 颗，用搜索找`}</p>
      )}
      {cluster.darkStars.length > 0 && (
        <button
          type="button"
          aria-expanded={darkOpen}
          onClick={() => setDarkOpen((open) => !open)}
          className="self-start rounded-pill px-2 py-0.5 td-text-caption text-ink-3 transition hover:bg-surface-hover hover:text-ink"
        >
          {`暗处还有 ${cluster.darkStars.length} 颗`}
        </button>
      )}
      {darkOpen && cluster.darkStars.length > 0 && (
        <ul className={listClassName}>{visibleDark.map((star) => renderStarButton(star, true))}</ul>
      )}
      {darkOpen && unrenderedDarkCount > 0 && (
        <p className="px-2 td-text-caption text-ink-3">{`还有 ${unrenderedDarkCount} 颗，用搜索找`}</p>
      )}
    </div>
  );
}
