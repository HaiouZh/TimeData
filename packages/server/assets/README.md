# china-geo.bin

中国 IPv4 段的省 / 市 / 运营商查找表，由 `scripts/gen-china-geo.mjs` 从 ip2region 的原始数据生成，随镜像发布。

- 数据来源：[lionsoul2014/ip2region](https://github.com/lionsoul2014/ip2region) `data/ipv4_source.txt`
- 许可：Apache License 2.0
- 重新生成（源文件下到 `.local/`，那里已被 gitignore；别下进 `docs_local/`，它是无 ignore 的嵌套 git 仓）：
  ```bash
  mkdir -p .local
  curl -sL -o .local/ipv4_source.txt https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ipv4_source.txt
  node scripts/gen-china-geo.mjs --source=.local/ipv4_source.txt
  ```

上游约一年更新一次。生成脚本遇到未知的省名或英文城市名会**报错退出**——这是刻意的：静默透传会引入新的收敛键、让已确认的来源范围重报却查不出原因。

## 二进制格式

大端布局，头 18 字节：

| 偏移 | 长度 | 内容 |
|---|---|---|
| 0 | 4B | magic `TDCN`（ASCII） |
| 4 | u16 | 格式版本（当前 1；读取端不认时按缺表处理，避免混跑期错位） |
| 6 | u32 | 生成日 `YYYYMMDD` |
| 10 | u32 | 区间数 N |
| 14 | u32 | 地区池 JSON 字节长 P |

头之后是 N 个区间条目，每条 10 字节：`start` u32、`end` u32、`regionIdx` u16（池下标）。区间按 start 升序且不重叠（生成端 `encodeTable` 强校验，重叠即报错）。最后是 P 字节的 JSON 地区池：`[[province, city|null, isp|null], ...]`。

读取端：`packages/server/src/lib/chinaGeo.ts`（头部校验、二分查找、池解析）。生成端：`scripts/gen-china-geo.mjs`（`encodeTable` 写出，自测在 `scripts/gen-china-geo.test.mjs`）。
