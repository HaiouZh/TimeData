import { readFileSync } from "node:fs";
import path from "node:path";
import { type AsnResponse, type CityResponse, Reader, validate } from "maxmind";

export interface GeoLookup {
  country: string | null;
  city: string | null;
  asn: number | null;
  asnOrg: string | null;
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

// maxmind 的 openSync 是 () => never、open 是异步，而 lookupGeo 必须同步
// (requestAudit 在 finally 里同步调用)，所以走 mmdb-lib 的 Reader(Buffer) 构造器。
function openReader<T extends CityResponse | AsnResponse>(fileName: string): Reader<T> | null {
  try {
    return new Reader<T>(readFileSync(path.join(geoipDir(), fileName)));
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
      asn: asnRow?.autonomous_system_number ?? null,
      asnOrg: asnRow?.autonomous_system_organization ?? null,
    };
  } catch {
    return null;
  }
}

/** 仅测试用：清 reader 缓存，让下次查询按当前 GEOIP_DIR 重新加载。 */
export function resetGeoipForTests(): void {
  readers = null;
}
