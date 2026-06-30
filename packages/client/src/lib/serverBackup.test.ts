import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api.ts", () => ({ apiFetch: vi.fn() }));
const { apiFetch } = await import("./api.ts");
const { requestServerBackup } = await import("./serverBackup.ts");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestServerBackup", () => {
  it("POSTs to /api/sync/backup and returns backupId", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ backupId: "manual-x" });

    const result = await requestServerBackup();

    expect(apiFetch).toHaveBeenCalledWith("/api/sync/backup", { method: "POST" });
    expect(result).toEqual({ backupId: "manual-x" });
  });
});
