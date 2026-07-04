import { beforeEach, describe, expect, it } from "vitest";
import { getCloudSyncEnabled, setCloudSyncEnabled } from "./cloudSyncSetting.js";

beforeEach(() => {
  localStorage.clear();
});

describe("cloud sync setting", () => {
  it("defaults to false when server is not configured", () => {
    expect(getCloudSyncEnabled()).toBe(false);
  });

  it("defaults to true when server is configured and no explicit setting exists", () => {
    localStorage.setItem("timedata_api_url", "https://example.com");

    expect(getCloudSyncEnabled()).toBe(true);
  });

  it("uses the explicit saved setting before server-url inference", () => {
    localStorage.setItem("timedata_api_url", "https://example.com");
    setCloudSyncEnabled(false);

    expect(getCloudSyncEnabled()).toBe(false);

    setCloudSyncEnabled(true);

    expect(getCloudSyncEnabled()).toBe(true);
  });
});
