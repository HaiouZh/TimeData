import { describe, expect, it } from "vitest";
import { getAndroidApkUpdateFromRelease, getAndroidApkUpdateUrl, getAndroidVersionCodeFromReleaseTag, openAndroidApkUpdate } from "./mobileUpdate.js";

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

describe("getAndroidVersionCodeFromReleaseTag", () => {
  it("accepts eight-digit Android release tags with same-day sequence", () => {
    expect(getAndroidVersionCodeFromReleaseTag("android-26050801")).toBe("26050801");
    expect(getAndroidVersionCodeFromReleaseTag("v26050802")).toBe("26050802");
    expect(getAndroidVersionCodeFromReleaseTag("26050803")).toBe("26050803");
  });

  it("rejects seven-digit Android release tags", () => {
    expect(getAndroidVersionCodeFromReleaseTag("android-2605081")).toBeNull();
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
  it("opens the APK asset URL", () => {
    const update = getAndroidApkUpdateFromRelease(release, "26050701");

    expect(update).not.toBeNull();
    expect(getAndroidApkUpdateUrl(update!)).toBe("https://example.com/timedata-debug.apk");
  });
});

describe("openAndroidApkUpdate", () => {
  it("delegates opening the APK asset URL to the provided opener", async () => {
    const update = getAndroidApkUpdateFromRelease(release, "26050701");
    const opened: string[] = [];

    await openAndroidApkUpdate(update!, async (url) => {
      opened.push(url);
    });

    expect(opened).toEqual(["https://example.com/timedata-debug.apk"]);
  });
});
