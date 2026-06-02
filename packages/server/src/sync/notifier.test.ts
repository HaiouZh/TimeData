import { afterEach, describe, expect, it } from "vitest";
import {
  addSyncStreamListener,
  notifySyncChange,
  removeSyncStreamListener,
  syncStreamListenerCount,
  type SyncStreamListener,
} from "./notifier.js";

const cleanup: SyncStreamListener[] = [];

function addTrackedListener(listener: SyncStreamListener): void {
  cleanup.push(listener);
  addSyncStreamListener(listener);
}

afterEach(() => {
  for (const listener of cleanup.splice(0)) {
    removeSyncStreamListener(listener);
  }
});

describe("sync stream notifier", () => {
  it("broadcasts latestSeq to registered listeners", () => {
    const seen: Array<number | null> = [];
    const listener = (seq: number | null) => seen.push(seq);

    addTrackedListener(listener);
    notifySyncChange(42);

    expect(seen).toEqual([42]);
  });

  it("stops delivering after removal", () => {
    const seen: Array<number | null> = [];
    const listener = (seq: number | null) => seen.push(seq);

    addSyncStreamListener(listener);
    removeSyncStreamListener(listener);
    notifySyncChange(7);

    expect(seen).toEqual([]);
  });

  it("isolates a throwing listener from the rest", () => {
    const seen: Array<number | null> = [];
    const bad = () => {
      throw new Error("boom");
    };
    const good = (seq: number | null) => seen.push(seq);

    addTrackedListener(bad);
    addTrackedListener(good);

    expect(() => notifySyncChange(1)).not.toThrow();
    expect(seen).toEqual([1]);
  });

  it("tracks listener count", () => {
    const listener = () => undefined;
    const before = syncStreamListenerCount();

    addSyncStreamListener(listener);
    expect(syncStreamListenerCount()).toBe(before + 1);

    removeSyncStreamListener(listener);
    expect(syncStreamListenerCount()).toBe(before);
  });
});
