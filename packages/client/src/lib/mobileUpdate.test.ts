import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchMobileAppUpdate,
  getMobileUpdateFromRelease,
  getMobileVersionCodeFromReleaseTag,
  openMobileAppUpdate,
} from "./mobileUpdate.js";

const originalFetch = globalThis.fetch;

const release = {
  tag_name: "v26050802",
  html_url: "https://github.com/HaiouZh/TimeData/releases/tag/v26050802",
  assets: [
    {
      name: "notes.txt",
      browser_download_url: "https://example.com/notes.txt",
    },
    {
      name: "timedata-release.apk",
      browser_download_url: "https://example.com/timedata-release.apk",
    },
    {
      name: "TimeData-unsigned.ipa",
      browser_download_url: "https://example.com/TimeData-unsigned.ipa",
    },
  ],
};

const legacyAndroidRelease = {
  tag_name: "android-26050801",
  html_url: "https://github.com/HaiouZh/TimeData/releases/tag/android-26050801",
  assets: [
    {
      name: "timedata-debug.apk",
      browser_download_url: "https://example.com/timedata-debug.apk",
    },
  ],
};

const legacyIosRelease = {
  tag_name: "ios-26050801",
  html_url: "https://github.com/HaiouZh/TimeData/releases/tag/ios-26050801",
  assets: [
    {
      name: "TimeData-unsigned.ipa",
      browser_download_url: "https://example.com/legacy.ipa",
    },
  ],
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("getMobileVersionCodeFromReleaseTag", () => {
  it("accepts eight-digit release tags with same-day sequence（v / android- / ios- / 裸数字）", () => {
    expect(getMobileVersionCodeFromReleaseTag("android-26050801")).toBe("26050801");
    expect(getMobileVersionCodeFromReleaseTag("ios-26050801")).toBe("26050801");
    expect(getMobileVersionCodeFromReleaseTag("v26050802")).toBe("26050802");
    expect(getMobileVersionCodeFromReleaseTag("26050803")).toBe("26050803");
  });

  it("accepts nine-digit version codes reserved for future format upgrades", () => {
    expect(getMobileVersionCodeFromReleaseTag("android-126050801")).toBe("126050801");
  });

  it("rejects seven-digit and ten-digit release tags", () => {
    expect(getMobileVersionCodeFromReleaseTag("android-2605081")).toBeNull();
    expect(getMobileVersionCodeFromReleaseTag("android-1260508011")).toBeNull();
  });

  it("rejects tags that are not version codes", () => {
    expect(getMobileVersionCodeFromReleaseTag("android-debug-latest")).toBeNull();
    expect(getMobileVersionCodeFromReleaseTag("v0.1.0")).toBeNull();
  });
});

describe("getMobileUpdateFromRelease — 按平台挑资产", () => {
  it("android 取 .apk 资产，返回直链", () => {
    expect(getMobileUpdateFromRelease(release, "26050701", "android")).toEqual({
      versionCode: "26050802",
      pageUrl: "https://github.com/HaiouZh/TimeData/releases/tag/v26050802",
      assetName: "timedata-release.apk",
      assetUrl: "https://example.com/timedata-release.apk",
      hasUpdate: true,
    });
  });

  it("ios 取 .ipa 资产，返回直链", () => {
    expect(getMobileUpdateFromRelease(release, "26050701", "ios")).toEqual({
      versionCode: "26050802",
      pageUrl: "https://github.com/HaiouZh/TimeData/releases/tag/v26050802",
      assetName: "TimeData-unsigned.ipa",
      assetUrl: "https://example.com/TimeData-unsigned.ipa",
      hasUpdate: true,
    });
  });

  it("版本不更新时 hasUpdate=false", () => {
    expect(getMobileUpdateFromRelease(release, "26050802", "android")?.hasUpdate).toBe(false);
    expect(getMobileUpdateFromRelease(release, "26050802", "ios")?.hasUpdate).toBe(false);
  });

  it("release 缺该平台资产时返回 null（.ipa 不会被当成 APK，反之亦然）", () => {
    expect(getMobileUpdateFromRelease(legacyIosRelease, "26050701", "android")).toBeNull();
    expect(getMobileUpdateFromRelease(legacyAndroidRelease, "26050701", "ios")).toBeNull();
  });
});

describe("openMobileAppUpdate — 直链优先", () => {
  const update = getMobileUpdateFromRelease(release, "26050701", "android")!;
  const iosUpdate = getMobileUpdateFromRelease(release, "26050701", "ios")!;

  it("ios：外链通道直接打开 .ipa 直链（Safari 下载、SideStore 导入）", async () => {
    const opened: string[] = [];
    await openMobileAppUpdate(iosUpdate, "ios", {
      browserOpen: async (url) => {
        opened.push(`browser:${url}`);
      },
      external: (url) => {
        opened.push(`external:${url}`);
      },
    });
    expect(opened).toEqual(["external:https://example.com/TimeData-unsigned.ipa"]);
  });

  it("android：应用内浏览器（Custom Tabs）打开 .apk 直链——不经系统 ACTION_VIEW 分发（那条链路部分机型静默无反应）", async () => {
    const opened: string[] = [];
    await openMobileAppUpdate(update, "android", {
      browserOpen: async (url) => {
        opened.push(`browser:${url}`);
      },
      external: (url) => {
        opened.push(`external:${url}`);
      },
    });
    expect(opened).toEqual(["browser:https://example.com/timedata-release.apk"]);
  });

  it("android：直链通道失败时兜底打开 Release 页（历史坑保底，链路确定性最强）", async () => {
    const opened: string[] = [];
    await openMobileAppUpdate(update, "android", {
      browserOpen: async () => {
        throw new Error("Browser plugin unavailable");
      },
      external: (url) => {
        opened.push(`external:${url}`);
      },
    });
    expect(opened).toEqual(["external:https://github.com/HaiouZh/TimeData/releases/tag/v26050802"]);
  });
});

function mockReleasesResponse(body: unknown, status = 200) {
  globalThis.fetch = vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe("fetchMobileAppUpdate", () => {
  it("parses a valid GitHub release list (android)", async () => {
    mockReleasesResponse([release]);

    await expect(fetchMobileAppUpdate("26050701", "android")).resolves.toMatchObject({
      versionCode: "26050802",
      hasUpdate: true,
    });
  });

  // 2026-07-30 线上事故的泛化版：历史上 Android 与 iOS 是两个独立 release（android-* / ios-*），
  // 列表顺序与发布先后相关。按平台扫列表：跳过缺本平台资产的 release，直到找到能用的。
  it("android：跳过只有 .ipa 的 legacy iOS release，仍能找到带 APK 的", async () => {
    mockReleasesResponse([legacyIosRelease, legacyAndroidRelease]);

    await expect(fetchMobileAppUpdate("26050701", "android")).resolves.toMatchObject({
      versionCode: "26050801",
      assetName: "timedata-debug.apk",
    });
  });

  it("ios：跳过只有 .apk 的 legacy Android release，仍能找到带 IPA 的", async () => {
    mockReleasesResponse([legacyAndroidRelease, legacyIosRelease]);

    await expect(fetchMobileAppUpdate("26050701", "ios")).resolves.toMatchObject({
      versionCode: "26050801",
      assetName: "TimeData-unsigned.ipa",
    });
  });

  it("列表里没有本平台资产时返回 null", async () => {
    mockReleasesResponse([legacyAndroidRelease]);

    await expect(fetchMobileAppUpdate("26050701", "ios")).resolves.toBeNull();
  });

  it("returns null when the repository has no releases yet", async () => {
    mockReleasesResponse([]);

    await expect(fetchMobileAppUpdate("26050701", "android")).resolves.toBeNull();
  });

  it("rejects GitHub rate-limit JSON", async () => {
    mockReleasesResponse({ message: "API rate limit exceeded", documentation_url: "https://docs.github.com" });

    await expect(fetchMobileAppUpdate("26050701", "android")).rejects.toThrow("GitHub Release 响应格式无效");
  });

  it("rejects release JSON with missing fields", async () => {
    mockReleasesResponse([{ tag_name: "android-26050801" }]);

    await expect(fetchMobileAppUpdate("26050701", "android")).rejects.toThrow("GitHub Release 响应格式无效");
  });
});
