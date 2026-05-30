import { describe, expect, it } from "vitest";
import { startE2EServer } from "./helpers.js";

function latestSeq(db: { prepare: (sql: string) => { get: () => { max_id: number | null } | undefined } }): number {
  return db.prepare("SELECT MAX(id) AS max_id FROM sync_seq").get()?.max_id ?? 0;
}

describe("settings sync e2e", () => {
  it("pushes, tombstones, and force-pushes settings through the sync API", async () => {
    const server = await startE2EServer();
    try {
      const upsertResponse = await server.app.request("/api/sync/push", {
        method: "POST",
        body: JSON.stringify({
          changes: [
            {
              tableName: "settings",
              recordId: "sleep.categoryId",
              action: "update",
              data: {
                key: "sleep.categoryId",
                value: "cat-1",
                updatedAt: "2026-05-30T00:00:00.000Z",
              },
              timestamp: "2026-05-30T01:00:00.000Z",
            },
          ],
          baseSeq: null,
        }),
      });
      expect(upsertResponse.status).toBe(200);
      await expect(upsertResponse.json()).resolves.toMatchObject({ accepted: 1, rejected: 0, conflicts: 0 });

      const afterUpsertSeq = latestSeq(server.db);
      const pullUpsertResponse = await server.app.request("/api/sync/pull", {
        method: "POST",
        body: JSON.stringify({ lastSyncedAt: "1970-01-01T00:00:00.000Z", sinceSeq: 0 }),
      });
      expect(pullUpsertResponse.status).toBe(200);
      await expect(pullUpsertResponse.json()).resolves.toMatchObject({
        changes: [
          {
            tableName: "settings",
            recordId: "sleep.categoryId",
            action: "update",
            data: {
              key: "sleep.categoryId",
              value: "cat-1",
              updatedAt: "2026-05-30T01:00:00.000Z",
            },
            timestamp: "2026-05-30T01:00:00.000Z",
          },
        ],
      });

      const deleteResponse = await server.app.request("/api/sync/push", {
        method: "POST",
        body: JSON.stringify({
          changes: [
            {
              tableName: "settings",
              recordId: "sleep.categoryId",
              action: "delete",
              data: null,
              timestamp: "2026-05-30T02:00:00.000Z",
            },
          ],
          baseSeq: afterUpsertSeq,
        }),
      });
      expect(deleteResponse.status).toBe(200);
      await expect(deleteResponse.json()).resolves.toMatchObject({ accepted: 1, rejected: 0, conflicts: 0 });

      const afterDeleteSeq = latestSeq(server.db);
      const pullDeleteResponse = await server.app.request("/api/sync/pull", {
        method: "POST",
        body: JSON.stringify({ lastSyncedAt: "1970-01-01T00:00:00.000Z", sinceSeq: afterUpsertSeq }),
      });
      expect(pullDeleteResponse.status).toBe(200);
      await expect(pullDeleteResponse.json()).resolves.toMatchObject({
        changes: [
          {
            tableName: "settings",
            recordId: "sleep.categoryId",
            action: "delete",
            data: null,
            timestamp: "2026-05-30T02:00:00.000Z",
          },
        ],
      });

      const prepareResponse = await server.app.request("/api/sync/force-push/prepare", {
        method: "POST",
        body: JSON.stringify({
          categoryCount: 0,
          entryCount: 0,
          lastUpdatedAt: "2026-05-30T03:00:00.000Z",
        }),
      });
      expect(prepareResponse.status).toBe(200);
      const prepare = await prepareResponse.json() as { confirmToken: string };

      const forcePushResponse = await server.app.request("/api/sync/force-push", {
        method: "POST",
        body: JSON.stringify({
          confirmToken: prepare.confirmToken,
          confirmationPhrase: "OVERWRITE_SERVER",
          categories: [],
          timeEntries: [],
          settings: [
            {
              key: "sleep.categoryId",
              value: "cat-2",
              updatedAt: "2026-05-30T03:00:00.000Z",
            },
          ],
        }),
      });
      expect(forcePushResponse.status).toBe(200);
      await expect(forcePushResponse.json()).resolves.toMatchObject({ importedSettings: 1 });

      const pullForcePushResponse = await server.app.request("/api/sync/pull", {
        method: "POST",
        body: JSON.stringify({ lastSyncedAt: "1970-01-01T00:00:00.000Z", sinceSeq: afterDeleteSeq }),
      });
      expect(pullForcePushResponse.status).toBe(200);
      await expect(pullForcePushResponse.json()).resolves.toMatchObject({
        changes: [
          {
            tableName: "settings",
            recordId: "sleep.categoryId",
            action: "update",
            data: {
              key: "sleep.categoryId",
              value: "cat-2",
              updatedAt: "2026-05-30T03:00:00.000Z",
            },
            timestamp: "2026-05-30T03:00:00.000Z",
          },
        ],
      });
    } finally {
      server.close();
    }
  });
});
