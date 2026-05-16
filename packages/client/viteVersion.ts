export function readAndroidVersionCode(
  env: Record<string, string | undefined> = process.env,
  now = new Date(),
): string {
  if (env.TIMEDATA_ANDROID_VERSION_CODE) {
    return env.TIMEDATA_ANDROID_VERSION_CODE;
  }

  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}01`;
}
