# ADR-0117：自建用户体系与计费体系，取代 ADR-0062

- **状态**：Proposed（待评审）
- **日期**：2026-09-24
- **决策者**：lixq（架构讨论会话）
- **取代**：[ADR-0062](0062-new-api-account-center-and-quota-billing.md) 全部；`docs/specs/billing-units-contract.md`（计费单位与「禁止 Node 改余额」条款）；`docs/specs/cost-settlement-sync-contract.md`（结算方向反转）；`docs/specs/credits-system-integration-flow.md`（身份穿透方案 A）
- **关联**：[ADR-0074](0074-frontend-backend-separation-nestjs-product-api.md)、[ADR-0084](0084-generation-worker-java-runtime.md)、[ADR-0021](0021-unified-rmb-billing.md)、[ADR-0083](0083-unified-error-codes-and-projection.md)、[ADR-0116](0114-java-module-aggregation-and-billing-runtime.md)、[ADR-0117](0115-table-naming-and-module-prefix.md)
- **规格**：`docs/specs/2026-09-24-用户与计费体系架构设计.md`（本文档是其决策收口）

## 背景

new-api 独立出去，从「我们的用户系统承载者」变成「上游供应商」，只给一把统一 key。

这推翻了 ADR-0062 的两条核心前提：「账户中心使用 new-api」「quota 是唯一余额真相，
Node 不创建或维护 users、user_credits、credits ledger」。new-api 独立后这两条都不再成立。

grilling 会话钉实的事实（如实记录，防止后来者误读）：

- **身份 100% 是 new-api 的投影**。`backend/libs/shared/types/authenticated-user.ts` 的
  `userId` / `username` / `email` 全字段注释写明来自 new-api；`auth.guard.ts:15-16` 用
  new-api 的 `role >= 10` 判管理员、`status == 1` 判启用。
- **计费权威不在我们这，且我们只有影子记录**。预扣有估算值（IK7G9X 接入 estimator），
  但**结算恒为 0**——全仓 grep `actualAmountFen:` 在 `persistence/` 之外零命中；
  `worker-java` 有 6 处「修正一：结算不在范围」注释。真正的扣费发生在 new-api。
- **凭证（sk-）渗透面广**。不只生成链路：`image-enhancements` / `image-cutouts` /
  `audio-trims` / `media-extract` 每类能力服务都把请求方 `sk-` 冻结进 job
  （`generation_jobs.provider_credential` 明文，`prisma/schema.prisma:103`）。
- **既有架构的拓扑没问题**。`web → backend → MQ → worker → 上游` 是对的；
  不合理的是 `account.service.ts`（169 行纯转发）与 `new-api-billing-ops.ts`（480 行）
  这两块——它们不是我们的领域，是 new-api 的远程投影。

## 决策

1. **身份自建，new-api 降级为上游供应商**。新建 `identity-svc` 承接用户、凭证、会话、
   三方登录、会员、RBAC、登录日志。new-api 与火山引擎同级——一个客户号、一把 key，
   **不再有用户概念**。删除 `account.service.ts` 全部、`new-api-billing-ops.ts` 的用户/日志/admin
   部分、`user_info` 整表、`generation_jobs.provider_credential`、`session.service.ts` 的 `sk`
   字段、`auth.guard.ts:61-77` 的 role/status 回源复核、`credential.ts` / `parseBearerToken`。

2. **计费自建，`billing-svc` 是唯一权威**。账户、账本、定价、计量全部自有。
   结算权威从 new-api 收回（反转 `cost-settlement-sync-contract.md` 的推送方向）。

3. **单币种人民币，积分 15:1**。**1 元 = 15 积分**；**账本用整数积分**，不用「分」——
   1 积分 = 100/15 ≈ 6.67 分不是整数，用「分」会使定价被迫按 300 分的倍数走。
   取消汇率（`USDExchangeRate`）、删除 `cost_reservations.exchange_rate_version`。
   new-api 的 `500000 quota = $1` 是其内部单位，**不参与我们的运行时计价**。

4. **积分按批次管理，带有效期**。`billing_credit_lots` 有 `source` / `remaining` / `frozen` /
   `expires_at`。八个 source：`register` / `daily` / `invite` / `redeem` / `purchased` / `bonus` /
   `subscription` / `gift` / `compensation`。扣减顺序：`expires_at ASC` → source 优先级 → `id ASC`。
   预扣走 `frozen`（**不直接扣 `remaining`**），**返还时原批次原封不动**。

5. **内部账本与用户可见流水分离**。`billing_ledger_entries` 复式记账、append-only、永不改，
   是权威；`billing_user_transactions` 是**可重建的投影**，**一个业务动作一行**。
   **硬规则：任何用户可见界面永远只出现一个金额**，不并列「预扣 X，实扣 Y」；
   用户端 API 不返回 `reserved_amount`。
   （new-api 把两者混在一张 log 表，所以一次消费产生 2 条记录——本决策正是为消除它。）

6. **定价是版本化的 JSON 数据，不是行表也不是代码**。`billing_pricing_catalogs` 存一份
   完整 JSON 文档，**整体发布、整体回滚**（回滚 = 把旧版本置回 `active`，一条 UPDATE）。
   运营改价 = 改 JSON + 发布，**不发版、不改表、不重启**。
   计费模型统一为 **`等效数量 × 基准单价`** 的倍率制（对齐 new-api `service/text_quota.go`）：
   **只有一个基准价，其他维度全是「相对基准的倍率」**，调价只改 `basePrice` 一处。
   一套结构覆盖图片 / 视频 / 音频 / 文本 / 按次全部形态，**没有模态特殊分支**；
   **不需要表达式引擎**（售价自定，无需复刻上游公式）。
   文本模型另有 `usageSemantic`（`openai` / `claude`）声明上游 usage 的层级包含关系——
   **不归一化会导致 cached token 被重复计费**（这是「计费准确」最关键的一条）。
   代码结构用设计模式落地：**模板方法**钉死计价骨架（`compute()` 七步，子类不可覆写）、
   **策略**承载单价形态与舍入、**责任链**承载校验、**组合**聚合折扣来源；
   扩展方式分三档——🟢 改配置 / 🔵 加新类（不改已有代码）/ 🔴 改骨架（走 ADR）。
   **折扣不进 catalog，拆成两张独立 live 表**：`billing_promotions`（营销活动，
   含模型集合 / 折扣 / 起止时间 / 启用状态 / 适用等级）与 `billing_member_discounts`（会员折扣）。
   理由：基础计价**月/季度**变一次，营销**每天**变——混在一起会让运营每建一个活动就要发一版 catalog，
   版本号爆炸、停一条活动要发整版、权限分不开。
   叠加策略 = **会员内取最优 × 营销内取最优**（活动之间**不叠加**，否则三个 7 折 = 34 折），
   再套 `floorFactorBp` 底线。折扣 live 表**不版本化**——job 提交时把命中结果**冻结进定价快照**，
   结算只复现，所以活动改折扣、停活动都不影响已提交任务。
   发布前三层校验：**JSON Schema → 轴空间完整性（从 `generation_model_capabilities` 推导，
   方向 business → billing 只读订阅）→ dry-run**；折扣另加**生效性校验**
   （整数积分下让利不足 1 积分的折扣会静默失效，挂在活动保存/启用上，草稿 WARN、启用 ERROR）。
   此条直接对着两个已发生的 bug 设计：「seedream 矩阵配一半」「sizes 小写 `1k` vs 大写 `1K` 空表」。

7. **认证放应用层，网关不做认证**。抽 `packages/auth-guard` 共享 Guard，各服务本地验签。
   nginx 只做 TLS / 路由 / `limit_req`。**明确不采用** nginx `auth_request`（每请求多一跳、
   identity 变硬单点、OPTIONS 预检被拦、WebSocket 有坑、`X-User-Id` 是伪造面、
   破坏 ADR-0083 统一错误、鉴权逻辑切两半）。开放 API 上线时再上 APISIX（`jwt-auth` +
   `key-auth` + `limit-req`）。

8. **服务划分与语言**。`identity-svc` / `business-api` 用 TypeScript（NestJS + Fastify）；
   `billing-svc` 用 Java（见 ADR-0116）。**不拆 pricing-svc**——扣费依赖定价，故障域相同，
   且定价是「数据 + 纯函数」，纯函数不需要进程。**不拆 business-api**——无独立伸缩曲线。
   契约用 Buf proto（TS 类型不再跨服务使用），OTel 统一链路，数据主权严格（禁止跨服务直连 DB，
   既有例外为 worker-java 直连 generation DB）。

9. **各场景计费口径**（详见规格 §8）：
   - **视频**：Hold → Settle 多退少补。**按成功的 slot 计费**（`partially_succeeded` 收 M 份）。
     预扣**规格确定时取精确价**，只在有不确定维度（智能时长 `duration=-1`）时取上界——
     **不照搬 new-api 的「差额常态」**（它估算是被逼的：MediaKit 入参是 URL 拿不到时长）。
     fan-out（拆镜头）由**父 job 统一 Hold 与 Settle**，子 job 只上报用量。
   - **Agent / LLM**：**不预扣，改为「会话预算熔断 + 每次调用实时扣」**，按 AgentRun 聚合成一行。
     会话级 Hold 上限通常是实际消耗的 5–10 倍，会长时间冻结用户余额。嵌套工具调用的消费归户到会话。
   - **图片 / 音频 / MediaKit**：视频的简化版，同构。MediaKit 类改为**提交时先异步探测时长**，
     探测失败才退化为估算。
   - **充值**：幂等键是 `orderNo`（不是支付网关流水号）；**只信服务端回调不信前端跳转**；
     本金与赠送**拆两个批次**（`purchased` 永久 / `bonus` 按套餐有效期），**退款只退本金**。
   - **会员**：周期发放的就是普通批次（`source=subscription`），**不做特例**；
     会员等级只影响定价折扣与并发配额。
   - **运营**：**禁止直接改批次余量**，所有积分变动必须经账本产生分录。

10. **切换必须无缝，防双重扣费**。
    - **deadline 是 new-api 独立那一天**——统一 key 到位则 sk- 链自动断，new-api 停止扣用户的钱，
      **那一刻我们必须能自己扣**。
    - 只要 `sk-` 还在，new-api 就继续扣；此时若 billing 已上线，**用户会被扣两次**。
      故 **P5（断 sk- 链）与 P6（billing 权威生效）必须同时发生，中间不能留缝**。
    - **切换前用真实任务对账**：拉上游的扣费记录，对同一个 job 用我们的 catalog 重算一遍
      （billing 的 `Quote` RPC，只算不扣），比差异。**不需要影子模式**——上游记录就是历史，
      我们的价随时可重算（目录版本化）。注意这回答的是「用户在新旧体系下各付多少」，
      是产品口径问题，不是「我们算得对不」——后者靠发布期 dry-run 与上线后的 unpriceable 指标。

11. **存量处理**。身份一次性 ETL；**密码 hash 可直接复用，存量用户无需重置密码**——
    new-api 用标准 bcrypt（`bcrypt.DefaultCost`=10，`blue-whale-api/common/crypto.go:23-32`），
    hash 格式 `$2a$10$…` 共 60 字符，现有 `password VarChar(63)` 装得下。
    **存量余额不对接，线下处理**——由此**没有余额迁移、没有双写期、没有对账差异**，
    代价是切换日需要一次线下运营动作，**必须与 P5/P6 同日执行**。

## 被否决的备选

- **保留 new-api 作为账户中心，只做一层适配**：new-api 独立后不再提供用户体系，方案不成立。
- **把 billing 做进 `worker-java` 进程**：worker 是执行面（长任务、崩溃可重启、发版频繁），
  billing 是控制面（被同步调用、强一致、不容失败）。**故障域完全不同**——
  worker 崩了不该让扣费停摆，billing 发版不该打断正在跑的视频任务。
- **拆出独立 `pricing-svc`**：扣费依赖定价，故障域相同；定价是数据 + 纯函数。拆开只在关键路径上
  多一跳 RPC 和一个故障点。用「模块边界」而非「进程边界」解决变更频率差异。
- **账单直接记「分」**：15:1 下 1 积分 = 6.67 分不整除，定价被迫按 300 分倍数走，
  无法表达「1 张图 = 2 积分」。
- **用通用规则引擎做定价**（Drools / CEL / JSONata / new-api `tiered_expr`）：
  变黑盒、无法做完整性校验、没人敢改。枚举 modifier 表达力足够。
- **nginx `auth_request` 做认证**：见决策 7 的七条问题。
- **照搬 new-api 的「预扣 = 直接扣、差额常态」**：它是被迫估算，我们的视频规格提交时已确定。
- **积分批次做物化余额表**：两处状态 → 不一致风险。余额直接从批次聚合（10 个批次内微秒级）。

## 后果

- **正向**：身份与计费进入自己的领域，new-api 降级为纯供应商；多货币/汇率复杂度全部消除；
  用户流水从 2 条变 1 条；定价变更可版本化、可审计、可回滚；切换期零余额迁移风险。

- **成本**：`identity-svc` + `billing-svc` 两个新服务（约 6.5 人周 + 运营面 1.5 周）；
  **新增一个 Java 产品运行时**（见 ADR-0116，需修订 CLAUDE.md 红线 #10）；
  `packages/contracts` 从 TS 类型迁移到 Buf proto；`.claude/` 与 `CONTEXT.md` 规则源同步修订。

- **风险**（均已登记，本 ADR 不解决）：
  1. **切换期双重扣费**——靠 P5/P6 同时执行缓解（中间态不存在），但这是运营动作，有执行风险。
  2. **初始定价漏配**——切换前必须配好全矩阵，漏配 = 提交时算不出价被拒。dry-run 兜底。
  3. **上游账单粒度不足**——若 new-api 只给日/总额，按用户归因失去上游校验，
     只能靠自己上报的 usage。**必须记 `upstream_request_id`**，否则连抽样核查都做不到。
  4. **worker-java 直连 DB**——改表名要改 Java SQL（已核实只涉及 10 张表）。
  5. **new-api 密码算法若变**——本决策基于当前 bcrypt 实现；若上游改算法，ETL 需重估。
  6. **billing 用 Java** 依赖 ADR-0116 的红线修订获批。

- **成立前提**：本决策的收益取决于「new-api 确实只给统一 key、不再提供用户体系」。
  若上游最终仍开放用户级能力，应重开本 ADR 而非默认延续。
