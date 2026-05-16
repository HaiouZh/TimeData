import crypto from "node:crypto";

interface TokenRecord<T> {
  expiresAt: number;
  payload: T;
}

export function createTokenStore<T>(ttlMs: number) {
  const records = new Map<string, TokenRecord<T>>();

  function prune(now = Date.now()) {
    for (const [token, record] of records.entries()) {
      if (record.expiresAt <= now) {
        records.delete(token);
      }
    }
  }

  return {
    create(payload: T, now = Date.now()): { token: string; expiresAt: Date } {
      prune(now);
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(now + ttlMs);
      records.set(token, { expiresAt: expiresAt.getTime(), payload });
      return { token, expiresAt };
    },

    consume(token: string, now = Date.now()): T | null {
      prune(now);
      const record = records.get(token);
      if (!record) {
        return null;
      }
      records.delete(token);
      return record.payload;
    },
  };
}
