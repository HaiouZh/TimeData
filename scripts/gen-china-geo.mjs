// ip2region 中国段 → 内置二进制表的离线生成器。
// 只在本机跑，产物 packages/server/assets/china-geo.bin 提交进仓库随镜像发布。
// 源数据: https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ipv4_source.txt
// 格式: 起始IP|结束IP|国家|省|市|运营商|国家码

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 34 个省级行政区在源数据里的多数派写法。白名单之外一律报错，不静默透传。 */
export const PROVINCE_CANONICAL = new Set([
  "北京", "天津", "河北省", "山西省", "内蒙古", "辽宁省", "吉林省", "黑龙江省",
  "上海", "江苏省", "浙江省", "安徽省", "福建省", "江西省", "山东省",
  "河南省", "湖北省", "湖南省", "广东省", "广西", "海南省",
  "重庆", "四川省", "贵州省", "云南省", "西藏",
  "陕西省", "甘肃省", "青海省", "宁夏", "新疆",
  "香港特别行政区", "澳门特别行政区", "台湾省",
]);

/** 少数派写法 → 多数派。改的是那几十条，绝大多数条目不动。 */
export const PROVINCE_ALIASES = {
  "北京市": "北京",
  "上海市": "上海",
  "天津市": "天津",
  "重庆市": "重庆",
  "宁夏回族自治区": "宁夏",
  "广西壮族自治区": "广西",
  "UEruemqi": "新疆",
};

/** 源数据把台湾的市直接放进省位置。省归一为台湾省，原值移到市位（比市位的英文更可信）。 */
export const TAIWAN_CITIES_IN_PROVINCE_SLOT = new Set([
  "台北市", "桃园市", "基隆市", "新竹县", "彰化县", "台中市",
]);

/** 少数派条目的市位是英文。表外的英文名一律报错。区/镇级写法归一到所属地级市,与主流段共用收敛键。 */
export const CITY_ALIASES = {
  "Beijing": "北京市",
  "Shanghai": "上海市",
  "Tianjin": "天津市",
  "Chongqing": "重庆市",
  "Nanning Shi": "南宁市",
  "Wulumuqi": "乌鲁木齐市",
  // Cloudflare/Akamai CDN 段的英文写法(源数据里同市段的中文写法是主流,归并过去)
  "Taipei City": "台北市",
  "Zhongli District": "桃园市",
  "Fengyuan": "台中市",
  "Changchun Shi": "长春市",
  "Chengdu Shi": "成都市",
  "Fuyang Shi": "阜阳市",
  "Hefei Shi": "合肥市",
  "Heze Shi": "菏泽市",
  "Jining Shi": "济宁市",
  "Linyi Xian": "临沂市",
  "Weifang Shi": "潍坊市",
  "Dongguan Shi": "东莞市",
  "Foshan Shi": "佛山市",
  "Guangzhou Shi": "广州市",
  "Maoming Shi": "茂名市",
  "Shenzhen": "深圳市",
  "Zhuhai Shi": "珠海市",
  "Nanjing Shi": "南京市",
  "Nantong Shi": "南通市",
  "Tongshan": "徐州市",
  "Yancheng Shi": "盐城市",
  "Ganzhou Shi": "赣州市",
  "Baoding Shi": "保定市",
  "Hanshan Qu": "邯郸市",
  "Langfang Shi": "廊坊市",
  "Shijiazhuang Shi": "石家庄市",
  "Nanyang Shi": "南阳市",
  "Zhengzhou Shi": "郑州市",
  "Zhoukou Shi": "周口市",
  "Zhumadian Shi": "驻马店市",
  "Ningbo Shi": "宁波市",
  "Wuhan Shi": "武汉市",
  "Xiangyang": "襄阳市",
  "Changsha Shi": "长沙市",
  "Hengyang Xian": "衡阳市",
  "Shenyang Shi": "沈阳市",
  "Guozhen": "宝鸡市",
  "Xi'an Shi": "西安市",
  "Kowloon": "九龙",
};

/** 同一家运营商在源数据里有多种写法，不归一会在界面上显示成两个不同来源。 */
export const ISP_ALIASES = {
  "移动": "中国移动",
  "中移铁通": "中国移动",
  "铁通": "中国移动",
  "联通": "中国联通",
  "电信": "中国电信",
  "广电": "中国广电",
};

const UNKNOWN = "0";
const HAS_ASCII_LETTER = /[A-Za-z]/;

function normalizeProvince(raw) {
  if (TAIWAN_CITIES_IN_PROVINCE_SLOT.has(raw)) return { province: "台湾省", cityFromProvinceSlot: raw };
  const mapped = PROVINCE_ALIASES[raw] ?? raw;
  if (!PROVINCE_CANONICAL.has(mapped)) {
    throw new Error(`未知省名「${raw}」——上游可能新增了一种写法。请人工确认后加进 PROVINCE_ALIASES 或 PROVINCE_CANONICAL 再重跑。`);
  }
  return { province: mapped, cityFromProvinceSlot: null };
}

function normalizeCity(raw) {
  if (raw === UNKNOWN || raw === "") return null;
  const mapped = CITY_ALIASES[raw];
  if (mapped !== undefined) return mapped;
  if (HAS_ASCII_LETTER.test(raw)) {
    throw new Error(`未知英文城市名「${raw}」——请人工确认中文名后加进 CITY_ALIASES 再重跑。`);
  }
  return raw;
}

/** 一行 split("|") 的结果 → 归一后的地区；非中国行或省未知返回 null。 */
export function normalizeRow(fields) {
  if (fields[2] !== "中国") return null;
  if (fields.length < 7) throw new Error(`行字段不足 7 段（${fields.length}）：${fields.join("|")}`);
  const rawProvince = fields[3];
  if (rawProvince === UNKNOWN || rawProvince === "" || rawProvince === undefined) return null;

  const { province, cityFromProvinceSlot } = normalizeProvince(rawProvince);
  const city = cityFromProvinceSlot ?? normalizeCity(fields[4] ?? UNKNOWN);
  const rawIsp = fields[5];
  const isp = rawIsp === UNKNOWN || rawIsp === "" || rawIsp === undefined
    ? null
    : (ISP_ALIASES[rawIsp] ?? rawIsp);

  return { province, city, isp };
}

export const FORMAT_VERSION = 1;
export const HEADER_BYTES = 18;

export function ipToU32(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) throw new Error(`非法 IPv4「${ip}」`);
  return parts.reduce((acc, part) => {
    if (Number(part) > 255) throw new Error(`非法 IPv4「${ip}」段值超限`);
    return acc * 256 + Number(part);
  }, 0);
}

export function encodeTable(entries, generatedOn) {
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= sorted[i - 1].end) {
      throw new Error(`区间重叠：${sorted[i - 1].start}-${sorted[i - 1].end} 与 ${sorted[i].start}-${sorted[i].end}`);
    }
  }

  const poolIndex = new Map();
  const pool = [];
  const indices = sorted.map((entry) => {
    const key = `${entry.province}\u0000${entry.city ?? ""}\u0000${entry.isp ?? ""}`;
    let idx = poolIndex.get(key);
    if (idx === undefined) {
      idx = pool.length;
      pool.push([entry.province, entry.city, entry.isp]);
      poolIndex.set(key, idx);
    }
    return idx;
  });
  if (pool.length > 0xffff) throw new Error(`地区组合数 ${pool.length} 超出 u16 上限`);

  const poolBuf = Buffer.from(JSON.stringify(pool), "utf8");
  const buf = Buffer.alloc(HEADER_BYTES + sorted.length * 10 + poolBuf.length);
  buf.write("TDCN", 0, "ascii");
  buf.writeUInt16BE(FORMAT_VERSION, 4);
  buf.writeUInt32BE(generatedOn, 6);
  buf.writeUInt32BE(sorted.length, 10);
  buf.writeUInt32BE(poolBuf.length, 14);
  sorted.forEach((entry, i) => {
    const at = HEADER_BYTES + i * 10;
    buf.writeUInt32BE(entry.start, at);
    buf.writeUInt32BE(entry.end, at + 4);
    buf.writeUInt16BE(indices[i], at + 8);
  });
  poolBuf.copy(buf, HEADER_BYTES + sorted.length * 10);
  return buf;
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source) {
    console.error("用法: node scripts/gen-china-geo.mjs --source=<ipv4_source.txt 路径> [--out=<输出路径>] [--date=YYYYMMDD]");
    console.error("源文件: https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ipv4_source.txt");
    process.exit(1);
  }
  const outPath = args.out ?? join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "server", "assets", "china-geo.bin");
  const generatedOn = Number(args.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, ""));

  const entries = [];
  let total = 0, withCity = 0, normalized = 0;
  for (const line of readFileSync(args.source, "utf8").split("\n")) {
    if (!line) continue;
    const fields = line.split("|");
    const region = normalizeRow(fields);
    if (region === null) continue;
    total++;
    if (region.city !== null) withCity++;
    // 归一计数是人工核对的依据:突然暴涨说明上游改了写法,该看一眼再提交
    if (region.province !== fields[3] || (region.city !== null && region.city !== fields[4]) || (region.isp !== null && region.isp !== fields[5])) normalized++;
    entries.push({ start: ipToU32(fields[0]), end: ipToU32(fields[1]), ...region });
  }

  const buf = encodeTable(entries, generatedOn);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);

  const poolLen = buf.readUInt32BE(14);
  const pool = JSON.parse(buf.subarray(HEADER_BYTES + total * 10, HEADER_BYTES + total * 10 + poolLen).toString("utf8"));
  console.log(`中国区间 ${total} 条 | 有城市 ${withCity} (${(withCity / total * 100).toFixed(1)}%) | 地区组合 ${pool.length} | 被归一 ${normalized} 条`);
  console.log(`生成日 ${generatedOn} | 输出 ${outPath} | ${(buf.length / 1024).toFixed(0)}KB`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
