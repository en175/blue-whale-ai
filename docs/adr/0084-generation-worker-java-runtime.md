# ADR-0084：generation-worker 迁移为独立 Java 薄执行器服务

- **状态**：Accepted（含**修正一**：同日决策反转，薄执行器 → 直连 DB，见决策 2）
- **日期**：2026-09-10
- **决策者**：lixq（经 `/grilling` 会话共同得出）
- **取代**：[ADR-0068](0068-node-typescript-product-runtime-and-specialized-compute-boundary.md) 中 `generation-worker` 运行时为 Node.js LTS 的条款。ADR-0068「Worker 进程隔离」「专用计算组件不得带回第二套领域规则」条款**继续有效**，并被本决策升级为硬约束。
- **关联**：[ADR-0015](0015-java-product-control-plane-python-runtime.md)（Java worker 退役历史基线）、[ADR-0074](0074-frontend-backend-separation-nestjs-product-api.md)、[ADR-0075](0075-generation-worker-into-nestjs-backend.md)
- **工单**：IKEL4A（母单）；契约基线见 `docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md`

## 背景

现生成执行面 `backend/apps/generation-worker`（RocketMQ 4 消费者：video-step / image / audio / media_extract，另含 recovery 与 asset-GC cron；支撑面约 2.5–3 万行 TS）全部由 AI 生成，而团队母语为 Java——无人能逐行把关这个核心进程。迁移动机是**团队母语可维护性**，不是 Java 的性能或建模优势。

grilling 会话钉实的事实（如实记录，防止后来者误读为技术必然）：

- 该负载是 I/O 编排型（等上游模型 API、对象存储、DB），语言选型不提供技术信号；CPU 大户 ffmpeg 走子进程，与宿主语言无关。
- `rocketmq-client-nodejs` 成熟度偏弱是真，但正确性已由「DB claim CAS + fencing token + 60s recovery 兜底」从 MQ 客户端手里赎回归 DB，不构成选型依据。
- 本仓曾运行并退役 Java 版 worker（`blue_whale_server`，ADR-0015），退役主因（双份契约漂移、第二套领域规则）在今天依然成立——本 ADR 把该教训继承为决策 2 的硬约束，而非无视它。

## 决策

1. 同仓新建独立 Java 服务 `worker-java/`，承接全部 4 类 job 的消息消费、上游调用与结果回传；技术栈 Java 21 + Spring Boot 3 + 官方 `rocketmq-client-java` + MyBatis + 火山 TOS Java SDK + OkHttp。环境变量与 TS 版同名。NestJS 主 API（`backend/apps/blue-whale`）不迁移。
2. **直连 DB 执行（修正一，2026-09-10 用户二次拍板，替换原「薄执行器」条款）**：目标分工 = **TS 侧只发任务（建 job、投 MQ、recovery 重投、asset-GC），Java 侧做任务（claim、调上游生成、终态写入），双方交互面只有数据库 + MQ，不存在 HTTP 依赖**。`worker-java` 直连同一 MySQL，按契约 §3 逐项实现 claim / fencing / lease / 终态写，持久层 MyBatis-Plus（每条 SQL 逐字对照 TS 源并注释 file:line）；原「internal endpoints」方案（IKEL4J）不采纳。防漂移防线 = **金标测试套件**：契约 §3 行为先以 TS characterization 测试固化，Java 镜像测试以同一批用例验收。任一时刻同一 tag 的状态机写入方唯一（TS/Java 停一启一）。
3. **契约先行**：MQ 消息 schema、状态机与租约语义、错误码↔计费映射、internal endpoints 定义冻结为契约文档（上链），作为 TS/Java 双端对账的唯一基准；冻结后改动须双端同步评审。
4. **四刀灰度**：`media_extract → audio → image → video-step` 顺序迁移；每刀独立 PR、独立回滚开关（TS/Java consumer group 停启），双跑对账 ≥1 周后进入下一刀。刀① 免计费（extract 无预留行）**立即开工**；刀②③④ 开工前提 = 同事 IKEF1K（cost_reservations/cost_adjustments 账本退役）已合入 master——Java 按无账本终态直接实现，不做过渡兼容，避免同库双标。
5. 治理文本同步修订：CLAUDE.md 红线 #10 与 CONTEXT.md「产品实现」词条（规则源改动走分支 → PR）。

## 被否决的备选

- **原地加固**（测试 + 文档 + 契约冻结，语言不动）：成本最低（2–3 周），但决策者判定主要矛盾「无人能 review」无法在团队母语外解决。
- **独立仓库落点**：会脱离 Hook / 流水线 / 共享契约治理网，恰与本次迁移的「可控」目的相反。
- **Go 替代 Java**：在「团队能力」这一判据下技术上更优（常驻 daemon 足迹、官方 MQ 客户端），因技能存量是 Java 被否。
- **主 API 一并大爆炸重写**：影响面无法过分层测试门；列为一期不动。
- **薄执行器（internal endpoints，本 ADR 初版决策 2）**：同日由用户撤回——诉求从「状态机权威留在 TS」变更为「Java 全自主执行、TS 只发任务」，交互面收敛为 DB+MQ。其端点职能清单保留于契约 §4/附录 B，转为移植对照表。

## 后果

- 正向：worker 进入母语逐行 review 制度；Java 侧执行面完全自主，不依赖 TS 排期；跨栈接口收敛为「DB 表 + MQ topic」两个硬边界。
- 成本：Java 人力约 1–1.5 人月（状态机移植 + 金标套件替代原端点工作量，净量级不变）；日历 6–10 周（含灰度对账）；**双实现漂移税由假设变为事实**——当年 Java worker 退役的病根回来了，唯一防线是金标套件 + 契约 §3 + 双跑对账。
- 已知风险（本 ADR 不解决，均已登记）：① 主 API 仍是 AI 生成 TS，维护预案缺口未闭合；② IKC9EJ 类 claim/settle 接缝语义漂移，防线从「端点封装」降级为「金标测试」；③ 火山流水线对 Java 镜像的构建部署支持待子单验证，不通则落点回炉；④ schema 变更权威在 Prisma migration，改表须联动检查 worker-java MyBatis-Plus mapper；⑤ Java 连接池与 Prisma 同库共存，租约/池参数上线前压测定档；⑥ 刀②③④ 被 IKEF1K 排期 gate。
- 成立前提：本决策的可控性承诺成立与否，取决于每个 PR 是否被逐行 review。若 review 制度失守，应重开本 ADR，而非默认延续。
