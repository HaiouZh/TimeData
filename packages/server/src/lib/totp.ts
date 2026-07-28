import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_MS = 30_000;

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`invalid base32 char: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function totpCode(secretBase32: string, timeMs: number): string {
  const counter = Math.floor(timeMs / STEP_MS);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secretBase32)).update(counterBuf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotpCode(secretBase32: string, code: string, timeMs: number): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  let matches = false;
  for (const stepOffset of [-1, 0, 1]) {
    const expected = totpCode(secretBase32, timeMs + stepOffset * STEP_MS);
    // 恒定比较,避免逐字符早退的时序侧信道
    const equal = timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(code, "utf8"));
    matches = matches || equal;
  }
  return matches;
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(secretBase32: string, label: string): string {
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secretBase32}&issuer=${encodeURIComponent(label)}&algorithm=SHA1&digits=6&period=30`;
}

export function generateRecoveryCodes(count = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    // 注:plan 原稿用 randomBytes(5).toString("base64url") 只有 7 字符,永远凑不满 8 位会死循环;
    // 改用 4 字节 hex,恒为 8 位 [0-9a-f],满足 [a-z0-9]{4}-[a-z0-9]{4} 格式
    const raw = randomBytes(4).toString("hex");
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return [...codes];
}
