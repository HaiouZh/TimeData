import { readFileSync } from "node:fs";
import path from "node:path";
import { type AsnResponse, type CityResponse, Reader, validate } from "maxmind";

export interface GeoLookup {
  country: string | null;
  city: string | null;
  /** GeoLite2 的城市数字 ID。收敛键用它而非本地化城市名——见 ipScope.ts。 */
  cityGeonameId: number | null;
  asn: number | null;
  asnOrg: string | null;
}

/** 两个库各自是否就绪。半加载态下收敛档会变宽，所以要分库报告、让洞察页看得见。 */
export interface GeoipReadiness {
  city: boolean;
  asn: boolean;
}

type LoadedReaders = {
  city: Reader<CityResponse> | null;
  asn: Reader<AsnResponse> | null;
};

// null = 尚未尝试加载。加载结果(含失败)会被缓存，避免每次查询都读盘。
let readers: LoadedReaders | null = null;

function geoipDir(): string {
  return process.env.GEOIP_DIR || "/app/data/geoip";
}

/**
 * mmdb-lib 不传 cache 时 decoder 走 noCache，每次查询都重新解码数据段。
 * maxmind.open() 内部会挂一个 LRU；同步构造这条路要自己补，否则日志页单页
 * 500 行 = 1000 次全量解码。满了整体清空即可，不值得为此引第三方 LRU。
 */
function createDecodeCache(): { get(key: string | number): unknown; set(key: string | number, value: unknown): void } {
  const store = new Map<string | number, unknown>();
  return {
    get: (key) => store.get(key),
    set: (key, value) => {
      if (store.size >= 10_000) store.clear();
      store.set(key, value);
    },
  };
}

// maxmind 的 openSync 是 () => never、open 是异步，而 lookupGeo 必须同步
// (requestAudit 在 finally 里同步调用)，所以走 mmdb-lib 的 Reader(Buffer) 构造器。
// 代价：readFileSync 把整库读进内存常驻(City ≈ 60MB + ASN ≈ 9MB)，不是 mmap。
function openReader<T extends CityResponse | AsnResponse>(fileName: string): Reader<T> | null {
  try {
    return new Reader<T>(readFileSync(path.join(geoipDir(), fileName)), { cache: createDecodeCache() });
  } catch {
    return null;
  }
}

function getReaders(): LoadedReaders {
  if (readers === null) {
    readers = {
      city: openReader<CityResponse>("GeoLite2-City.mmdb"),
      asn: openReader<AsnResponse>("GeoLite2-ASN.mmdb"),
    };
    if (!readers.city || !readers.asn) {
      console.warn(`[geoip] GeoLite2 mmdb 未就绪(${geoipDir()})，归属地降级为未知`);
    }
  }
  return readers;
}

function pickName(names: { readonly en: string; readonly "zh-CN"?: string } | undefined): string | null {
  if (!names) return null;
  return names["zh-CN"] ?? names.en ?? null;
}

/** 查 IP 归属地。库缺失 / IP 非法 / 查不到均返回 null——调用方按「未知」处理，不得抛。 */
export function lookupGeo(ip: string): GeoLookup | null {
  if (!validate(ip)) return null;
  const { city, asn } = getReaders();
  if (!city && !asn) return null;
  try {
    const cityRow = city?.get(ip) ?? null;
    const asnRow = asn?.get(ip) ?? null;
    if (!cityRow && !asnRow) return null;
    return {
      country: pickName(cityRow?.country?.names),
      city: pickName(cityRow?.city?.names),
      cityGeonameId: cityRow?.city?.geoname_id ?? null,
      asn: asnRow?.autonomous_system_number ?? null,
      asnOrg: asnRow?.autonomous_system_organization ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * 两个 mmdb 各自是否加载成功。会触发懒加载(与首次查询同一条路径)。
 * 单缺一个不是「整体降级」：缺 City 走 asn 档(有运营商无地名)，缺 ASN 走 net 档(有地名)。
 */
export function getGeoipReadiness(): GeoipReadiness {
  const { city, asn } = getReaders();
  return { city: city !== null, asn: asn !== null };
}

/** 仅测试用：清 reader 缓存，让下次查询按当前 GEOIP_DIR 重新加载。 */
export function resetGeoipForTests(): void {
  readers = null;
}
