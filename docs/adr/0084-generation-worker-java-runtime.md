# ADR-0084：generation-worker 迁移为独立 Java 薄执行器服务

- **状态**：Accepted
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
2. **薄执行器硬约束**：`generation_jobs` 的 claim / fencing / lease / 预扣结算状态机权威单源保留在 NestJS backend，经新增 internal endpoints（`claim / heartbeat / complete / fail`，封装现有 CAS 语义、不改写）暴露。Java 侧禁止实现第二套状态流转与计费规则；recovery sweeper 与 asset-GC 留在 TS 进程充当兜底裁判。
3. **契约先行**：MQ 消息 schema、状态机与租约语义、错误码↔计费映射、internal endpoints 定义冻结为契约文档（上链），作为 TS/Java 双端对账的唯一基准；冻结后改动须双端同步评审。
4. **四刀灰度**：`media_extract → audio → image → video-step` 顺序迁移；每刀独立 PR、独立回滚开关（TS/Java consumer group 停启），双跑对账 ≥1 周后进入下一刀。
5. 治理文本同步修订：CLAUDE.md 红线 #10 与 CONTEXT.md「产品实现」词条（规则源改动走分支 → PR）。

## 被否决的备选

- **原地加固**（测试 + 文档 + 契约冻结，语言不动）：成本最低（2–3 周），但决策者判定主要矛盾「无人能 review」无法在团队母语外解决。
- **独立仓库落点**：会脱离 Hook / 流水线 / 共享契约治理网，恰与本次迁移的「可控」目的相反。
- **Go 替代 Java**：在「团队能力」这一判据下技术上更优（常驻 daemon 足迹、官方 MQ 客户端），因技能存量是 Java 被否。
- **主 API 一并大爆炸重写**：影响面无法过分层测试门；列为一期不动。

## 后果

- 正向：worker 进入母语逐行 review 制度；backend 与 worker 之间形成稳定的 internal API 边界。
- 成本：Java 人力约 1–1.5 人月 + backend 端点约 1 周 TS；日历 6–10 周（含灰度对账）；永久性的双栈契约漂移税，靠契约文档 + 契约测试 + 双跑对账压制。
- 已知风险（本 ADR 不解决，均已登记）：① 主 API 仍是 AI 生成 TS，维护预案缺口未闭合；② claim / 结算接缝的 IKC9EJ 类语义漂移只能靠对账压制、不能根除；③ 火山流水线对 Java 镜像的构建部署支持待子单验证，不通则落点回炉。
- 成立前提：本决策的可控性承诺成立与否，取决于每个 PR 是否被逐行 review。若 review 制度失守，应重开本 ADR，而非默认延续。
