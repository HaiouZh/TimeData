export function success<T extends object>(value: T): string {
  return JSON.stringify({ ok: true, ...value }, null, 2);
}

export function failure(code: string, message: string, details?: Record<string, unknown>): string {
  return JSON.stringify({ ok: false, error: details ? { code, message, details } : { code, message } }, null, 2);
}
