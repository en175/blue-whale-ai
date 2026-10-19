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

输出 3000/3100 的 PID、代码所在目录、后端数据库与账户网关指向、Redis 与探活结果。HTTP 与 Redis 探测各有 3 秒超时。任一基础服务失败，退出码非零。这一步只判断页面基础依赖，不代表登录或媒体任务可用。

启动、恢复或接管后，计划提交媒体任务时必须再执行「MQ 连接检查」。该命令失败就停止媒体测试，按失败阶段恢复后重新检查。先记录实际运行工作树和 PID，不能用当前 shell 或另一个工作树的配置代替。

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
BILLING_ADMIN_ENABLED=true \
nohup mvn -o -pl blue-whale-billing -am spring-boot:run > /tmp/bw-billing.log 2>&1 &
```

⚠️ **`BILLING_ADMIN_ENABLED=true` 是本地必给的**（2026-09-26 起）：管理端 HTTP 接口
（`/admin/**`）的默认值已改成 **false**，因为它**无鉴权却能凭空生积分** ——
任何能到达 4003 的人 POST 一次 `/admin/credits/grants` 就能造钱。默认关掉之后，
本地要跑**充值到账 / 发布目录 / 折扣 / 促销**这些写操作，就得显式打开它；
不给的话表现为「充值下单 503 / 发放积分失败」，而服务本身一切正常。
读的那半边不受影响（积分记录、流水现在走 gRPC 的 `BillingAdminService`）。

- HTTP/admin 走 `4003`，**gRPC 走 `4004`**——后端要连的是后者（`BILLING_GRPC_URL=http://127.0.0.1:4004`）
- 库是 `bw_billing`（billing 自己的库，Flyway 管 schema，**不归 Prisma**）
- `ROCKETMQ_ENDPOINTS` 指向本地 `bw-rmq-proxy`（8081）。只想验 Hold 不想接 MQ 时用
  `BILLING_MQ_ENABLED=false`；**但那样跑完的任务不会被结算/返还**，钱会冻着
- 本地库 `bw_billing` 已有一份 `creditsPerYuan=15` 的 active 定价目录，以及开发中的积分数据
- **跑 billing 的真库集成测试是安全的**：它们落在**测试专用库 `bw_billing_test`** 上
  （不存在会自动建：只建库，schema 交给 Flyway），开发库 `bw_billing` 碰不到 ——
  那些 `@BeforeEach` 的 `DELETE` 只作用于测试库。设上口令就能跑，无额外准备：

  ```bash
  cd <worktree>/server
  BILLING_DB_PASSWORD="$(docker inspect bw-mysql --format '{{range .Config.Env}}{{println .}}{{end}}' | grep MYSQL_ROOT_PASSWORD | cut -d= -f2)" \
    mvn -o -pl blue-whale-billing -am test
  ```
- 门禁 `BillingTestDatabaseGate` 认库名不认人：目标库名不匹配 `bw_billing_test*` 就**拒跑**
  （跳过 + 打印改法），上下文起来后还会拿真实连接核实一次 `SELECT DATABASE()`。
  换库用 `BILLING_TEST_DB_URL=jdbc:mysql://<host>:<port>/bw_billing_test_xxx`；
  **不要**拿 `BILLING_DB_URL` 指开发库来跑测试（会被拒跑）。
  （旧的「别跑 billing 的 DB 门控测试，它会清掉开发库」警告**已作废**：那条路径被机制堵死了。）

## ⚠️ 部署前必须做：预建 billing 的两个 MQ topic

billing 的消费者订阅 `generation-job-terminal`（2026-10-13 起；此前是
`generation-job-completed` / `generation-job-failed`）。
**RocketMQ 的消费者不会自动建 topic** —— 订阅一个不存在的 topic 会以
`No topic route info in name server` 失败，消费者 bean 造不出来，**整个 billing 起不来**。
（生产者的发送会触发 autoCreate，但消费者先启动时等不到那一次发送。）

**2026-10-13 实测**：本地 `bw-rmq-broker` 与测试站 52 的 `rmq-broker` **都只有旧的两个**——
新 topic 两边都要建，否则那一侧 billing 一部署就起不来。

部署前建一次（一次性、幂等）：

```bash
# 测试站 / 生产（52）
ssh root@14.103.43.52
docker exec rmq-broker sh -c '/home/rocketmq/rocketmq-5.3.1/bin/mqadmin updateTopic \
  -n <rmq-namesrv-IP>:9876 -c DefaultCluster -t generation-job-terminal'

# 本地
docker exec bw-rmq-broker sh -c '/home/rocketmq/rocketmq-5.3.1/bin/mqadmin updateTopic \
  -n <bw-rmq-namesrv-IP>:9876 -c DefaultCluster -t generation-job-terminal'
```

⚠️ **`-n` 要给 namesrv 容器的 IP，不是 `127.0.0.1`**：namesrv 与 broker 是**两个容器**，
broker 容器里的 `127.0.0.1:9876` 够不到 namesrv，报错形如
`RemotingConnectException: connect to null failed`。取法：

```bash
docker inspect <rmq-namesrv|bw-rmq-namesrv> --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
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

## MQ 连接检查

需要提交生成、场景切分、音频及其他媒体处理任务时，启动或接管流程以此命令通过为连接就绪条件：

```bash
bash .agents/skills/start-local-services/scripts/check-local-services.sh --media
```

1. 检查器从 3100 的实际后端 PID 读取进程环境与启动目录，使用该后端构建中的 `loadRocketMqConfig` 和真实任务 topic 定义。端点、TLS 与凭据沿用后端语义。需要完整后端构建及已安装依赖，不从检查器 shell 补默认值。额外的 `--env-file`、`--import` 或 `--require` 环境加载器无法被外部检查器确认，返回失败。
2. 依次验证初始端点、真实 topic 路由、返回地址、指定 topic 的生产者握手及各返回端点的协议通信，最后关闭探测连接。缺配置、失败或超时均非零退出，输出失败阶段和恢复动作。默认总时限 20 秒，可用 `--timeout-ms 30000` 调整，上限 60 秒。
3. 命令成功只证明此刻 MQ 连接可用。探测不发送业务消息，不重试已有任务。真实入队、worker 消费和最终产物需另用批准的受控任务验收。

本地 MQ 启动后，把实际端点注入后端进程，例如本地 Proxy 的 `127.0.0.1:8081`。纯页面检查不要求 MQ；普通图片和视频生成的恢复扫描也不证明 MQ 可用。场景切分、音频及其他媒体处理可能在入队失败时直接终止，不能沿用普通生成的恢复扫描结论。

### 远程 MQ 转发

初始端点与路由返回地址可能不同，两个阶段都必须可达。先确认批准使用的 MQ 环境、SSH 别名及远端 Proxy 地址，再通过同一入口声明映射。凭据通过 SSH 配置和后端进程环境提供，不写入命令或日志。

下面仅为初始端点 `127.0.0.1:18081`、路由返回 `127.0.0.1:8081` 的示例，两者均转发到远端 `127.0.0.1:8081`。按实际配置替换，不把端口作为通用拓扑：

```bash
bash .agents/skills/start-local-services/scripts/check-local-services.sh --media \
  --mq-ssh <已配置的SSH别名> \
  --mq-forward 127.0.0.1:18081=127.0.0.1:8081 \
  --mq-forward 127.0.0.1:8081=127.0.0.1:8081
```

入口只为实际初始端点或查询到的返回地址建立显式映射。当前受管转发绑定 IPv4 回环地址，端口范围 1024–65535。地址缺映射时报告该地址并失败，核对后补齐再执行。

重复执行会核对 `ssh -G` 的实际配置指纹、SSH 控制连接和监听 PID 后复用。同一别名改指其他主机后，旧连接不会被当作新目标复用。端口被其他连接占用时停止，不抢占、不杀进程；已有手工转发可先用不带 `--mq-ssh` 的 `--media` 做协议检查，但不会自动纳入管理。转发不依附当前会话，使用 SSH 保活；失效后下次运行重新检测并恢复，不新增守护服务。变更映射不自动清理旧连接，先由使用者确认旧连接已无人依赖。

生命周期记录位于当前用户临时目录的 `bw-mq-<uid>/lifecycle.log`，只记录时间、地址、目标别名和建立、复用、失效或失败结果。日志不证明退出原因；断网、休眠或手工停止仍需独立证据。结束使用时按输出中的 SSH 控制命令关闭对应连接。

远程 MQ 不授权本地后端长期直连共享测试库。数据库访问仍执行 ADR-0064；真实集成验收走批准环境的公开 HTTP API。

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
  DATABASE_URL='mysql://<凭据不落文件>@14.103.43.52:3306/blue_whale?timezone=%2B08%3A00' \
  NEW_API_BASE_URL='http://14.103.43.52:3006' \
  REDIS_HOST=127.0.0.1 REDIS_PORT=6379 REDIS_DB=0 \
  PORT=3100 node dist/apps/blue-whale/src/main.js > /tmp/bw-backend-3100.log 2>&1 &
```

- ⚠️ `DATABASE_URL` **必须带 `?timezone=%2B08%3A00`**（测试站 MySQL 全局时区是 UTC）。缺它会命中 `assertClockAgreement`，后端拒绝启动并打出「进程时区与数据库会话时区不一致」——那是**配置问题不是代码坏了**。形态 A（本地库）同理。
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

分别记录以下验收结论，不能相互替代：

1. 页面及登录通过，记录实际环境和测试账号归属。
2. MQ 连接通过，记录 `--media` 的分阶段输出、工作树和版本。
3. 受控任务真正入队并被消费，记录任务 ID、环境、版本和执行人。
4. 场景切分返回可播放场景段卡，记录实际结果。

未执行项标为 `NOT_RUN`，缺少批准环境或受控任务时标为 `BLOCKED`。未经授权，不重试项目 434 的历史任务，不修改任务、账务、资产或画布数据制造通过。

## 应急通道（只读排查测试库，见 ADR-0064）

`scripts/tunnel-testsite-db.sh [--local-port N]`：SSH 隧道转发测试站 MySQL 到本地，仅供只读排查，用完即断。集成验收只走测试站公开 HTTP API。
