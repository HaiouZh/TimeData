// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_FORMAT, type BackupDocument } from "./schema.js";
import { backupFileName, downloadBackupFile } from "./fileDownload.js";

const sampleBackup: BackupDocument = {
  format: BACKUP_FORMAT,
  timeFormat: "utc",
  exportedAt: "2026-05-07T12:30:00.000Z",
  appVersion: "0.1.0-test",
  device: { deviceId: "device-1", deviceName: "Web" },
  categories: [],
  timeEntries: [],
};

const isNativePlatformMock = vi.fn(() => false);
const writeFileMock = vi.fn(async () => ({ uri: "file:///documents/test.json" }));
const canShareMock = vi.fn(async () => ({ value: true }));
const shareMock = vi.fn(async () => undefined);

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => isNativePlatformMock() },
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Documents: "DOCUMENTS" },
  Encoding: { UTF8: "utf8" },
  Filesystem: { writeFile: (options: unknown) => writeFileMock(options as never) },
}));

vi.mock("@capacitor/share", () => ({
  Share: {
    canShare: () => canShareMock(),
    share: (options: unknown) => shareMock(options as never),
  },
}));

describe("backupFileName", () => {
  it("strips colons and milliseconds so the filename is valid on common filesystems", () => {
    expect(backupFileName("TimeData-backup", "2026-05-07T12:30:45.123Z")).toBe(
      "TimeData-backup-2026-05-07T12-30-45.json",
    );
  });
});

describe("downloadBackupFile on web", () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(false);
    writeFileMock.mockClear();
    shareMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an anchor, triggers click, and revokes the object URL", async () => {
    const created: HTMLAnchorElement[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = originalCreate(tag) as HTMLAnchorElement;
      if (tag === "a") created.push(element);
      return element;
    });
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    await downloadBackupFile(sampleBackup);

    expect(created).toHaveLength(1);
    expect(created[0].download).toBe("TimeData-backup-2026-05-07T12-30-00.json");
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1100);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");

    vi.useRealTimers();
  });
});

describe("downloadBackupFile on Capacitor native", () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
    writeFileMock.mockClear();
    shareMock.mockClear();
    canShareMock.mockResolvedValue({ value: true });
  });

  it("writes through Filesystem and opens the share sheet so the file is reachable from native Files apps", async () => {
    await downloadBackupFile(sampleBackup);

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock.mock.calls[0][0]).toMatchObject({
      path: "TimeData-backup-2026-05-07T12-30-00.json",
      directory: "DOCUMENTS",
      encoding: "utf8",
    });
    expect(shareMock).toHaveBeenCalledWith(expect.objectContaining({ url: "file:///documents/test.json" }));
  });

  it("swallows user-cancelled share so the call resolves silently", async () => {
    shareMock.mockRejectedValueOnce(new Error("Share canceled"));
    await expect(downloadBackupFile(sampleBackup)).resolves.toBeUndefined();
  });

  it("skips sharing when the platform reports it cannot share", async () => {
    canShareMock.mockResolvedValueOnce({ value: false });
    await downloadBackupFile(sampleBackup);
    expect(shareMock).not.toHaveBeenCalled();
  });
});
