// @vitest-environment jsdom
import type { SyncLogEntry } from "@timedata/shared";
import { act, createElement, type ReactElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import type { Root } from "../test/domHarness.js";
import { renderDom, unmount } from "../test/domHarness.js";
import { useUnsyncedQuickNoteIds } from "./useUnsyncedQuickNoteIds.js";

function log(overrides: Partial<SyncLogEntry>): SyncLogEntry {
  return {
    id: "log-1",
    tableName: "quick_notes",
    recordId: "note-1",
    action: "create",
    timestamp: "2026-06-01T04:00:00.000Z",
    synced: 0,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function render(element: ReactElement): Promise<{ host: HTMLElement; root: Root }> {
  const { host, root } = await renderDom(element);
  await flush();
  return { host, root };
}

beforeEach(async () => {
  await resetDb();
});

afterEach(resetDb);

describe("useUnsyncedQuickNoteIds", () => {
  it("includes quick note logs that are not synced", async () => {
    await db.syncLog.add(log({ id: "quick-note-log", recordId: "note-pending", synced: 0 }));
    let latest: string[] = [];

    function Probe() {
      const ids = useUnsyncedQuickNoteIds();
      useEffect(() => {
        latest = [...ids].sort();
      }, [ids]);
      return null;
    }

    const { root } = await render(createElement(Probe));
    expect(latest).toEqual(["note-pending"]);

    await unmount(root);
  });

  it("ignores synced quick note logs", async () => {
    await db.syncLog.add(log({ id: "quick-note-log", recordId: "note-uploaded", synced: 1 }));
    let latest: string[] = ["stale"];

    function Probe() {
      const ids = useUnsyncedQuickNoteIds();
      useEffect(() => {
        latest = [...ids].sort();
      }, [ids]);
      return null;
    }

    const { root } = await render(createElement(Probe));
    expect(latest).toEqual([]);

    await unmount(root);
  });

  it("ignores unsynced logs from other tables", async () => {
    await db.syncLog.add(log({ id: "entry-log", tableName: "time_entries", recordId: "entry-1", synced: 0 }));
    let latest: string[] = ["stale"];

    function Probe() {
      const ids = useUnsyncedQuickNoteIds();
      useEffect(() => {
        latest = [...ids].sort();
      }, [ids]);
      return null;
    }

    const { root } = await render(createElement(Probe));
    expect(latest).toEqual([]);

    await unmount(root);
  });

  it("returns an empty set when there are no logs", async () => {
    let latest: string[] = ["stale"];

    function Probe() {
      const ids = useUnsyncedQuickNoteIds();
      useEffect(() => {
        latest = [...ids].sort();
      }, [ids]);
      return null;
    }

    const { root } = await render(createElement(Probe));
    expect(latest).toEqual([]);

    await unmount(root);
  });
});
