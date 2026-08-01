// ip2region 中国段 → 内置二进制表的离线生成器。
// 只在本机跑，产物 packages/server/assets/china-geo.bin 提交进仓库随镜像发布。
// 源数据: https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ipv4_source.txt
// 格式: 起始IP|结束IP|国家|省|市|运营商|国家码

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

/** 少数派条目的市位是英文。表外的英文名一律报错。 */
export const CITY_ALIASES = {
  "Beijing": "北京市",
  "Shanghai": "上海市",
  "Tianjin": "天津市",
  "Chongqing": "重庆市",
  "Nanning Shi": "南宁市",
  "Wulumuqi": "乌鲁木齐市",
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
