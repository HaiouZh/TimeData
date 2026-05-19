export function validateServerUrl(serverUrl: string): string | null {
  try {
    const url = new URL(serverUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return serverUrl;
  } catch {
    return null;
  }
}
