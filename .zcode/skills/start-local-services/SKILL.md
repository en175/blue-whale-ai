---
name: start-local-services
description: "启动 Blue-Whale 本地开发环境。前端已迁出本仓（前后端分离，见 ADR-0074），本仓本地运行 = 起 backend/ NestJS 服务。禁止连接测试环境数据库。触发词：启动服务/拉起服务/start services/local-mvp up。"
---

# 启动 Blue-Whale 本地后端

**红线（ADR-0064）**：任何配置里不得出现测试站（115.190.244.91）数据库连接串；确需查测试数据走「应急通道」一节，用完即断。

## 标准启动（后端）

前端 UI 已迁出本仓，由前端同事独立维护；本仓本地运行的是 NestJS 后端（`/api` 前缀，默认端口 3100）：

```bash
# 仓库根
pnpm --dir backend build
node backend/dist/apps/blue-whale/src/main.js   # PORT=3100
```

数据库 / Redis 由后端进程通过自身环境变量读取（连接串不入库）。迁移期间本地联调按需走隧道连开发库，见「应急通道」。

## 验证

```bash
# 后端健康（公开档位端点）
curl -s http://localhost:3100/api/recharge/tiers | head -c 200

# 产品登录
curl -s -X POST http://localhost:3100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"root","password":"rootroot"}'
# 期望 data.access_token = sk-...
```

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
