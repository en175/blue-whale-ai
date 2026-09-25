---
name: start-local-services
description: "启动或接管 Blue-Whale 本地开发服务：web 前端 3000 + backend 3100 + 本地 Redis，后端分本地库与远程测试站库两种形态。接管既有服务前必须先跑技能内 scripts/check-local-services.sh 核对配置指向。触发词：启动服务/拉起服务/起环境/连数据库/start services/3000/3100。"
---

# 启动 Blue-Whale 本地服务

本仓本地联调 = `web/` 前端（vite，3000）+ `backend/` NestJS（3100）+ 本地 Redis 容器。数据库默认本地；需要用远程测试站账号与素材时走「后端形态 B」。

## 第零步：接管前体检（强制）

```bash
bash .claude/skills/start-local-services/scripts/check-local-services.sh
```

输出 3000/3100 的 PID、代码所在目录、后端数据库与账户网关指向（本地/远程判定）、Redis 与探活结果。

**端口活着 ≠ 配置正确**。别的会话可能用本地库默认配置重启过后端：本地库里没有团队账号，表现为「账号密码错误」。起任何服务前、用户报「登录不了」时，先跑体检再动手。

## 前端 3000

```bash
cd <任务 worktree>/web
nohup env VITE_API_BASE_URL=http://127.0.0.1:3100 \
  npx vite --mode test --port 3000 --strictPort --host 127.0.0.1 \
  > /tmp/bw-web-3000.log 2>&1 &
```

- API 请求经 vite proxy 转发到 `VITE_API_BASE_URL`；不设置时默认连远程测试站（`.env.test`）。
- 起之前确认没有旧 3000 进程占着端口：旧进程可能跑的是别的 worktree 的旧代码（体检脚本显示代码目录），先 kill 再起。
- 用 `nohup … &` 常驻；会话托管的后台进程在会话结束会被回收（SIGTERM 143）。

## 计费服务 4003/4004（新：起后端前必须先起它）

new-api 已被切断，**预扣改由我们自己的 billing-svc 承担**——它在用户提交生成的等待路径上。

```bash
cd <worktree>/server
BILLING_DB_PASSWORD="$(docker inspect bw-mysql --format '{{range .Config.Env}}{{println .}}{{end}}' | grep MYSQL_ROOT_PASSWORD | cut -d= -f2)" \
ROCKETMQ_ENDPOINTS=127.0.0.1:8081 \
nohup mvn -o -pl blue-whale-billing -am spring-boot:run > /tmp/bw-billing.log 2>&1 &
```

- HTTP/admin 走 `4003`，**gRPC 走 `4004`**——后端要连的是后者（`BILLING_GRPC_URL=http://127.0.0.1:4004`）
- 库是 `bw_billing`（billing 自己的库，Flyway 管 schema，**不归 Prisma**）
- `ROCKETMQ_ENDPOINTS` 指向本地 `bw-rmq-proxy`（8081）。只想验 Hold 不想接 MQ 时用
  `BILLING_MQ_ENABLED=false`；**但那样跑完的任务不会被结算/返还**，钱会冻着
- 本地库已有一份 `creditsPerYuan=15` 的 active 定价目录。⚠️ **不要跑 billing 的
  DB 门控集成测试**（`BILLING_DB_PASSWORD` 一设它们就会跑）——`AdminApiIntegrationTest`
  的 `@BeforeEach` 会 `DELETE FROM billing_pricing_catalogs`，把这份目录清掉

## ⚠️ 部署前必须做：预建 billing 的两个 MQ topic

billing 的消费者订阅 `generation-job-completed` / `generation-job-failed`。
**RocketMQ 的消费者不会自动建 topic** —— 订阅一个不存在的 topic 会以
`No topic route info in name server` 失败，消费者 bean 造不出来，**整个 billing 起不来**。
（生产者的发送会触发 autoCreate，但消费者先启动时等不到那一次发送。）

**2026-09-25 实测 52 的 broker**：只有 `generation-task` / `generation-video`（worker 队列）
与 pay 的 `QUEUE_PAY_ORDER_MCH_NOTIFY`，**这两个都没有**。也就是说 billing 一部署就会起不来。

部署前建一次（一次性、幂等）：

```bash
ssh root@14.103.43.52
docker exec rmq-broker /home/rocketmq/rocketmq-5.3.1/bin/mqadmin updateTopic \
  -n 127.0.0.1:9876 -c DefaultCluster -t generation-job-completed
docker exec rmq-broker /home/rocketmq/rocketmq-5.3.1/bin/mqadmin updateTopic \
  -n 127.0.0.1:9876 -c DefaultCluster -t generation-job-failed
```

（topic 名的字符集限制见上面「计费服务」一节：**只能字母数字下划线连字符**，带点号会让服务直接起不来。）

## 后端 3100

构建（必须完整跑完三段）：

```bash
cd <worktree>/backend && npm run build   # prisma generate && tsc -b && tsc-alias
```

构建中断会留下半成品 dist（`dist/` 里残留 `@lib/` 别名，启动报 `ERR_MODULE_NOT_FOUND`）。
`npm start` 的 prestart 检查会扫整棵 dist 并**指名道姓列出残留的文件与那一行**。

形态 A：本地库（默认）

```bash
# ⚠️ 主密钥必须**跨重启稳定**：凭证（上游 key、支付商户密钥）用它加密存在库里，
#    每次换一把 = 之前存的密文再也解不开（管理端回显「未配置」、打上游 503）。
#    首次生成、之后复用同一份。
export SYSTEM_SETTINGS_SECRET="$(cat ~/.bw-settings-secret 2>/dev/null \
  || (openssl rand -hex 32 | tee ~/.bw-settings-secret))"

cd backend && PORT=3100 \
  BILLING_GRPC_URL='http://127.0.0.1:4004' \
  BILLING_ADMIN_URL='http://127.0.0.1:4003' \
  PAY_SERVER_BASE_URL='http://14.103.43.52:9216' \
  nohup node dist/apps/blue-whale/src/main.js > /tmp/bw-backend-3100.log 2>&1 &
```

⚠️ **`BILLING_GRPC_URL` 现在是启动硬依赖**：缺它后端**拒绝启动**（listen 之前就
`process.exit(1)`）。理由：提交生成必须能预扣。曾经「为空 = 跳过预扣」，new-api 被切断后
那就是一条**静默的免费通道**：全站生成不扣钱且毫无报错。开关已整条删除。

⚠️ **上游 key 不在环境变量里了**（`NEW_API_UPSTREAM_KEY` 已删）。它是
`system_settings` 表里 `upstream` 模块的一行，在**管理端「系统设置 → 上游凭证」**配，
全项目共用这一把（backend 与 worker 都从这一行走）。所以：
- 起后端**不再需要**给 env；第一次要在管理端填一次。
- 想让它跨重启还在，`SYSTEM_SETTINGS_SECRET` 就必须**稳定**（上面换成了一份存在
  `~/.bw-settings-secret` 的固定密钥）。每次起都换一把的话，上一轮存的加密行再也解不开，
  表现为管理端回显「未配置」、打上游 503 `upstream_credential_missing`。

⚠️ **上游 key 是项目里唯一的一把上游凭证。** 所有以「蓝鲸自己」身份打 new-api 的调用都用
它（登录后回注请求头、技能格式化、worker 素材状态跟进……），多配一处就是多一处轮换与漂移。
唯一看似例外的 `NEW_API_AGENT_BILLING_TOKEN`（`bwsvc_` 前缀）**不是第二把 key，是服务
身份**——new-api 的 relay 入口按前缀分流，把它换成统一 key 会让 Agent 的账静默记到别人头上
（详见下）。**它也刻意不配在管理端**：那不是「我们发给上游的我们是谁」。

一个扣不了钱的进程不该开始接受请求，所以拦在启动而不是首次请求。

## 另外三个变量（充值要用，**刻意不进启动硬门禁**）

| 变量 | 干什么 | 缺了会怎样 |
| --- | --- | --- |
| `PAY_SERVER_BASE_URL` | BlueWhalePay 的地址。本地连测试站：`http://14.103.43.52:9216`（容器 `bw-pay-payment`） | 充值下单 **503**，其余功能不受影响 |
| `BILLING_ADMIN_URL` | billing 的 HTTP 管理面（`http://127.0.0.1:4003`），充值到账要靠它发积分 | 到账时发不出积分 |
| `SYSTEM_SETTINGS_SECRET` | 系统设置里商户密钥的 AES-256-GCM 主密钥（32 字节 hex） | **不写也不读**凭证；系统设置里存不进去 |

这三个**不在**启动硬门禁里，是有意的：充值缺配置只是「不卖」，不属于
「配置缺失就免费」那条通道——为它拒启整个服务不划算。

⚠️ 充值的**回调**是 pay **推**给我们的。本地后端在 `localhost:3100`，
测试站的 pay **够不到它**。所以本地只能验「我们主动打 pay」（下单 / 查单）；
回调那一段只能自己打自己的入口来验（验签 + 幂等 + 发放），**不是真链路**。
真链路要到测试站后端上才验得了——那时回调地址必须是 52 能访问到的那个。

取值来源：与其它 new-api 变量一样，从测试站 backend 容器的 `docker inspect` 提取
（见下方「形态 B」的连接串获取），只走进程环境变量注入，**不落任何入库文件或日志**（ADR-0064）。

形态 B：远程测试站库（用测试站账号登录、读测试站素材）

```bash
cd backend
set -a; source /tmp/bw-remote-agent.env; set +a   # Agent 服务三件套；缺失时见下
nohup env \
  DATABASE_URL='mysql://<凭据不落文件>@14.103.43.52:3306/blue_whale' \
  NEW_API_BASE_URL='http://14.103.43.52:3006' \
  REDIS_HOST=127.0.0.1 REDIS_PORT=6379 REDIS_DB=0 \
  PORT=3100 node dist/apps/blue-whale/src/main.js > /tmp/bw-backend-3100.log 2>&1 &
```

- 完整连接串的获取：SSH 到测试站（密钥 `~/Downloads/weitian.pem`，root@14.103.43.52）从 backend 容器 `docker inspect` 提取。连接串只走进程环境变量注入，不落任何入库文件或日志（ADR-0064）。
- Agent 三件套变量（`AGENT_SERVICE_BASE_URL=http://14.103.43.52:4112` + `AGENT_SERVICE_TOKEN` + `NEW_API_AGENT_BILLING_TOKEN`）同样从远程容器 inspect 提取，存 `/tmp/bw-remote-agent.env`（600 权限）。缺这三项：右侧边栏 Agent 会话 502、模型网关 503。
  - 其中 `NEW_API_AGENT_BILLING_TOKEN` **必须保持 `bwsvc_` 前缀**，且它**不等于管理端配的那把统一 key**：它是 new-api 那边 `AGENT_BILLING_SERVICE_TOKEN` 的同一个值，属于**服务身份**而非项目凭证，new-api 的 relay 入口按前缀分流，换成统一 key 不会报错、只会把账静默记到统一 key 的属主头上。后端启动时会校验前缀，配错直接拒绝启动。
- ⚠️ **上游 key 读的是测试站库里的 `system_settings` 行**，而它是用**测试站部署的
  `SYSTEM_SETTINGS_SECRET`** 加密的。本地随便 `openssl rand` 一个密钥解不开它——管理端会
  回显「未配置」、打上游 503 `upstream_credential_missing`。要么用测试站那把密钥（从
  backend 容器 `docker inspect` 取），要么在管理端重新填一次 key（会覆盖测试站那份，
  同事可见，动手前先问）。**不要再试图给 `NEW_API_UPSTREAM_KEY`**：那个 env 已经没人读了。
- Redis 三个变量必须显式传。`REDIS_CONN_STRING` 不带 `/0` 库号会被解析成 db=NaN，启动即崩（`ReplyError: SELECT NaN`）。
- 风险先告知用户：此形态下写操作真实落测试站库（同事可见），生成任务与 Agent 对话消耗测试站真实积分。

## Redis（两形态共用）

本地容器 `blue-whale-dev-redis`（依赖 Docker Desktop 开机）：

```bash
docker start blue-whale-dev-redis   # 已在跑则跳过
```

Redis 下线时后端会话接口全 503（页面弹「会话服务不可用」）；本地 mysql / new-api 容器不需要（形态 B 库与网关都在远程）。

## 验证

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/health        # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/me            # 401（无登录态的干净响应=链路健康）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/recharge/tiers # 200（库读取通）
```

形态 B 的最终确认是用户用测试站真实账号在 3000 登录成功。

## 应急通道（只读排查测试库，见 ADR-0064）

`scripts/tunnel-testsite-db.sh [--local-port N]`：SSH 隧道转发测试站 MySQL 到本地，仅供只读排查，用完即断。集成验收只走测试站公开 HTTP API。
