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
