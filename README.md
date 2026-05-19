# TimeData

个人时间记录 PWA。按时间线记录一天中的活动，支持两级分类、时间空档识别、统计图表、本地离线存储，以及和自托管服务器同步。

## 快速部署

前置条件：安装了 Docker 和 Docker Compose 的 Linux 服务器。

```bash
# 1. 克隆仓库
git clone https://github.com/HaiouZh/TimeData.git
cd TimeData

# 2. 配置环境变量
cp .env.example .env
```

编辑 `.env`，至少修改鉴权密钥：

```text
AUTH_TOKEN=你的随机密钥
WATCHTOWER_TOKEN=你的另一段随机密钥
```

启动：

```bash
docker compose up -d
```

镜像自动从 GHCR 拉取，无需本地构建。服务默认监听 `3000` 端口。

默认部署包含两个长期容器：`timedata` 运行应用服务，`watchtower` 负责按需更新带 label 的 TimeData 容器。应用容器不挂载 `/var/run/docker.sock`，也不安装 docker CLI；网页“一键更新”只会通过内部网络触发 Watchtower 的受鉴权 HTTP API。容器启动时会自动修复 `./data` 的写入权限，通常不需要手动 `chown` 数据目录。

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `AUTH_TOKEN` | 生产必填 | — | API 鉴权密钥，所有 API 请求需携带 `Authorization: Bearer <TOKEN>`；Docker 部署会以 `NODE_ENV=production` 运行，未设置时服务端会拒绝启动 |
| `ALLOWED_ORIGINS` | 生产必填 | 空数组（拒绝跨域） | CORS 允许来源白名单，多个来源用英文逗号分隔；Web 部署填网页域名，移动壳按实际来源追加 `https://localhost,capacitor://localhost` |
| `DB_PATH` | 否 | `/app/data/timedata.db` | SQLite 数据库路径 |
| `PORT` | 否 | `3000` | 服务监听端口 |
| `UPDATE_REPO` | 否 | `HaiouZh/TimeData` | GitHub owner/repo，用于查询最新版本 |
| `GITHUB_TOKEN` | 否 | — | GitHub API Token，用于提高版本查询限额 |
| `WATCHTOWER_TOKEN` | 生产必填 | — | Watchtower HTTP API Token，`/api/update` 触发内部 Watchtower 更新时使用 |
| `TIMEDATA_IMAGE_TAG` | 否 | `latest` | TimeData 镜像 tag，可 pin 到指定版本 |

## 一键更新

push 到 main 后，GitHub Actions 自动构建镜像并推送到 GHCR。

在网页设置页「服务端版本」区块可以查看当前版本和最新版本。有新版本时点击「立即更新」即可完成滚动重启。

工作原理：

1. `/api/version` 查询 GitHub Actions 最近一次成功构建的 commit SHA，与当前运行版本对比。
2. `/api/update` 先在 `data/update.lock` 创建互斥锁；如果已有更新正在进行，会返回 `409 Conflict`，不会启动第二次更新。
3. 服务端通过 `WATCHTOWER_URL` 调用内部 `watchtower` 容器的 `POST /v1/update`，并用 `WATCHTOWER_TOKEN` 做 Bearer 鉴权。
4. Watchtower 只处理带 `com.centurylinklabs.watchtower.enable=true` label 的容器；默认只有 `timedata` 带这个 label。
5. Watchtower 拉取镜像、比较 digest，并在有新镜像时用旧容器 spec 重新创建 `timedata`。更新状态写入 `data/update-status.json`，网页会轮询 `/api/update/status` 展示结果和 `data/update.log` 尾部。

## 客户端配置

打开网页 → 设置页 → 服务器配置：

```text
API 地址：https://你的域名 或 http://服务器IP:3000
Token：.env 中 AUTH_TOKEN 的值
```

保存后即可使用同步、数据导出和服务端数据洞察功能。生产环境必须设置 `ALLOWED_ORIGINS`，把网页域名和 Android/Capacitor 壳实际来源加入白名单；未设置时跨域 `/api/*` 请求会被拒绝。

## 服务端数据洞察

部署并配置好 API 地址和 Token 后，在网页里进入：

```text
设置 → 服务端数据洞察
```

也可以直接访问：

```text
/settings/admin-insights
```

该面板是只读的，用于查看服务器 SQLite 数据概览、最近记录、分类汇总、同步诊断、服务端备份、健康检查和基础分析。它不会修改服务器数据；所有请求仍然需要 `AUTH_TOKEN`。

## 反向代理（HTTPS）

推荐绑定域名并启用 HTTPS。Caddy 示例：

```caddyfile
timedata.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

前端设置页 API 地址填 `https://timedata.example.com`。

## 数据备份

容器内 `/app/data` 挂载到 host 的 `./data` 目录，SQLite 数据库保存在 `./data/timedata.db`。

建议：
- 定期备份 `data/` 目录
- 升级前先备份数据库
- 多设备使用时确认 API 地址和 Token 正确后再同步

## API 参考

| 方法 | 路径 | 说明 | 需要 Token |
|------|------|------|:----------:|
| GET | `/api/health` | 健康检查 | 否 |
| GET | `/api/version` | 查询服务端版本 | 否 |
| GET | `/api/categories` | 分类数据 | 是 |
| GET | `/api/entries` | 时间记录 | 是 |
| POST | `/api/sync/push` | 推送本地变更 | 是 |
| POST | `/api/sync/pull` | 拉取远端变更 | 是 |
| GET | `/api/export?format=jsonl` | 导出 JSONL | 是 |
| GET | `/api/export?format=csv` | 导出 CSV | 是 |
| POST | `/api/data/reset/prepare` | 生成数据重置确认 token | 是 |
| POST | `/api/data/reset` | 使用确认 token 与短语执行数据重置 | 是 |
| POST | `/api/update` | 触发服务器自更新 | 是 |
| GET | `/api/admin/summary` | 服务端只读概览 | 是 |
| GET | `/api/admin/entries` | 最近记录与异常筛选 | 是 |
| GET | `/api/admin/categories` | 分类汇总 | 是 |
| GET | `/api/admin/sync` | 同步诊断 | 是 |
| GET | `/api/admin/backups` | 服务端备份元数据 | 是 |
| GET | `/api/admin/health-checks` | 数据健康检查 | 是 |
| GET | `/api/admin/analytics` | 基础分析聚合 | 是 |

## Android APK

Android App 内「设置 → APK 更新」会检查最新 GitHub Release；发现新版本时会打开系统浏览器进入 Release 页面，用户下载 APK 后手动确认安装。

GitHub Actions 发布的是稳定 release keystore 签名的 APK。首次从旧 debug 签名包迁移时 Android 会提示签名不同，需要先导出备份、卸载旧包、安装新版，再恢复或同步数据；之后 release 包之间可以覆盖安装。

## 本地开发

参见 [docs/evergreen/development.md](docs/evergreen/development.md)。

## 故障排查

- 部署后浏览器无法访问：检查云服务器安全组/防火墙是否放行端口，`docker compose ps` 确认容器健康。
- 同步失败：确认设置页 API 地址包含协议（`http://` 或 `https://`），Token 与服务器 `AUTH_TOKEN` 一致。
- 一键更新无反应：确认 `.env` 已设置 `WATCHTOWER_TOKEN`，compose 中存在 `watchtower` 服务，且 `timedata` 容器内 `WATCHTOWER_URL` 为 `http://watchtower:8080`；如果返回 409，说明已有更新任务或残留 `data/update.lock`，先看 `data/update.log` 和 `docker compose ps`。
- Ubuntu 防火墙：`sudo ufw allow 3000/tcp`。
