export type TrackCourt = "mine" | "agent" | "blocked" | "neutral";

export interface TrackCourtMeta {
  label: string;
  laneLabel: string;
  badgeClass: string;
  softClass: string;
  dotClass: string;
  rank: number;
}

export const TRACK_COURTS: readonly TrackCourt[] = ["mine", "agent", "blocked", "neutral"];

export const TRACK_COURT_META: Record<TrackCourt, TrackCourtMeta> = {
  mine: {
    label: "我侧",
    laneLabel: "该我了",
    badgeClass: "border-warn/50 bg-warn-soft text-warn",
    softClass: "border-warn/40 bg-warn-soft",
    dotClass: "bg-warn",
    rank: 0,
  },
  agent: {
    label: "等 agent",
    laneLabel: "等 agent",
    badgeClass: "border-accent/50 bg-accent-soft text-accent",
    softClass: "border-accent/40 bg-accent-soft",
    dotClass: "bg-accent",
    rank: 1,
  },
  blocked: {
    label: "卡住",
    laneLabel: "卡住",
    badgeClass: "border-danger/50 bg-danger-soft text-danger",
    softClass: "border-danger/40 bg-danger-soft",
    dotClass: "bg-danger",
    rank: 2,
  },
  neutral: {
    label: "中性",
    laneLabel: "其他",
    badgeClass: "border-border bg-surface-elevated text-ink-2",
    softClass: "border-border bg-surface",
    dotClass: "bg-ink-3",
    rank: 3,
  },
};

export function normalizeTrackCourt(value: unknown): TrackCourt {
  return value === "mine" || value === "agent" || value === "blocked" || value === "neutral" ? value : "neutral";
}

export function defaultCourtForTrackTag(tag: string): TrackCourt {
  if (tag === "等我" || tag === "待决策") return "mine";
  if (tag === "agent在做") return "agent";
  if (tag === "卡住") return "blocked";
  return "neutral";
}
