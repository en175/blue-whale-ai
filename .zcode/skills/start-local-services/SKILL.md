---
name: start-local-services
description: "启动 Blue-Whale 本地全栈开发环境。日常开发唯一默认 = 本地自足栈（dev-stack + pnpm dev），禁止连接测试环境数据库。触发词：启动服务/拉起服务/start services/local-mvp up。"
---

# 启动 Blue-Whale 本地开发环境

**红线（ADR-0064）**：日常开发只用本地自足栈。任何配置里不得出现测试站
（115.190.244.91）数据库连接串；确需查测试数据走「应急通道」一节，用完即断。

## 标准启动（日常唯一路径）

```bash
# 1. 起本地自足栈：MySQL(3306) + Redis(6379) + new-api(3001)
#    首次自动克隆 blue-whale-api 独立仓库构建二进制并注册管理员 root/rootroot
scripts/dev-stack.sh up

# 2. 起前端 + generation-worker（宿主机 3000）
cd blue_whale_web && pnpm dev
```

根 `.env` 必须指向本地（gitignore 文件，不入库）：

```
DATABASE_URL="mysql://root:blue_whale@127.0.0.1:3306/blue_whale"
NEW_API_BASE_URL=http://127.0.0.1:3001
```

## 验证

```bash
# new-api（账户服务）存活
curl -s http://127.0.0.1:3001/api/status | head -c 100

# 产品登录（BFF 把 new-api token 映射为 access_token）
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"root","password":"rootroot"}'
# 期望 data.access_token = sk-...
```

浏览器打开 http://localhost:3000，登录后画布列表与模板应正常加载。

## 常用运维

| 操作 | 命令 |
|------|------|
| 停栈（保留数据） | `scripts/dev-stack.sh down` |
| 重置本地库 | `scripts/dev-stack.sh fresh` |
| 看服务状态 | `scripts/dev-stack.sh status` |
| 重置验收库（另一套卷，互不干扰） | `pnpm db:fresh` |
| 跑全栈验收 | `pnpm test:acceptance` |

## 排错

| 症状 | 根因 | 修复 |
|------|------|------|
| 启动长时间卡住/连接超时 | 配置指向远程测试库（3306 已封公网） | 按上表改根 `.env` 指本地，`scripts/dev-stack.sh up` |
| `.env` 已改本地仍连远程 | shell 里导出过旧 `DATABASE_URL`（`--env-file` 不覆盖已有环境变量；`dev-blue-whale.mjs` 已强制以根 `.env` 为准） | `env | grep DATABASE_URL` 检查并 `unset`；重开终端 |
| 端口 3306/6379/3000 被占 | 旧栈遗留容器（bw-mysql/bw-redis 等） | `docker ps` 找到后 `docker rm -f <容器名>` |
| 业务接口 500 + ColumnNotFound | 本地库 schema 落后于代码 | 先 `scripts/dev-stack.sh fresh`；仍缺列说明基线 SQL 落后，需走工单更新 `packages/persistence/schema/` |
| 登录报 default token 未配置 | 用户是 /api/setup 建的，无令牌 | `scripts/dev-stack.sh fresh` 重建（脚本用 register 建管理员） |
| web 容器/进程启动即退 | 缺 `GENERATION_CREDENTIAL_SECRET`（≥16 字符） | 根 `.env` 补上 |

## 应急通道（仅调试测试站数据）

```bash
# SSH 隧道转发测试站 MySQL 到本地 127.0.0.1:13306（可 --local-port N 改端口），
# 前台运行，Ctrl+C 或 --timeout MINUTES 自动断开；仅供只读排查
scripts/tunnel-testsite-db.sh [--local-port N] [--timeout MINUTES]
```

Redis 与 MySQL 同隧道，但 `tunnel-testsite-db.sh` 目前只映射 MySQL，Redis 需手写（本地 `16379` → 测试站 `6379`）：

```bash
ssh -i <测试站私钥> -N -o ExitOnForwardFailure=yes \
  -L 16379:127.0.0.1:6379 root@115.190.244.91
# 本地连：redis-cli -h 127.0.0.1 -p 16379 -a <requirepass>
```

集成验收只走测试站公开 HTTP API，永不接触测试库（IK50GB-C 红线）。
