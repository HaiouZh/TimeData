import { isValidDateString } from "../time.ts";
import type { SearchRangeMode } from "./range.ts";

export interface SearchUrlState {
  categoryId: string | null;
  mode: SearchRangeMode;
  anchor: string;
  query: string;
}

const MODES: readonly SearchRangeMode[] = ["all", "year", "month", "week"];
const DEFAULT_MODE: SearchRangeMode = "year";

function parseMode(raw: string | null): SearchRangeMode {
  return MODES.find((mode) => mode === raw) ?? DEFAULT_MODE;
}

/** URL 是外部输入：未知 range / 坏 anchor 一律回落默认，不抛错、不白屏。 */
export function parseSearchUrlState(params: URLSearchParams, today: string): SearchUrlState {
  const rawAnchor = params.get("anchor");
  const rawCategory = params.get("cat");

  return {
    categoryId: rawCategory && rawCategory.length > 0 ? rawCategory : null,
    mode: parseMode(params.get("range")),
    anchor: rawAnchor && isValidDateString(rawAnchor) ? rawAnchor : today,
    query: params.get("q") ?? "",
  };
}

/** 只写偏离默认的字段，URL 保持短且可读。 */
export function toSearchUrlParams(state: SearchUrlState, today: string): URLSearchParams {
  const params = new URLSearchParams();
  if (state.categoryId) params.set("cat", state.categoryId);
  if (state.mode !== DEFAULT_MODE) params.set("range", state.mode);
  if (state.anchor !== today) params.set("anchor", state.anchor);
  if (state.query.trim().length > 0) params.set("q", state.query);
  return params;
}
