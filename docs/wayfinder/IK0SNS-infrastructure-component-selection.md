# IK0SNS：首版数据库、队列与对象存储组件选型（研究资产）

- **工单**：[IK0SNS 确定首版数据库、队列与对象存储组件](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0SNS)
- **父地图**：[IK0G75 规划 Agent 创作后端架构与开源脚手架选型](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G75)
- **类型**：wayfinder-research（AFK）
- **输入前提**：ADR-0015（Java 控制面 + Python Agent Worker + Java Generation Worker）、ADR-0016（可重放事件流）、ADR-0017（权威状态表 + Outbox/Inbox、租约栅栏、持续 Reconciler、对象先落盘）、ADR-0018（私有 Asset + 短期预签名 URL、OpenTelemetry、单区域 99.5% SLO）
- **日期**：2026-07-14

---

## 1. 结论速览（TL;DR）

首版**不引入**新的数据库、消息中间件、独立调度平台或第二套对象存储。在 ADR-0017/0018 冻结的语义约束下，复用现有 **MySQL 8 + Redis（Redisson）+ 火山引擎 TOS** 即可覆盖全部能力要求；唯一需要新增的组件是 **ShedLock**（轻量库，非新中间件），用于把现有 `@Scheduled` 单进程轮询升级为多副本安全。

| 能力域 | 选定组件 | 复用/新增 | 承载的 ADR-0017/0018 语义 |
|---|---|---|---|
| 关系数据库 / 权威事实 | **MySQL 8.0（InnoDB）** | 复用 | 状态表、聚合版本、Project 游标、Outbox/Inbox、租约、幂等记录、`next_action_at` 扫描 |
| 交付/通知与协调 | **Redis（Redisson）** | 复用 | 分布式锁、fencing 协调、SSE 推送通道、限流；可选轻量队列通知 |
| 任务调度 | **Spring `@Scheduled` + ShedLock** | 复用 + 新增库 | Reconciler/Worker 领取的触发器（多副本互斥） |
| 对象存储 | **火山引擎 TOS（S3 兼容）** | 复用 | 私有桶、对象先落盘、预签名上传(10min)/下载(5min) URL |
| 消息中间件 | **不引入**（MySQL 作持久队列） | — | 见 §3 拒绝项 |

> ADR-0017 已明确「外部调用不进入数据库事务」与「Outbox/Inbox/持续对账」模型——这套模型的设计前提恰恰是**不需要消息中间件的强投递保证**，而是用数据库持久队列 + 幂等接纳兜底。因此本结论与 ADR-0017 自洽，不构成回退。

---

## 2. 当前仓库事实（基线）

| 维度 | 现状 | 证据 |
|---|---|---|
| 数据库 | MySQL 8.0.31，单库 `blue_whale`；MyBatis-Plus 3.5.16，乐观锁 `version`、逻辑删除、JSON 列；HikariCP；动态数据源框架（`dynamic-datasource` 3.6.0）已就位但仅 master 一源 | `application.yml`、`pom.xml`、`schema.sql` |
| Redis | Redisson 3.16.7（`blue-whale-common-redis` 自带 `@Redisson` 注解式分布式锁、`RedisUtil`、`RedisTemplate`、可选拨 `RedisMessageListenerContainer`） | `RedisAutoConfigure.java`、`pom.xml` |
| 对象存储 | 火山引擎 TOS（`VolcengineStorageService` 基于 TOSV2 SDK）；`StorageType` 枚举已留 `ALI_YUN/VOLCENGINE` 扩展位；**当前仅 `PutObject` 直传，无预签名能力** | `VolcengineStorageService.java` |
| 调度 | Spring `@Scheduled`（`JobPoller` 5s 轮询 MySQL `next_poll_at`），单进程，无多副本互斥 | `JobPoller.java` |
| 消息队列 | **无**（无 Kafka/RabbitMQ/RocketMQ 依赖或使用） | 全仓 grep |
| 注册/配置 | Nacos（服务发现 + gateway 配置中心），Sentinel（gateway 流控） | `bootstrap.yml` |
| RPC | Dubbo 3.2.6 在 parent 依赖管理内，但运行单元未实际启用（agent-service 未引） | `pom.xml` |
| 进程拓扑 | 当前 agent/user/gateway 三服务；**JobPoller 仍在 agent 进程内**，尚未拆为独立 Generation Worker（ADR-0015 目标态） | `docker-compose.yml` |

---

## 3. 拒绝项（不引入的组件及理由）

### 3.1 拒绝引入独立消息中间件（Kafka / RabbitMQ / RocketMQ / Redis Streams 作正式队列）

**理由**：ADR-0017 已把交付语义定为「权威状态表 + 同事务 Outbox + 持续 Reconciler + 幂等接纳」，Outbox 消息本身就是 MySQL 里的持久行，`next_action_at` 索引让它可被分批认领。这个模型**故意不依赖** MQ 的投递保证——因为产品写入必须可幂等接纳，终端真相在数据库，不在 MQ。

- MySQL 8 `SELECT ... FOR UPDATE SKIP LOCKED`（[官方文档](https://dev.mysql.com/doc/en/innodb-locking-reads.html)）原生支持「多 Worker 互不阻塞地各认领一行」，这正是任务分发的标准模式，吞吐量在首版规模（单区域、小规模生产）下远超需求。
- 引入 MQ 会增加：新中间件运维、`exactly-once` 与产品幂等的双重兜底（DR 难题）、W3C Trace Context 跨 MQ 传播的额外接线、ADR-0018 审计与错误契约对 MQ 故障的处置路径——全部是首版不必要成本。
- **Redis Streams 也不作正式队列**：它虽有 consumer group + PEL（[Redisson 文档](https://redisson.pro/glossary/redis-streams.html)），但其持久性依赖 Redis RDB/AOF，ADR-0017 要求产品事实的权威持久化在 MySQL；用 Streams 承载 Outbox 等于把真相放次级存储，违背「数据库事务同生共死」原则。Redis 在本方案中**只承担协调与通知**（见 §4.2）。

**升级触发条件**（何时重新考虑 MQ）：
- Outbox 表 `next_action_at` 扫描的积压年龄持续超过 ADR-0018 SLO（Outbox 交付 P95 5s、最老队列任务 60s），且 SKIP LOCKED 分批领取 + 索引优化仍无法收敛；
- 单库写入吞吐成为瓶颈（需要读写分离/分库），导致 Outbox 与状态表无法同事务；
- 出现需要跨多个独立消费者扇出的产品事件（当前一个 Outbox 消费者足够）。

### 3.2 拒绝引入第二套对象存储 / 替换 TOS

**理由**：火山引擎 TOS 是 S3 兼容对象存储，官方明确支持预签名 URL（[预签名概述](https://www.volcengine.com/docs/6349/1400318)、[下载预签名 SDK 示例](https://www.volcengine.com/docs/6349/79910)、[上传预签名](https://www.volcengine.com/docs/6627/164388)），满足 ADR-0018「上传 10min、下载 5min、绑定 method/key/size/checksum」的全部硬约束。现仓库已集成 TOSV2 SDK 与 `VolcengineStorageService`，`StorageType` 枚举已抽象多供应商，没有理由为首版引入第二套存储。

**需要补的能力（不是新组件）**：现有 `VolcengineStorageService` 只有 `PutObject` 直传；ADR-0018 要求的「预签名上传/下载」「对象永久私有」「内容校验和绑定」属于**在该 SDK 之上扩展 presign 方法 + 把桶改为私有 + 私有桶策略**，属于实施票范畴，不是选型问题。

### 3.3 拒绝引入独立任务调度平台（XXL-Job / Quartz 集群 / DBOS）

**理由**：首版的调度需求是「按 `next_action_at` 分批扫描认领到期记录」+ 「周期性 Reconciler 唤醒」。前者本质是 SQL 查询，后者是固定周期任务。这两者用 Spring `@Scheduled` + `SELECT FOR UPDATE SKIP LOCKED` 已完全覆盖。引入 XXL-Job/Quartz 集群会带来独立的调度 DB/注册中心、新运维面与故障域，与「单区域、小规模生产」的定位不匹配。

- **唯一缺口**：`@Scheduled` 默认每个运行副本都会触发（[Baeldung: ShedLock with Spring](https://www.baeldung.com/shedlock-spring)）。一旦 Java Generation Worker 拆为多副本，`JobPoller`/Reconciler 会在每个副本重复执行。**ShedLock**（[官方仓库](https://github.com/lukas-krecan/shedlock)）是专为解决此问题的轻量库——它用现有 MySQL/JDBC 一张锁表保证「同一时刻仅一个副本执行」，不引入新中间件。

**升级触发条件**：
- 出现需要动态调度（运行时增删任务、cron 热更新）、依赖编排（DAG/工作流）或跨服务分布式任务编排；
- 任务量级使「轮询 DB」的空转成本显著（届时再评估 XXL-Job）。

### 3.4 拒绝引入新数据库（PostgreSQL / MongoDB / 时序库 / ES）

**理由**：ADR-0017 的全部持久化语义（短事务、聚合版本、Project 游标、Outbox/Inbox、唯一约束、`FOR UPDATE SKIP LOCKED`）都是 MySQL/InnoDB 的标准能力。JSON 列需求（Canvas `nodes_json`、RuntimeCheckpoint payload）MySQL 8 已支持。无全文检索/时序/文档模型的强需求。

**升级触发条件**：
- 出现强全文检索/向量检索需求（届时评估独立检索引擎，不替换主库）；
- 单库容量/写入瓶颈（届时先读写分离 + 分库，仍用 MySQL）。

---

## 4. 最小组件组合（选定项细化）

### 4.1 数据库：MySQL 8.0（InnoDB）——权威事实的唯一持久化边界

承担 ADR-0017/0018 全部「产品事实」：

- **权威状态表**：Project、Conversation、AgentRun、UserInputRequest、GenerationJob、Asset、Canvas、CostReservation、AuditRecord、ContentReview。
- **Outbox / Callback Inbox / 幂等记录**：与状态转移同事务写入（`SELECT FOR UPDATE` 锁定 Project 事件流行分配游标）。
- **租约与栅栏**：`lease_owner` / `lease_expires_at` / `fencing_token` 列 + 聚合 `version`。
- **调度扫描**：`next_action_at` 字段 + 复合索引（`(status, next_action_at)`），Reconciler/Worker 用 `SELECT ... FOR UPDATE SKIP LOCKED ... WHERE next_action_at <= NOW() ORDER BY next_action_at LIMIT N` 分批认领（[keyset 扫描避免深翻页](http://allyouneedisbackend.com/blog/2017/09/24/the-sql-i-love-part-1-scanning-large-tables/)）。
- **保留周期**：产品事件 30 天在线重放、幂等记录 30 天、Outbox/Inbox payload 7 天 + tombstone 30 天、AuditRecord 365 天——按 ADR-0017/0018 的保留表实现为带索引的定期清理（ShedLock 守护），非新组件。

**迁移边界**：现有 `blue_whale` 单库沿用；产品领域表为**新增表**（与现有 `template_card`/`skill`/`project`/`canvas` 共存于同库）。动态数据源框架保留，首版不启用读写分离。

### 4.2 Redis（Redisson）——协调与通知，非权威

Redis 承担的角色**严格限定为非权威协调层**，不存放任何产品事实：

- **分布式锁**：复用 `blue-whale-common-redis` 的 `@Redisson` 注解 / `RedisUtil`，用于跨进程互斥（如 SSE 通道、限流、成本额度原子扣减的协调路径）。注意：ADR-0017 的执行所有权核心是**数据库租约 + fencing token**，Redisson 锁只作辅助短临界区，不替代 DB 租约。
- **SSE 推送通道**：Project 事件流的多实例订阅/转发（Java Product API 多副本时，事件由 DB Outbox 驱动，Redis pub/sub 只做「通知有新事件」的轻量信令，真相仍由 DB 游标决定）。
- **限流 / 验证码 / 会话辅助**：现状已有。

**不承担**：Outbox 队列、产品状态、Asset 元数据。Redis 故障只影响协调与通知时效，不影响产品事实正确性（Reconciler 兜底）。

### 4.3 调度：Spring `@Scheduled` + ShedLock

- 现有 `JobPoller` 模式（`@Scheduled` 扫 `next_poll_at`）**直接复用为 Reconciler/Worker 领取的触发器**，但收敛到独立的 Java Generation Worker 进程（ADR-0015 目标态，当前在 agent 进程内属过渡）。
- 新增 **ShedLock**（JDBC provider，复用 MySQL 一张 `shedlock` 锁表）：保证 Reconciler/扫描类任务在多副本下「至多一个副本执行」([官方](https://github.com/lukas-krecan/shedlock))。领取类任务（Worker 认领 Job）本身靠 `FOR UPDATE SKIP LOCKED` 互斥，不需要 ShedLock。
- 退避与重试由 ADR-0017 的「持久化调度」字段（`attempt_count`/`next_attempt_at`/绝对截止）驱动，不依赖调度框架的重试器。

### 4.4 对象存储：火山引擎 TOS（复用，补 presign）

- **桶策略**：首版新建**私有桶**（拒绝公开桶，ADR-0018）。现有直传逻辑收敛为「服务端中转或预签名上传」二选一，按 ADR-0018「上传 URL 绑定 method/key/type/size/checksum、10min 有效」。
- **预签名**：扩展 `VolcengineStorageService` 增加 `presignDownload(key, 5min)` / `presignUpload(key, size, checksum, 10min)`，使用 TOSV2 SDK 官方预签名能力（[下载预签名](https://www.volcengine.com/docs/6349/79910)）。
- **对象先落盘**（ADR-0017 §12）：供应商结果字节先落 staging 键或不可变键 → DB 短事务登记 Asset 元数据 → 绑定 Job 槽位。孤儿对象（无 Asset 引用 + 无活动传输 + 7 天）由 ShedLock 守护任务 GC，删除前再核对引用。
- **供应商中立**：TOS 选择不构成供应商锁定——TOS 是 S3 兼容，后续若切阿里 OSS/AWS S3，`StorageType` 枚举 + `AbstractStorageService` 抽象已为此预留。

### 4.5 可观测性后端（ADR-0018 要求，本票顺带明确边界）

ADR-0018 要求 OpenTelemetry SDK + OTLP Collector。**SDK 侧**是代码依赖（三个运行单元各引 OTel SDK），非基础设施选型难题。**Collector + 后端存储/告警**的具体产品（自建 Tempo/Loki/Prometheus vs 云托管）属于部署票，本票只锁定：首版复用现有 Nacos/Sentinel 监控能力作过渡，OTel Collector + 后端在实施票定。

---

## 5. 升级触发条件汇总（何时重新选型）

| 触发信号 | 当前方案的瓶颈 | 候选升级 |
|---|---|---|
| Outbox 交付 P95 持续 >5s 或最老任务 >60s，SKIP LOCKED + 索引优化无效 | MySQL 轮询吞吐 | 评估 MQ（RabbitMQ/RocketMQ）承载 Outbox 投递 |
| 单库写入吞吐/容量瓶颈 | 单 MySQL 实例 | 先读写分离/分库（仍 MySQL）；极端情况考虑分布式 DB |
| 任务需要 DAG/工作流/动态调度 | `@Scheduled`+SQL | XXL-Job 或工作流引擎 |
| 强全文/向量检索 | MySQL | 独立检索引擎（不替换主库） |
| 多区域容灾 | 单区域 | 独立容灾架构（ADR-0018 已列为 out of scope） |

所有升级以「ADR-0017/0018 的 SLO 与告警阈值被实测突破」为唯一触发依据，不预设时间点。

---

## 6. 迁移边界（对现有代码的约束）

| 现状 | 首版目标 | 边界 |
|---|---|---|
| `JobPoller` 在 agent 进程内 | 收敛到独立 Java Generation Worker | 属 ADR-0015 实施票；本票只确认调度机制不变 |
| `@Scheduled` 无多副本互斥 | + ShedLock | 新增库 + 一张锁表，非新中间件 |
| TOS 仅 `PutObject` 直传、桶可能公开 | 私有桶 + presign 上传/下载 | 扩展现有 `VolcengineStorageService`，不换 SDK |
| `X-User-Id` 客户端自报 | 服务端 Token 认证 | ADR-0018 已定，属实施票 |
| 单库 `blue_whale` | 新增产品领域表（同库） | 不动现有 `template_card`/`skill`/`project`/`canvas` |

---

## 7. 与 ADR 的一致性核对

- **ADR-0017 §2「事务不跨外部副作用」** → MySQL 短事务承载，Outbox 同事务，外部调用在事务外。✅ 本方案无 MQ 参与。
- **ADR-0017 §10「持续对账器」** → `next_action_at` + `FOR UPDATE SKIP LOCKED` + `@Scheduled`+ShedLock。✅
- **ADR-0017 §12「对象先落盘」** → TOS staging 键 + DB 登记。✅
- **ADR-0017 Consequences「需要支持本地事务、聚合版本、Outbox/Inbox、租约栅栏、持久化调度」** → MySQL + Redisson 辅助锁全满足。✅
- **ADR-0018 §2「Asset 永久私有、短期预签名 URL」** → TOS 私有桶 + presign（10min/5min）。✅
- **ADR-0018 §8「OpenTelemetry」** → SDK 代码依赖，Collector/后端延后到部署票。✅
- **ADR-0018 §10「单区域 99.5% SLO」** → 单区域 MySQL/Redis/TOS 拓扑与 SLO 定位一致。✅

---

## 参考资料

- [MySQL 8.0 — InnoDB Locking Reads（SKIP LOCKED / NOWAIT 官方）](https://dev.mysql.com/doc/en/innodb-locking-reads.html)
- [Percona — MySQL 8.0 Hot Rows with NOWAIT and SKIP LOCKED](https://www.percona.com/blog/mysql8-hot-rows-with-nowait-skip-locked/)
- [ShedLock — GitHub 官方仓库](https://github.com/lukas-krecan/shedlock)
- [Baeldung — Guide to ShedLock with Spring](https://www.baeldung.com/shedlock-spring)
- [火山引擎 TOS — 预签名 URL 概述](https://www.volcengine.com/docs/6349/1400318)
- [火山引擎 TOS — 生成下载预签名 URL（SDK）](https://www.volcengine.com/docs/6349/79910)
- [火山引擎 TOS — 浏览器预签名上传](https://www.volcengine.com/docs/6627/164388)
- [Redisson — Redis Streams / Consumer Group 语义](https://redisson.pro/glossary/redis-streams.html)
- [The SQL I Love — 大表 keyset 扫描](http://allyouneedisbackend.com/blog/2017/09/24/the-sql-i-love-part-1-scanning-large-tables/)
- 输入 ADR：[ADR-0015](../adr/0015-java-product-control-plane-python-runtime.md)、[ADR-0016](../adr/0016-project-api-and-replayable-event-stream.md)、[ADR-0017](../adr/0017-product-persistence-idempotency-and-recovery.md)、[ADR-0018](../adr/0018-security-cost-review-audit-observability-baseline.md)
