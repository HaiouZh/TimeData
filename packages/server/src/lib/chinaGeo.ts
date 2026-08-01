import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface ChinaGeo {
  province: string;
  city: string | null;
  isp: string | null;
}

// src/lib/ 与 dist/lib/ 深度相同,所以本地开发(packages/server/assets/)与
// 镜像(/app/assets/)同一行代码都落得对。不能放 data/:.dockerignore 排除了它,
// 且 compose 的 ./data:/app/data 挂载会把镜像里的同名目录整个遮住。
const TABLE_PATH = fileURLToPath(new URL("../../assets/china-geo.bin", import.meta.url));
const MAGIC = "TDCN";
const HEADER_BYTES = 18;
const ENTRY_BYTES = 10;

type Region = [province: string, city: string | null, isp: string | null];
type Table = { buf: Buffer; count: number; regions: Region[] };

// null = 尚未尝试加载;加载失败也缓存,避免每次查询都读盘。
let table: Table | null | undefined;

function loadTable(): Table | null {
  try {
    const buf = readFileSync(TABLE_PATH);
    if (buf.length < HEADER_BYTES || buf.subarray(0, 4).toString("ascii") !== MAGIC) return null;
    const count = buf.readUInt32BE(10);
    const poolLen = buf.readUInt32BE(14);
    const poolAt = HEADER_BYTES + count * ENTRY_BYTES;
    if (buf.length < poolAt + poolLen) return null;
    const regions = JSON.parse(buf.subarray(poolAt, poolAt + poolLen).toString("utf8")) as Region[];
    return { buf, count, regions };
  } catch {
    return null;
  }
}

function getTable(): Table | null {
  if (table === undefined) {
    table = loadTable();
    if (table === null) console.warn(`[chinaGeo] 中国段表未就绪(${TABLE_PATH})，中国 IP 降级为只有国家`);
  }
  return table;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipToU32(ip: string): number | null {
  const m = IPV4.exec(ip);
  if (!m) return null;
  let value = 0;
  for (let i = 1; i <= 4; i++) {
    const part = Number(m[i]);
    if (part > 255) return null;
    value = value * 256 + part;
  }
  return value;
}

/** 查中国段表。非 IPv4 / 表缺失 / 未命中均返回 null——调用方按「不是中国」处理，不得抛。 */
export function lookupChinaGeo(ip: string): ChinaGeo | null {
  const value = ipToU32(ip);
  if (value === null) return null;
  const loaded = getTable();
  if (loaded === null) return null;

  const { buf, count, regions } = loaded;
  let lo = 0;
  let hi = count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const at = HEADER_BYTES + mid * ENTRY_BYTES;
    const start = buf.readUInt32BE(at);
    if (value < start) {
      hi = mid - 1;
      continue;
    }
    if (value > buf.readUInt32BE(at + 4)) {
      lo = mid + 1;
      continue;
    }
    const region = regions[buf.readUInt16BE(at + 8)];
    if (region === undefined) return null;
    return { province: region[0], city: region[1], isp: region[2] };
  }
  return null;
}

/** 表是否加载成功。会触发懒加载(与首次查询同一条路径)。 */
export function isChinaTableReady(): boolean {
  return getTable() !== null;
}

/** 仅测试用：清缓存，让下次查询重新读盘。 */
export function resetChinaGeoForTests(): void {
  table = undefined;
}
