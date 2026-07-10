# TimeData Mobile

This package contains the Capacitor Android shell for TimeData.

## 本地环境

Android APK 构建需要：

- Node.js 22+
- pnpm 11+
- JDK 21
- Android SDK Platform 35
- Android SDK Build-Tools 35.0.0
- Android SDK Platform-Tools
- Android SDK Command-line Tools
- Android Studio 可用于打开 `packages/mobile/android`

常用命令：

```bash
pnpm build:mobile
pnpm build:mobile:apk
pnpm --filter @timedata/mobile android:open
```

如果新机器不能运行 Gradle，安装 Android Studio 或 Android command-line tools 后，安装 SDK Platform 35、Build-Tools 35.0.0、Platform-Tools，并执行 `sdkmanager --licenses`。

## Build Android web assets

```bash
pnpm --filter @timedata/mobile build:web
```

This runs the client mobile Vite build. Mobile mode uses relative asset paths and disables the PWA service worker.

## Sync Android project

```bash
pnpm --filter @timedata/mobile android:sync
```

## Build debug APK

From the repository root:

```bash
pnpm build:mobile:apk
```

Or from this package:

```bash
pnpm --filter @timedata/mobile android:debug
```

The debug APK is written to:

```text
packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

## Build signed release APK

Release builds require the stable TimeData keystore. Keep the keystore out of git; `packages/mobile/android/.gitignore` ignores `*.keystore` and `*.jks`.

From the repository root:

```bash
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_STORE_FILE=../timedata-release.keystore \
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_STORE_PASSWORD=... \
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_KEY_ALIAS=... \
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_KEY_PASSWORD=... \
pnpm build:mobile:release-apk
```

The release APK is written to:

```text
packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

GitHub Actions builds the signed release APK with repository Secrets and publishes it to the latest GitHub Release. The Android app's Settings → APK 更新 action opens that Release page in the system browser so users can download and install the APK manually.

If a device currently has a debug-signed build installed, Android will reject the first release-signed APK as a signature mismatch. Export a backup, uninstall the old app, install the release APK, then restore/sync data. Later release-signed APKs can update over this build.

## Open in Android Studio

```bash
pnpm --filter @timedata/mobile android:open
```

## Run on a connected Android device

```bash
pnpm --filter @timedata/mobile android:run
```

## Sync configuration on Android

In the Android app Settings page:

- API 地址 should be the server origin only, for example `https://timedata.yanzhou.icu`.
- Do not append `/api` to the API address.
- Token should be pasted as the raw token. Do not prefix it with `Bearer `.

If sync says it cannot connect, first confirm the displayed URL uses the correct domain. A typo such as `timedate.yanzhou.icu` instead of `timedata.yanzhou.icu` will fail before reaching the server.

## Phase 5.3 manual validation

1. Launch the Android app.
2. Confirm TimeData opens to the timeline page.
3. Confirm the bottom navigation contains only the entries enabled in `设置 → 导航`, plus `设置`, and has no three-dot menu.
4. Disable one phone bottom-bar entry in `设置 → 导航`; confirm it disappears from the bottom bar and appears in `设置 → 更多功能`.
5. Re-enable that entry and confirm it moves back to the bottom bar.
6. Add one time entry.
7. Kill and reopen the app.
8. Confirm the entry remains, proving IndexedDB persistence in WebView.
9. Open Settings.
10. Configure API 地址 and Token.
11. Tap `立即同步` and confirm sync succeeds.
12. Export a full Backup JSON file.
13. Restore from that Backup JSON file.
14. Confirm categories and time entries match the backup.
