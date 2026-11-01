import { matchesAllTerms, parseSearchTerms } from "../../quick-notes/searchTerms.js";
import type { OverviewCluster } from "./overviewModel.js";

/** 搜索的结果：留下的团与去重后的星数。 */
export interface OverviewSearchResult {
  clusters: OverviewCluster[];
  matchCount: number;
}

/** 在团上按查询过滤，空白查询返回 null。 */
export function searchOverview(
  clusters: readonly OverviewCluster[],
  query: string,
): OverviewSearchResult | null {
  const terms = parseSearchTerms(query);
  if (terms.length === 0) return null;
  const kept: OverviewCluster[] = [];
  const seen = new Set<string>();
  for (const cluster of clusters) {
    if (matchesAllTerms(cluster.title.toLowerCase(), terms)) {
      const litStars = [...cluster.litStars, ...cluster.darkStars].sort((a, b) => {
        const diff = Date.parse(b.at) - Date.parse(a.at);
        if (diff !== 0) return diff;
        if (a.key < b.key) return -1;
        if (a.key > b.key) return 1;
        return 0;
      });
      kept.push({ ...cluster, litStars, darkStars: [] });
      for (const star of litStars) seen.add(star.key);
    } else {
      const litStars = [...cluster.litStars, ...cluster.darkStars]
        .filter((star) => matchesAllTerms(star.searchText, terms))
        .sort((a, b) => {
          const diff = Date.parse(b.at) - Date.parse(a.at);
          if (diff !== 0) return diff;
          if (a.key < b.key) return -1;
          if (a.key > b.key) return 1;
          return 0;
        });
      if (litStars.length === 0) continue;
      kept.push({ ...cluster, litStars, darkStars: [] });
      for (const star of litStars) seen.add(star.key);
    }
  }
  return { clusters: kept, matchCount: seen.size };
}
