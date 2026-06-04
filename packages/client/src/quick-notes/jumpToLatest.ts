export interface JumpToLatestState {
  atBottom: boolean;
  atLatest: boolean;
}

export function shouldShowJumpToLatest({ atBottom, atLatest }: JumpToLatestState): boolean {
  return !atBottom || !atLatest;
}
