import { afterEach, describe, expect, it, vi } from "vitest";
import { requestServerBackup } from "./serverBackup.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestServerBackup", () => {
  it("POSTs to /api/sync/backup and returns backupId", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ backupId: "manual-x" })));

    const result = await requestServerBackup();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/sync/backup",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(result).toEqual({ backupId: "manual-x" });
  });
});
