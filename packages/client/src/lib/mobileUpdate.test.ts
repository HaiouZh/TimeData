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

const iosRelease = {
  tag_name: "ios-26050801",
  html_url: "https://github.com/HaiouZh/TimeData/releases/tag/ios-26050801",
  assets: [
    {
      name: "TimeData-unsigned.ipa",
      browser_download_url: "https://example.com/TimeData-unsigned.ipa",
    },
  ],
};

function mockReleasesResponse(body: unknown, status = 200) {
  globalThis.fetch = vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe("fetchAndroidApkUpdate", () => {
  it("parses a valid GitHub release list", async () => {
    mockReleasesResponse([release]);

    await expect(fetchAndroidApkUpdate("26050701")).resolves.toMatchObject({
      versionCode: "26050801",
      hasUpdate: true,
    });
  });

  // 2026-07-30 线上事故：Android 与 iOS 的 release 由同一次 CI 几乎同时创建,
  // GitHub 的 /releases/latest 取创建时间最晚的那个。iOS 晚 1 秒顶掉 Android 后,
  // tag 变成 ios-*、资产只剩 .ipa,APK 检查直接报「还没有可下载的 Android APK Release」。
  it("跳过排在前面的 iOS release，仍能找到 Android 的 APK", async () => {
    mockReleasesResponse([iosRelease, release]);

    await expect(fetchAndroidApkUpdate("26050701")).resolves.toMatchObject({
      versionCode: "26050801",
      apkName: "timedata-debug.apk",
      hasUpdate: true,
    });
  });

  it("列表里只有 iOS release 时返回 null，而不是把 .ipa 当成 APK", async () => {
    mockReleasesResponse([iosRelease]);

    await expect(fetchAndroidApkUpdate("26050701")).resolves.toBeNull();
  });

  it("returns null when the repository has no releases yet", async () => {
    mockReleasesResponse([]);

    await expect(fetchAndroidApkUpdate("26050701")).resolves.toBeNull();
  });

  it("rejects GitHub rate-limit JSON", async () => {
    mockReleasesResponse({ message: "API rate limit exceeded", documentation_url: "https://docs.github.com" });

    await expect(fetchAndroidApkUpdate("26050701")).rejects.toThrow("GitHub Release 响应格式无效");
  });

  it("rejects release JSON with missing fields", async () => {
    mockReleasesResponse([{ tag_name: "android-26050801" }]);

    await expect(fetchAndroidApkUpdate("26050701")).rejects.toThrow("GitHub Release 响应格式无效");
  });
});
