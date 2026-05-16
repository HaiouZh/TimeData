# TimeData Mobile

This package contains the Capacitor Android shell for TimeData.

## Prerequisites

Android debug APK builds require:

- JDK 17
- Android SDK Platform 34
- Android SDK Build-Tools 34.0.0
- Android SDK Platform-Tools
- Android SDK Command-line Tools

The local build used these Windows paths:

```text
JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot
ANDROID_HOME=C:\Users\yanzh\AppData\Local\Android\Sdk
```

If a new machine cannot run Gradle, install Android Studio or the Android command-line tools, then install:

```bash
sdkmanager --sdk_root="C:\Users\yanzh\AppData\Local\Android\Sdk" "platform-tools" "platforms;android-34" "build-tools;34.0.0"
sdkmanager --sdk_root="C:\Users\yanzh\AppData\Local\Android\Sdk" --licenses
```

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
3. Tap bottom navigation tabs: `时间轴`, `统计`, `分类`, `设置`.
4. Add one time entry.
5. Kill and reopen the app.
6. Confirm the entry remains, proving IndexedDB persistence in WebView.
7. Open Settings.
8. Configure API 地址 and Token.
9. Tap `立即同步` and confirm sync succeeds.
10. Export a full Backup JSON file.
11. Restore from that Backup JSON file.
12. Confirm categories and time entries match the backup.
