import { afterEach, describe, expect, it } from "vitest";
import type { SyncChange, SyncStreamBump } from "@timedata/shared";
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

// 与 T1（schemas.test.ts SyncStreamBumpSchema）同形状的 quick_notes 夹具。
function fixtureChange(): SyncChange {
  return {
    tableName: "quick_notes",
    recordId: "note-1",
    action: "update",
    data: {
      id: "note-1",
      text: "突然想到一个词",
      occurredAt: "2026-06-01T04:01:30.123Z",
      createdAt: "2026-06-01T04:02:00.000Z",
      updatedAt: "2026-06-01T04:02:00.000Z",
    },
    timestamp: "2026-06-01T04:02:00.000Z",
  };
}

afterEach(() => {
  for (const listener of cleanup.splice(0)) {
    removeSyncStreamListener(listener);
  }
});

describe("sync stream notifier", () => {
  it("broadcasts latestSeq to registered listeners", () => {
    const seen: SyncStreamBump[] = [];
    const listener = (bump: SyncStreamBump) => seen.push(bump);

    addTrackedListener(listener);
    notifySyncChange(42);

    expect(seen).toEqual([{ latestSeq: 42 }]);
  });

  it("stops delivering after removal", () => {
    const seen: SyncStreamBump[] = [];
    const listener = (bump: SyncStreamBump) => seen.push(bump);

    addSyncStreamListener(listener);
    removeSyncStreamListener(listener);
    notifySyncChange(7);

    expect(seen).toEqual([]);
  });

  it("isolates a throwing listener from the rest", () => {
    const seen: SyncStreamBump[] = [];
    const bad = () => {
      throw new Error("boom");
    };
    const good = (bump: SyncStreamBump) => seen.push(bump);

    addTrackedListener(bad);
    addTrackedListener(good);

    expect(() => notifySyncChange(1)).not.toThrow();
    expect(seen).toEqual([{ latestSeq: 1 }]);
  });

  it("tracks listener count", () => {
    const listener = () => undefined;
    const before = syncStreamListenerCount();

    addSyncStreamListener(listener);
    expect(syncStreamListenerCount()).toBe(before + 1);

    removeSyncStreamListener(listener);
    expect(syncStreamListenerCount()).toBe(before);
  });

  it("纯 bump：listener 收到 { latestSeq }", () => {
    const received: SyncStreamBump[] = [];
    addTrackedListener((bump) => received.push(bump));
    notifySyncChange(5);
    expect(received).toEqual([{ latestSeq: 5 }]);
  });

  it("带载荷：listener 收到 fromSeq/changes 透传", () => {
    const received: SyncStreamBump[] = [];
    addTrackedListener((bump) => received.push(bump));
    const changes = [fixtureChange()];
    notifySyncChange(7, { fromSeq: 5, changes });
    expect(received).toEqual([{ latestSeq: 7, fromSeq: 5, changes }]);
  });
});
