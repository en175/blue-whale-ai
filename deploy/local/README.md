# Blue-Whale 本地 MVP 全栈（IK1NRX）

一套可重复 up/down 的本地 Docker Compose MVP，让内部开发者通过 Gateway 使用 Web、认证、Project 与 Agent 基础能力，而无需测试或生产 VKE。

## 前置条件

- **Docker Desktop**（含 Compose v2）或同等 Docker + Docker Compose v2 安装
- **内存 ≥ 8 GB**（建议 16 GB；Nacos + 3 个 JVM + Web + Python 同时跑约 3–4 GB）
- **端口空闲**：3000 / 8686 / 8081 / 8082 / 3306 / 6379 / 8848（端口冲突时见下方「改发布端口」）
- 首次构建需联网拉取基础镜像 + Maven / npm 依赖（约 5–10 分钟）

## 快速启动

```bash
# 1. 在仓库根拷贝 env 样例
cp deploy/local/.env.example deploy/local/.env

# 2. 拉起全部 8 个服务
scripts/local-mvp.sh up

# 3. 健康检查（逐个探测 8 个服务，缺哪个报哪个）
scripts/local-mvp.sh health
```

## 测试登录

1. 浏览器访问 http://localhost:3000
2. 手机号填 **`15079999999`**（`AuthService.TEST_PHONE` 硬编码测试号）
3. 验证码填任意 6 位数字（测试号跳过校验）
4. 首次登录自动注册，返回 `accessToken`

> 这条登录请求路径是：**Web → Next rewrite → Gateway(8686) → User Service(8081)**。Web 本身不直连业务端口，符合「所有公开请求经 Gateway」契约。

登录后可在 UI 创建 Project（路径：**Web → Gateway → Agent Service(8082)**）。

## 默认环境语义

| 维度 | 默认值 | 说明 |
|---|---|---|
| Agent 编排引擎 | `AGENT_ORCHESTRATOR_ENGINE=fake` | 不调真实 LLM；Python Worker `--adapter fake` |
| 图片生成 | `GENERATION_MODE=fake` + `GENERATION_FAKE_ALLOWED=true` | 本地确定性 Fake Provider（IK1NRZ），不调 TOS / OpenAI / Ark；生产环境禁止启用 |
| 受控真实图片验收 | 默认关闭（`GENERATION_ACCEPTANCE_ALLOWED=false`） | 仅限非生产显式启用的一次受控真实调用（IK1NS3），步骤与证据模板见 `acceptance/README.md` |
| 生成 Worker | `GENERATION_WORKER_SCHEDULED=true`（默认） | Java 内嵌 Worker 定时认领 GenerationJob 并推进到终态 |
| ContentReview | 本地确定性非生产审核（策略版本 `local-fake-v1`） | Fake 图片先经规范化 ContentReview，只有 `decided + pass` 才接纳为 Asset；拒绝/失败/无效证据 fail closed |
| 短信 | `SMS_PROVIDER=console` | 验证码打到 user-service 容器日志，不发真实短信 |
| 存储/审计 | 本地非生产 | MySQL 持久化到 docker volume；Fake 生成内容存 Agent 进程内存（重启即失效）；无对象存储 / 审计外部依赖 |

## 服务端口

| 服务 | 容器端口 | 默认宿主端口 | 健康端点 |
|---|---|---|---|
| Web (Next.js) | 3000 | 3000 | `GET /` |
| Gateway | 8686 | 8686 | `GET /health` |
| User Service | 8081 | 8081 | 端口可达（无专用 /health，测 `/` 返回 4xx） |
| Agent Service | 8082 | 8082 | `GET /health` |
| MySQL | 3306 | 3306 | TCP |
| Redis | 6379 | 6379 | TCP |
| Nacos | 8848 | 8848 | `/nacos/v1/console/health/readiness` |
| Agent Worker | — | — | 无 HTTP；看 `logs blue-whale-agent-worker` |

Nacos 控制台：http://localhost:8848/nacos（默认账号 `nacos/nacos`）。

## 命令一览

所有命令通过根入口 `scripts/local-mvp.sh`：

```bash
scripts/local-mvp.sh up           # 构建并后台拉起全部服务
scripts/local-mvp.sh down         # 停止并清理容器（保留数据卷）
scripts/local-mvp.sh health       # 8 服务健康检查，缺失报具体服务名
scripts/local-mvp.sh init         # 重置：down -v 清库后 up（重新跑 SQL 初始化）
scripts/local-mvp.sh ps           # 列出服务状态
scripts/local-mvp.sh logs [svc]   # 跟随日志；svc 可选（如 gateway / agent / web）
scripts/local-mvp.sh build        # 仅构建镜像，不启动
```

## 改发布端口

宿主端口冲突时改 `deploy/local/.env`（容器内端口不变）：

```env
MYSQL_PUBLISH_PORT=33060
REDIS_PUBLISH_PORT=63790
NACOS_PUBLISH_PORT=88480
WEB_PUBLISH_PORT=3000
GATEWAY_PUBLISH_PORT=8686
USER_PUBLISH_PORT=8081
AGENT_PUBLISH_PORT=8082
```

## 停止与重置

- **停止**（保留数据）：`scripts/local-mvp.sh down`
- **重新启动**（继续用旧数据）：`scripts/local-mvp.sh up`（不重建镜像则跳过 `--build`，直接 `up -d`）
- **完全重置**（清库重建）：`scripts/local-mvp.sh init` —— 删 MySQL 数据卷，重新跑 schema.sql + data.sql

## 凭据不入库

- `.env.example` 只含占位符，已入库
- `.env`（实际值）在 `.gitignore` 中被忽略
- 业务服务的 `application.yml` / `bootstrap.yml` 已改用 `${ENV:default}` 占位符，凭据由 env 注入
- `JWT_SECRET` 默认值是开发占位，**生产部署必须通过 env 覆盖**
- 火山短信、TOS、Ark 等真实凭据已从 yml 移除，远端部署时由 env 注入

## 不在范围内（其他 issue 处理）

- AgentChatPanel 创作澄清与 AgentRun 恢复 → IK1NRY
- Playwright E2E 覆盖 → IK1NS2
- 真实图片供应商受控验收 → IK1NS3 已交付（见 `acceptance/README.md`）；生产正式启用（接入 ADR-0021 审核供应商）→ IK1NS4
- VKE 部署、生产 KMS、OpenTelemetry / Collector → 不在本 MVP 范围

## 故障排查

- **Java 服务启动慢**：首次 Maven 全量编译约 5–10 分钟，后续走 layer cache
- **Nacos 启动慢**：standalone 模式约 30–40s 才 healthy，业务服务 `depends_on: condition: service_healthy` 会等待
- **MySQL 初始化只跑一次**：`docker-entrypoint-initdb.d` 仅在数据卷为空时执行；重置需 `init`
- **Worker 日志「claim 失败」是正常的**：说明当前没有 pending AgentRun；只要循环不退出即健康
- **端口冲突**：见「改发布端口」
