import { AppLauncher } from "@capacitor/app-launcher";
import { Browser } from "@capacitor/browser";

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: GitHubReleaseAsset[];
}

function isGitHubReleaseAsset(value: unknown): value is GitHubReleaseAsset {
  return Boolean(
    value &&
      typeof value === "object" &&
      "name" in value &&
      typeof value.name === "string" &&
      "browser_download_url" in value &&
      typeof value.browser_download_url === "string",
  );
}

function isGitHubRelease(value: unknown): value is GitHubRelease {
  return Boolean(
    value &&
      typeof value === "object" &&
      "tag_name" in value &&
      typeof value.tag_name === "string" &&
      "html_url" in value &&
      typeof value.html_url === "string" &&
      "assets" in value &&
      Array.isArray(value.assets) &&
      value.assets.every(isGitHubReleaseAsset),
  );
}

// 一次 CI 产出单个 Release（APK + IPA 同页）；30 条足够回溯最近的移动端版本。
const RELEASES_PAGE_SIZE = 30;

export type MobilePlatform = "android" | "ios";

export interface MobileAppUpdate {
  versionCode: string;
  pageUrl: string;
  assetName: string;
  assetUrl: string;
  hasUpdate: boolean;
}

const PLATFORM_ASSET_EXT: Record<MobilePlatform, string> = {
  android: ".apk",
  ios: ".ipa",
};

export function getMobileVersionCodeFromReleaseTag(tagName: string): string | null {
  // 8 位 = 现行 yymmddNN；放宽到 9 位给未来版本号格式升位留门。
  // 收窄这个正则前要先确认所有已分发 APK/IPA 都带着放宽后的解析逻辑。
  // 前缀齐收 v / android- / ios-：现行 tag 是 v*（APK + IPA 同页），android-*/ios-* 是历史
  // 分立发布的遗留；平台归属不由 tag 前缀定，由下面的资产扩展名定。
  const match = tagName.match(/^(?:android-|ios-|v)?(\d{8,9})$/);
  return match?.[1] ?? null;
}

export function getMobileUpdateFromRelease(
  release: GitHubRelease,
  currentVersionCode: string,
  platform: MobilePlatform,
): MobileAppUpdate | null {
  const versionCode = getMobileVersionCodeFromReleaseTag(release.tag_name);
  if (!versionCode) return null;

  const ext = PLATFORM_ASSET_EXT[platform];
  const asset = release.assets.find((a) => a.name.toLowerCase().endsWith(ext));
  if (!asset) return null;

  return {
    versionCode,
    pageUrl: release.html_url,
    assetName: asset.name,
    assetUrl: asset.browser_download_url,
    hasUpdate: Number(versionCode) > Number(currentVersionCode),
  };
}

export interface MobileUpdateOpeners {
  /** 应用内浏览器（Android = Chrome Custom Tabs）。 */
  browserOpen: (url: string) => Promise<void>;
  /** 通用外链通道（AppLauncher → Browser → window.open 三级兜底）。 */
  external: (url: string) => Promise<void> | void;
}

const defaultOpeners: MobileUpdateOpeners = {
  browserOpen: async (url) => {
    await Browser.open({ url });
  },
  external: openExternalUrl,
};

/**
 * 打开更新下载：**直链优先**（用户点了就该开始下载，不是落到 Release 页再找资产）。
 *
 * - iOS：外链通道直接开 `.ipa` 直链——Safari 下载进文件，SideStore/AltStore 导入即装，无历史坑。
 * - Android：**跳过 AppLauncher、直接用应用内浏览器（Custom Tabs）开 `.apk` 直链**。历史坑：
 *   ACTION_VIEW 把 .apk URL 交系统分发时，部分机型/浏览器组合被静默甩给下载管理器，表现为
 *   「选了浏览器但什么都没发生」（这曾是改跳 Release 页的原因）。Custom Tabs 在应用内直接触发
 *   下载、不经系统分发；它不可用（插件缺席等）时兜底回 Release 页——普通 HTML 谁都能渲染，
 *   链路确定性最强的老路。
 */
export async function openMobileAppUpdate(
  update: MobileAppUpdate,
  platform: MobilePlatform,
  openers: MobileUpdateOpeners = defaultOpeners,
): Promise<void> {
  if (platform === "android") {
    try {
      await openers.browserOpen(update.assetUrl);
      return;
    } catch {
      await openers.external(update.pageUrl);
      return;
    }
  }
  await openers.external(update.assetUrl);
}

async function openExternalUrl(url: string): Promise<void> {
  // AppLauncher.openUrl 不抛错，靠返回的 completed 字段判断是否真的派发出去；
  // completed=false（多见于 Android 11+ 包可见性未配置、URL 没人接）时落到
  // Browser.open（Chrome Custom Tabs），最后 window.open 兜底非原生环境。
  try {
    const result = await AppLauncher.openUrl({ url });
    if (result.completed) return;
  } catch {
    // AppLauncher 抛错（如插件未注册），继续 fallback
  }
  try {
    await Browser.open({ url });
    return;
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function fetchMobileAppUpdate(
  currentVersionCode: string,
  platform: MobilePlatform,
): Promise<MobileAppUpdate | null> {
  // 故意扫列表而不用 /releases/latest：历史上 Android 与 iOS 是两个独立 release（android-* /
  // ios-*），"latest" 取创建时间最晚的那个、资产可能不含本平台的包。列表按创建时间倒序，
  // 取第一个能解析出版本号且带本平台资产的 release 才与发布先后无关。
  const res = await fetch(`https://api.github.com/repos/HaiouZh/TimeData/releases?per_page=${RELEASES_PAGE_SIZE}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub Release 检查失败：${res.status}`);

  const payload: unknown = await res.json();
  // 限流等错误响应是对象而非数组，落在这里而不是被当成"没有 release"静默放过。
  if (!Array.isArray(payload)) throw new Error("GitHub Release 响应格式无效");
  const releases = payload.filter(isGitHubRelease);
  if (payload.length > 0 && releases.length === 0) throw new Error("GitHub Release 响应格式无效");

  for (const release of releases) {
    const update = getMobileUpdateFromRelease(release, currentVersionCode, platform);
    if (update) return update;
  }
  return null;
}
