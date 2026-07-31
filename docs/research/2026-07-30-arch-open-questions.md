# 架构开放问题清单（开会讨论用）

> 2026-07-30 基于源码深度调研整理。**只抛问题，不下结论。** 每条带 `file:line` 证据。
> 调研覆盖三块：用户系统/鉴权、CI/部署/测试、生成链路/产品功能。

---

## 一、产品层（业务/功能）

### Q1. 用户系统到底几套？现在事实是「三套并存」

调研发现鉴权方式不止两套，是**三套并存且未统一**：

| 鉴权域 | 机制 | 进程 | 证据 |
|---|---|---|---|
| 蓝鲸产品接口（画布/生成/项目） | sk-xxx token → `/api/token/identity` → userId | Next.js 前端 + Go fork | `authenticated-user.ts:107-146` |
| new-api 控制台/管理端 | gin session + `middleware.UserAuth()` | Go fork（blue_whale_api） | `api-router.go:238` |
| 蓝鲸 Java 服务（gateway/agent） | JWT 全局过滤器，注入 `X-User-Id` header | Java（blue_whale_server） | `JwtAuthGlobalFilter.java:36-98` |

**问题**：这三套用的是同一批用户吗？token 体系互通吗？Java 侧的 JWT 和 new-api 的 sk-token 如何对应同一个用户？

---

### Q2. 手机号+短信登录写了一半，没接通

- `lib/auth/handle-login.ts` + `handle-send-code.ts` 已写（Prisma + JWT + SMS provider）
- `app/api/auth/send-code/route.ts` **用了** `handleSendCode`
- 但 `app/api/auth/login/route.ts` **没用 `handleLogin`**，只认 `{username, password}`（走 new-api `/api/user/login`）

**问题**：手机登录是计划内的功能还是已废弃？如果要做，`/api/auth/login` 要接 `handleLogin`；如果不做，`handle-login.ts` 和 send-code 是死代码该清理。而且手机流程的 Prisma 库和 new-api 的 users 表是**两套库**，用户数据会分裂。

---

### Q3. 音频生成是纯 MOCK，要不要做、什么时候做

- 前端 `generateAudio` 固定返回 sample URL + 假 assetId，**不发任何请求**（`generation.ts:171-182`）
- Dock UI 标着"模拟生成"（`AudioDockContent.tsx:454`）
- DB 命令层只支持 `image | video`，无 audio（`generation-command-repo.ts:12`）
- 但 new-api fork **有音频能力未接入**：`dto/audio.go`（OpenAI TTS 风格）、`dto/suno.go`（Suno 音乐）

**问题**：音频是产品路线图上的功能吗？new-api 已有 TTS/Suno 能力，接还是不接？

---

### Q4. 视频首尾帧/多参考图：UI 支持，后端拒绝

- Dock UI 和 video-job-runner 都支持首帧+尾帧+多参考图
- 但 new-api 适配层在 `lastFrameImage` 或多参考图时**直接 422**：`"当前 new-api 视频接口不支持首尾帧或多参考素材"`（`new-api-client.ts:437-452`）
- 即：用户在 UI 能选尾帧，提交会被后端拒

**问题**：这是 new-api 上游限制还是要适配？首帧单图可以，尾帧+多参考不行——产品上怎么定边界？

---

### Q5. 积分/计费链路全是占位，没打通

- 创建任务时 `reserved_amount_fen: 0`（预扣恒为 0，`command-repo.ts:80`）
- 完成时 `actual_amount_fen: 0`（`worker-repo.ts:460,776`），价格目录版本 `"dev"`
- 前端 `User.credits` 字段存在，但 `/api/me` **不返回 credits**（`me/route.ts`）
- 充值系统默认 MOCK（`NEXT_PUBLIC_MOCK_RECHARGE !== "false"`），无对应 Next API 路由
- 生成前**无余额预检**，只有 provider 返 402 时才映射 `quota_exhausted`

**问题**：充值→积分→生成扣费→余额拦截，这条商业闭环什么时候做？现在生成是「免费用」状态。

---

### Q6. 模型能力矩阵有缺口

- DB schema 有 `supported_durations` / `default_duration` 列，但 **repo 不暴露**（全仓 0 匹配），前端视频时长**硬编码 = 5**（`useCanvasGeneration.ts:281`）
- **无 `first_frame` 能力字段**：能力表不声明「某模型是否支持首帧」，用户无法按模型判断
- 上游 `!202` 刚加了表单按模型收窄（时长/首尾帧/参考），但 repo 层和这些字段对不齐

**问题**：能力矩阵是单一真相源，还是前端硬编码 + DB 各管一段？谁权威？

---

## 二、代码层（架构/实现）

### Q7. blue_whale_api 是 new-api 的 vendored fork——升级策略是什么

- `blue_whale_api/go.mod` 保留原 module path `github.com/QuantumNous/new-api`
- 是同仓库子目录（不是 submodule、不是独立 git 仓）
- 蓝鲸定制（`GetTokenIdentity`、`ResolveUserByTokenKey`）是 fork 新增，上游无

**问题**：new-api 上游有更新时怎么 rebase？定制点和上游冲突如何解决？有没有记录「改了哪些文件」？

---

### Q8. Java 后端在退役，但还没退完

- `next.config.ts:5-6` 注释「IK50GB 断链后不再有 Java 网关」
- 但 Java gateway（`JwtAuthGlobalFilter.java`）和 agent-service（`ConversationController.java:29` 读 `X-User-Id`）仍在
- `apps/product-api` 是**空壳**（只有 dist，无源码）

**问题**：Java 侧的退役边界在哪？agent-service（对话功能）迁不迁、什么时候迁？gateway 删了 agent-service 怎么拿 userId？

---

### Q9. 视频生成有两套 worker，功能重叠

- `blue_whale_web/workers/generation-worker.ts` — BullMQ Worker（端口 4002），含 recovery scan
- `apps/generation-worker/src/index.ts` — 独立 app，`runVideoWorkerLoop` 轮询模式，`GENERATION_RUNTIME_MODE` 切 fake/new-api

**问题**：哪个是生产用的？另一个是遗留还是备选？两套共存会不会双消费？

---

### Q10. 前端轮询 vs SSE：两套状态同步机制并存

- 有 SSE 端点 `/api/projects/[id]/events`（`appendProjectEvent` 推 `generation_job.status_changed` 等）
- 但前端 `useCanvasGeneration` 用**轮询**不用 SSE
- IK50GB 刚把轮询升级成批量（`/api/jobs?ids=`，最多 100 个/批）

**问题**：最终走 SSE 还是轮询？两套维护成本高，且 SSE 实时性更好但轮询更简单——产品上要哪种体验？

---

### Q11. WireInteger 精度安全已落地，但覆盖完整吗

- IK50GB 引入 `WireInteger`，超大 ID（> `Number.MAX_SAFE_INTEGER`）不再经 `Number()` 转换
- 但调研发现部分文件（BottomDock / assets.ts）之前缺 import（已修），说明**迁移可能没全覆盖**

**问题**：还有没有遗漏的 `Number(id)` 转换点？要不要加个 lint 规则禁止对 job_id/asset_id 用 Number？

---

## 三、工程层（CI/部署/测试）

### Q12. 没有 CI 门槛，合并 PR 不强制测试绿

- Gitee 私有仓**没接 CI**（`.github/workflows` 是 new-api 继承的死代码，Gitee 不读）
- 合并靠人工/MCP，**无强制 typecheck/test 通过**
- 这次合并就带了上游的 typecheck 错误（qrcode 类型缺失、!202 fixture 缺字段）进来

**问题**：要不要接 Gitee 流水线，把 `pnpm verify`（typecheck + test + build）设为合并门槛？

---

### Q13. 「合并 master 自动部署」这个认知需要核实

- 调研发现部署走**火山引擎 Volcano 流水线（手动触发）** + SSH scp，**无 push 触发自动部署**
- `pipeline-blue-whale-web.yml` 是 `手动触发 | Gitee 拉取 → 构建 → 推镜像`
- 服务部署封装在 skill 里（`disable-model-invocation: true`，须人显式触发）

**问题**：测试服到底是自动还是手动部署？前后端部署是否同步？这次 IK50GB 合并后，测试服后端有没有更新（含 `/api/token/identity`）？

---

### Q14. 本地 Git Hooks 默认没装

- `.githooks/` 有完整的 pre-commit/pre-push（lint、禁直推 master、分支校验）
- 但 `git config core.hooksPath` **未设置**，hooks 默认不生效
- 质量完全靠开发者自觉跑 `pnpm verify`

**问题**：要不要在 README/onboarding 里强制 `git config core.hooksPath .githooks`？

---

### Q15. 测试服后端版本滞后导致联调跑不了

- 测试服 `115.190.244.91:3005` 跑旧版 new-api，`/api/token/identity` 返回默认 401（端点未注册）
- 这是 IK50GB §8.3 smoke 跑不了的根因
- `development-resolution.test.ts` 失败是上游 `7f901b62` 自带的 cwd 假设 bug（只从仓库根跑才过）

**问题**：测试服后端的更新流程是什么？谁来部署？能不能和前端部署对齐节奏？

---

## 附：调研中确认的正面事实（不是问题）

- **视频 worker 持久化扎实**：lease（120s）+ fencing token（CAS）+ cancellation + Redis 恢复 + 凭证密封，完整实现（`generation-worker-repo.ts`）
- **IK50GB 统一认证已合并**：批量轮询 `/api/jobs?ids=`、WireInteger 精度、守卫测试全在 master（第三个 agent 跑的是清理后分支，没看到这些，属误报）
- **用户系统数据同源**：blue_whale_api fork 直接用 new-api 的 `users`/`tokens` 表，没造第二套用户表
- **sk-token 是 new-api 原生概念**，不是蓝鲸发明的；一个用户可有多 token，登录取第一个

---

## 建议讨论顺序（明天开会）

1. **Q1 + Q7**：用户系统几套 + fork 升级策略（架构根基，先定）
2. **Q13 + Q15**：部署机制核实 + 测试服对齐（影响所有人联调）
3. **Q5**：积分计费闭环（商业化的前置）
4. **Q2/Q3/Q4**：手机登录、音频、首尾帧（功能取舍，按优先级排）
5. **Q12**：CI 门槛（工程基建，决定后谁落实）

---

## 四、基础设施层（2026-07-31 补充调研 + 决策）

> 这一层是「上线前必须想清楚」的全局架构项。

### ⚠️ 重要澄清（2026-07-31 核实）

调研初期基于**代码配置**判断为「单机裸奔」，经与团队核实，**生产环境已采购云托管**：
- **生产 Redis**：买的云 Redis，**已是主从**（非单点）
- **生产 MySQL**：买的云 RDS，**已是主从**（非单点）

所以单点风险仅存在于**测试服 + 本地**（开发环境，合理）。生产命脉可靠性已解决。**真正的缺口集中在：集中日志 / 监控告警 / CDN / 扩容**。

### 现状速览（已核实）

| 维度 | 生产 | 测试服/本地 | 真缺口？ |
|---|---|---|---|
| 消息队列 | BullMQ（云 Redis 主从）+ 支付域 RocketMQ | BullMQ（单机 Redis） | ❌ 已解决 |
| Redis | **云托管主从** | 单机 | ❌ 已解决 |
| MySQL | **云 RDS 主从** | 单机 | ❌ 已解决 |
| 集中式日志 | **无**（Node console / Go log / Java logback 各自落盘） | 无 | ✅ **缺口** |
| 监控 metrics | **无** Prometheus / 无 `/metrics` | 无 | ✅ **缺口** |
| 链路追踪 | **无**（仅 gateway 遗留 SkyWalking，ADR 要求移除未落地） | 无 | ✅ **缺口** |
| 告警 | **无**（仅业务 Feishu webhook，非监控告警） | 无 | ✅ **缺口** |
| CDN | **无**（TOS 直连） | 无 | ✅ **缺口** |
| K8s/弹性伸缩 | **无**（单 VM 8C16G） | 无 | ⚠️ 看规模 |
| CI 门槛 | **无**（Gitee 未接流水线） | 无 | ✅ **缺口** |
| schema 耦合 | 三 ORM（Prisma/GORM/JPA）共库 | 同 | ⚠️ 技术债 |

---

### 决策总表（2026-07-31 grill 完成）

| # | 决策项 | 拍板 | 理由 |
|---|---|---|---|
| Q16 | MQ 选型 | **保持 BullMQ**，不为「解耦」换 Kafka/RocketMQ | 视频任务低频长耗时，BullMQ 完美匹配；换 MQ 要重写 lease/fencing；Kafka 的位置是日志不是任务队列 |
| Q17 | 集中日志 | **火山 TLS + OTel Collector** | 同 VPC、免运维（不搭 ES）、查询强；OTel Collector 一鱼三吃（日志+metrics+trace）；ADR-0035 已规划 |
| Q18 | 监控告警 | **APMPlus + 云监控 + Feishu** | 接同一 OTel 管道；云监控管基础设施（MySQL/Redis/CPU 自带）；ADR-0035 已规划，本质是执行 |
| Q19 | Redis 单点 | **生产已主从**（云托管），无需动作；测试服/本地单机合理 | 命脉已解决 |
| Q20 | MySQL 单点 | **生产已主从**（云 RDS），无需动作 | 命脉已解决 |
| Q20b | schema 耦合 | **划定表归属权 + 推动退役 Java（Q8）** | 治本靠退役 Java（三 ORM→一 ORM）；现在不重构分库 |
| Q21 | 部署扩容 | **拆服务到多 VM，K8s 暂缓** | web 和 worker 必须分机（worker 挤 web）；K8s 等规模起来再说（和 MQ 同逻辑） |
| Q22 | CDN | **火山 CDN + TOS 源站** | 同生态、CDN 流量比 TOS 直连便宜 30-50%、边缘缓存加载快；配 URL 鉴权适配现有签名 URL |

**两个认知纠偏（开会必讲）**：
1. 生产 Redis + MySQL 都已买云托管主从——**不是单点**。调研里「单机」是代码配置看到的，实际生产拓扑已解决。真缺口在日志/监控/告警/CDN/扩容。
2. 「专业」不是堆最重的组件，是**按规模/场景匹配工具**（MQ、K8s、ES 都适用这个逻辑）。

---

### Q16. 消息队列（MQ）：要不要为「解耦」换 Kafka/RocketMQ？

**决策已定：保持 BullMQ + Redis 升级哨兵**。详见下文「附：MQ 选型决策记录」。

**核心判断**：
- 视频生成是**低频长耗时任务**（并发 8），BullMQ 的延迟/重试/lease/fencing 完美匹配，Kafka/RocketMQ 是杀鸡用牛刀
- 「解耦」不是「非要用某品牌 MQ」，而是「异步 + 进程隔离 + 消息驱动」——BullMQ 已实现
- Kafka 的正确位置是**日志收集/事件流**（那块我们现在缺），不是视频队列
- 迁移成本高：换 MQ 要重写 lease/fencing/延迟/重试，且 Node 生态降级

### Q17. 集中式日志 ✅ 决策：火山 TLS + OTel Collector

- 现状：Node/Go/Java 各自落盘，无聚合，出问题靠 SSH 翻日志；ADR-0035 规划火山 APMPlus 未落地
- **决策**：火山 TLS（云日志服务）+ OpenTelemetry Collector 采集
- **为什么不是 ELK/Loki**：ES 吃内存（8C16G 玩不转）、要管索引膨胀/备份/升级，无专职运维不靠谱；Loki 仍要自建管存储。云日志免运维、按量、查询强
- **为什么是 OTel Collector 而非 filebeat**：一个 Collector 采三栈（Node/Go/Java 都有 OTel SDK），且为 Q18 metrics/trace 铺路——ADR-0035 本就规划 OTel+APMPlus，这是执行已批准 ADR
- **落地动作**：各服务接 OTel SDK（Java 用 javaagent 字节码注入免改代码）→ 部署一个 OTel Collector → 配火山 TLS 导出端 → 日志打 `trace_id` 跨服务串联

### Q18. 监控 + 告警 ✅ 决策：APMPlus + 云监控 + Feishu

- 现状：无 Prometheus、无 `/metrics`、无告警（仅业务 Feishu webhook）；`/ready` 健康端点有但无外部探测；故障靠用户投诉
- **决策**：火山 APMPlus（接 OTel metrics，应用层）+ 火山云监控（基础设施层 MySQL/Redis/CPU 自带）+ Feishu 群告警
- **一鱼三吃**：和 Q17 日志走同一 OTel Collector 管道（日志+metrics+trace）
- **告警门槛**（ADR-0035 P0/P1）：
  - **P0（立刻打电话）**：web/api/worker `/ready` 连续失败 3 次、MySQL/Redis 不可连
  - **P1（Feishu 群通知）**：任务积压 > 阈值、provider 错误率 > 5%、慢查询 > 1s
- **为什么不自建 Prometheus**：TSDB 要管容量/保留期/高可用（单点 Prometheus 自己是坑），APMPlus 自带大盘+告警+免运维

### Q19. Redis 单点 ✅ 决策：无需动作（生产已主从）

- 调研初期判断「单机」基于代码配置，**核实后生产已是云托管主从**
- 单机仅测试服/本地（开发环境，合理）
- 唯一待确认：生产云 Redis 的故障转移**是否验证过**（主从不等于自动切换，需确认 sentinel/故障转移已开）——运维侧事项

### Q20. MySQL 单点 + schema 耦合 ✅ 决策：无需动作（已主从）+ 划定表归属权

- **单点**：生产 MySQL 已是云 RDS 主从，无需动作（同 Q19）
- **schema 耦合**（三 ORM Prisma/GORM/JPA 共库）：决策**划定表归属权 + 推动退役 Java（Q8）**
  - 治本靠退役 Java：Java 退完三 ORM→一 ORM，耦合自动消失
  - 现在不重构分库（成本高、过渡期重、Java 退役后白干）
  - 轻量治理：写「表归属矩阵」（谁拥有/谁只读）+ code review 兜底

### Q21. 部署扩容 ✅ 决策：拆服务到多 VM，K8s 暂缓

- 现状：单 VM 8C16G，gateway/user/agent/web/api + mysql + redis + nacos 全挤一台；worker 生成时挤 web
- **决策**：DB/Redis 已云托管→从应用机挪走；web 和 worker 分机；应用机只跑 web+gateway；K8s 暂缓
- **为什么不上 K8s**：K8s 解决规模问题（大规模编排+自动扩缩+滚动发布），现服务少、用户量未起、无专职运维——和 MQ 同逻辑，工具匹配规模
- **演进**：单 VM → 拆多 VM（web/worker 分机）→ K8s（服务 10+ 个、需弹性时）

### Q22. CDN ✅ 决策：火山 CDN + TOS 源站

- 现状：生成产物（图片/视频）走 TOS 裸 URL，无 CDN，视频文件大加载慢
- **决策**：火山 CDN 挂 TOS 源站，配 URL 鉴权适配现有签名 URL
- **理由**：同生态配置简单、CDN 流量比 TOS 直连便宜 30-50%、边缘缓存加载快
- **时机**：和视频生成功能正式上线同步做（优先级低于日志/监控）

---

## 附：MQ 选型决策记录（2026-07-31）

### 决策：保持 BullMQ + Redis 升级哨兵/集群

### 横向对比（针对我们的负载：视频生成低频长耗时任务）

| 维度 | BullMQ (Redis) | Kafka | RocketMQ | RabbitMQ | NATS JetStream |
|---|---|---|---|---|---|
| 设计定位 | 任务队列 | 高吞吐日志/事件流 | 金融级事务消息 | 通用消息路由 | 云原生轻量 |
| 持久化可靠性 | 中（依赖 Redis） | 强（磁盘副本） | 强（CommitLog） | 强（镜像队列） | 强（副本） |
| 延迟/定时任务 | ✅ 原生 | ❌ 需自造 | ✅ 原生 | ✅ 插件 | ⚠️ 有限 |
| 重试/backoff | ✅ 原生 | ❌ 自造 | ✅ | ✅ | ⚠️ |
| 死信队列 | ✅ 原生 | 自造 | ✅ | ✅ | ✅ |
| 运维复杂度 | 低 | 高（Broker+KRaft） | 中高（NameServer+Broker） | 中 | 低 |
| 资源占用 | 极低 | 重（单 broker 2G+） | 重 | 中 | 极低 |
| 8C16G 单机能跑 | ✅ 轻松 | ⚠️ 勉强 | ⚠️ 勉强 | ✅ | ✅ |
| Node 生态 | ✅ 一等公民 | ✅ kafkajs | ⚠️ 弱 | ✅ | ✅ |
| 我们已有 | ✅ 生产在用 | ❌ | ✅ 支付域 | ❌ | ❌ |
| 适合视频任务 | ✅ 完美 | ❌ 杀鸡用牛刀 | ⚠️ 大材小用 | ✅ 可以 | ✅ |

### 各选项结论

- **Kafka ❌**：场景错配（高吞吐日志流设计，视频任务低频用不上）+ 功能缺口（无延迟/重试/优先级）+ 运维重。**Kafka 的正确位置是未来日志收集/事件流管道**。
- **RocketMQ ⚠️**：强在事务消息/顺序消息（视频生成用不上），和支付域隔离复用不了，Node 生态弱。**适合的位置是未来金融级扣费（支付域已在用）。**
- **RabbitMQ ✅（备选）**：功能全、Node 生态好、运维比 Kafka 轻，但 BullMQ 已覆盖需求。**若未来要独立于 Redis 的专业 MQ，比 Kafka 更合适。**
- **BullMQ ⭐（主决策）**：场景完美匹配 + 已落地（lease/fencing/cancel/恢复全有）+ 零迁移。

### 「解耦」认知纠偏

- **误区**：「专业企业都用 MQ 解耦」。真相：MQ 解耦的是**特定类型**的耦合（异步 + 进程隔离 + 消息驱动），BullMQ 已实现这个模式。
- **成熟企业是分层用工具**，不是全用 Kafka：
  - 任务队列（低频可靠）→ BullMQ / RabbitMQ
  - 事件流（高吞吐日志）→ Kafka
  - 通知广播（瞬态）→ Redis Pub/Sub
  - 事务消息（金融级）→ RocketMQ
- **专业 = 每个场景用对的轻量工具，不是所有场景都用最重的工具。**

### 上专业 MQ 的三个信号（现在都没出现）

1. Redis 集群也扛不住（任务积压百万级 / 跨机房）——离我们很远
2. 出现「一份数据多个独立消费者」需求（生成完要同时通知+记账+分析+转码）——现在只有更新库+推 SSE
3. 跨服务异步通信频繁（服务拆到 10+ 个、调用链成网状）——现在服务少

### 迁移成本（为什么留 BullMQ 更划算）

- 换 MQ 要重写：lease（120s）+ fencing token + cancellation + Redis 恢复（手写业务逻辑，Kafka/RabbitMQ 不自带）
- 延迟/重试任务要重建（BullMQ 原生，Kafka 要自造）
- 双写过渡期风险（任务分流/重复/状态不一致）
- 运维新栈 + Node 生态降级
- **反过来：业务逻辑（`runVideoJobStep`）已与队列实现解耦（依赖注入），未来要换也能换——换管道不换水。**

### 演进路线

```
现在：BullMQ + 单机 Redis
  ↓
第一步（立刻）：Redis 升级哨兵（解决单点）  ← 性价比最高
  ↓
第二步（任务量涨10倍）：BullMQ 不动，观察积压
  ↓
第三步（出现多消费者/跨服务事件需求）：
        → 日志/埋点/审计上 Kafka（Kafka 的主场）
        → 视频任务继续 BullMQ
  ↓
第四步（金融级扣费）：RocketMQ 事务消息（支付域已在用）
```

### 开会一句话结论

> 「我们不是不上专业 MQ，是现在还没到上的时候。视频任务队列 BullMQ 已满足，单点是 Redis 没做哨兵。Kafka 真正的价值在日志收集和事件流——那块我们现在缺（无集中日志），未来上 Kafka 的位置在那里，不是视频队列。初创期的『专业』是『每个场景用对的轻量工具 + 保持业务解耦』，不是『一上来全用最重的组件』。」
