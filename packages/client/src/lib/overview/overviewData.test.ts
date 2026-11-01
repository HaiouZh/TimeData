import type { QuickNote } from "@timedata/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../../test/dbReset.js";
import { listAllQuickNotesForOverview } from "./overviewData.js";

beforeEach(resetDb);
afterEach(resetDb);

describe("listAllQuickNotesForOverview", () => {
  it("只返回合法的速记，丢掉坏行", async () => {
    const first: QuickNote = {
      id: "n1",
      text: "第一条",
      occurredAt: "2026-10-01T00:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const second: QuickNote = {
      id: "n2",
      text: "第二条",
      occurredAt: "2026-10-01T00:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    await db.quickNotes.bulkAdd([
      first,
      second,
      {
        id: "bad",
        occurredAt: "2026-10-01T00:00:00.000Z",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      } as never,
    ]);
    expect((await listAllQuickNotesForOverview()).map((note) => note.id).sort()).toEqual(["n1", "n2"]);
  });
});
