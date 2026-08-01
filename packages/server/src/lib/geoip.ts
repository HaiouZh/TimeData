import { readFileSync } from "node:fs";
import path from "node:path";
import { type AsnResponse, type CityResponse, Reader, validate } from "maxmind";
import { isChinaTableReady, lookupChinaGeo, resetChinaGeoForTests } from "./chinaGeo.js";

export interface GeoLookup {
  country: string | null;
  /** 省。只有中国段表命中时非 null——GeoLite2 路径不产出这一级。收敛键靠它,见 ipScope.ts。 */
  region: string | null;
  city: string | null;
  /** GeoLite2 的城市数字 ID。中国段表没有它,那一档的键改用中文省市。 */
  cityGeonameId: number | null;
  asn: number | null;
  asnOrg: string | null;
}

/** 两个库各自是否就绪。半加载态下收敛档会变宽，所以要分库报告、让洞察页看得见。 */
export interface GeoipReadiness {
  city: boolean;
  asn: boolean;
  /** 中国段表。它随镜像发布,为 false 说明构建或镜像有问题。 */
  chinaTable: boolean;
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
  try {
    const asnRow = asn?.get(ip) ?? null;
    // 中国段表优先:GeoLite2 免费库对中国运营商段没有 city 级数据(ADR 0028)。
    // ASN 号仍取自 GeoLite2-ASN——收敛键要数字 ASN,中国表不提供。
    const cn = lookupChinaGeo(ip);
    if (cn !== null) {
      return {
        country: "中国",
        region: cn.province,
        city: cn.city,
        cityGeonameId: null,
        asn: asnRow?.autonomous_system_number ?? null,
        asnOrg: cn.isp ?? asnRow?.autonomous_system_organization ?? null,
      };
    }
    const cityRow = city?.get(ip) ?? null;
    if (!cityRow && !asnRow) return null;
    return {
      country: pickName(cityRow?.country?.names),
      region: null,
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
  return { city: city !== null, asn: asn !== null, chinaTable: isChinaTableReady() };
}

/** 仅测试用：清 reader 与中国表缓存，让下次查询按当前环境重新加载。 */
export function resetGeoipForTests(): void {
  readers = null;
  resetChinaGeoForTests();
}

/**
 * 省市拼成对外展示的一串。省是市的前缀时只出一个——直辖市归一后省=北京、市=北京市,
 * 不去重会打出「北京 北京市」。中国表没命中时原样返回 GeoLite2 的城市名。
 *
 * 拼串而非加一列:known_ip_scopes 与请求日志里的地名纯粹用于展示,收敛判定走独立的
 * scope_key,所以不值得为它开 schema 变更(ADR 0028)。
 */
export function geoDisplayCity(geo: GeoLookup): string | null {
  if (geo.region === null) return geo.city;
  // 空串按无市处理:否则会返回「江苏 」这类尾随空格
  if (geo.city === null || geo.city === "") return geo.region;
  return geo.city.startsWith(geo.region) ? geo.city : `${geo.region} ${geo.city}`;
}
