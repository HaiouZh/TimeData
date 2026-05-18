export function allowedOriginsFromEnv(env: Record<string, string | undefined>): string[] {
  const origins = env.ALLOWED_ORIGINS;
  if (origins === undefined) return [];
  return origins
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
