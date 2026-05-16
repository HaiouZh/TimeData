export function allowedOriginsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const origins = env.ALLOWED_ORIGINS ?? "*";
  return origins
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
