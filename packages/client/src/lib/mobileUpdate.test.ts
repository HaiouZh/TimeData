import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAndroidApkUpdate,
  getAndroidApkUpdateFromRelease,
  getAndroidApkUpdateUrl,
  getAndroidVersionCodeFromReleaseTag,
  openAndroidApkUpdate,
} from "./mobileUpdate.js";

const originalFetch = globalThis.fetch;

const release = {
  tag_name: "android-26050801",
  html_url: "https://github.com/HaiouZh/TimeData/releases/tag/android-26050801",
  assets: [
    {
      name: "notes.txt",
      browser_download_url: "https://example.com/notes.txt",
    },
    {
      name: "timedata-debug.apk",
      browser_download_url: "https://example.com/timedata-debug.apk",
    },
  ],
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("getAndroidVersionCodeFromReleaseTag", () => {
  it("accepts eight-digit Android release tags with same-day sequence", () => {
    expect(getAndroidVersionCodeFromReleaseTag("android-26050801")).toBe("26050801");
    expect(getAndroidVersionCodeFromReleaseTag("v26050802")).toBe("26050802");
    expect(getAndroidVersionCodeFromReleaseTag("26050803")).toBe("26050803");
  });

  it("accepts nine-digit Android version codes reserved for future format upgrades", () => {
    expect(getAndroidVersionCodeFromReleaseTag("android-126050801")).toBe("126050801");
  });

  it("rejects seven-digit and ten-digit Android release tags", () => {
    expect(getAndroidVersionCodeFromReleaseTag("android-2605081")).toBeNull();
    expect(getAndroidVersionCodeFromReleaseTag("android-1260508011")).toBeNull();
  });

  it("rejects tags that are not Android version codes", () => {
    expect(getAndroidVersionCodeFromReleaseTag("android-debug-latest")).toBeNull();
    expect(getAndroidVersionCodeFromReleaseTag("v0.1.0")).toBeNull();
  });
});

describe("getAndroidApkUpdateFromRelease", () => {
  it("returns APK update details when the release is newer", () => {
    expect(getAndroidApkUpdateFromRelease(release, "26050701")).toEqual({
      versionCode: "26050801",
      pageUrl: "https://github.com/HaiouZh/TimeData/releases/tag/android-26050801",
      apkName: "timedata-debug.apk",
      apkUrl: "https://example.com/timedata-debug.apk",
      hasUpdate: true,
    });
  });

  it("returns APK details without update when the version is not newer", () => {
    expect(getAndroidApkUpdateFromRelease(release, "26050801")?.hasUpdate).toBe(false);
  });

  it("returns null when the release has no APK asset", () => {
    expect(getAndroidApkUpdateFromRelease({ ...release, assets: release.assets.slice(0, 1) }, "26050701")).toBeNull();
  });
});

describe("getAndroidApkUpdateUrl", () => {
  it("opens the GitHub release page (not the .apk asset) for browser compatibility", () => {
    const update = getAndroidApkUpdateFromRelease(release, "26050701");

    expect(update).not.toBeNull();
    expect(getAndroidApkUpdateUrl(update!)).toBe("https://github.com/HaiouZh/TimeData/releases/tag/android-26050801");
  });
});

describe("openAndroidApkUpdate", () => {
  it("delegates opening the release page URL to the provided opener", async () => {
    const update = getAndroidApkUpdateFromRelease(release, "26050701");
    const opened: string[] = [];

    await openAndroidApkUpdate(update!, async (url) => {
      opened.push(url);
    });

    expect(opened).toEqual(["https://github.com/HaiouZh/TimeData/releases/tag/android-26050801"]);
  });
});

describe("fetchAndroidApkUpdate", () => {
  it("parses a valid GitHub release response", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(release), { status: 200 })) as unknown as typeof fetch;

    await expect(fetchAndroidApkUpdate("26050701")).resolves.toMatchObject({
      versionCode: "26050801",
      hasUpdate: true,
    });
  });

  it("rejects GitHub rate-limit JSON", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: "API rate limit exceeded", documentation_url: "https://docs.github.com" }), {
        status: 200,
      })
    ) as unknown as typeof fetch;

    await expect(fetchAndroidApkUpdate("26050701")).rejects.toThrow("GitHub Release 响应格式无效");
  });

  it("rejects release JSON with missing fields", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ tag_name: "android-26050801" }), { status: 200 })) as unknown as typeof fetch;

    await expect(fetchAndroidApkUpdate("26050701")).rejects.toThrow("GitHub Release 响应格式无效");
  });
});
