# ADR-0114：new-api 转为上游供应商 —— 自建用户体系与计费体系（微服务）

- **状态**：Accepted
- **日期**：2026-09-24
- **决策者**：lixq
- **取代**：[ADR-0062](0062-new-api-account-center-and-quota-billing.md) 中「new-api 是我们的账户中心」的全部条款（new-api 不再是用户体系提供方，也不再是计费权威）。ADR-0062 关于**凭证分层**（HttpOnly 会话 cookie + BFF 回注，浏览器不碰上游 key）的条款继续有效。
- **修订**：[CLAUDE.md](../../CLAUDE.md) 红线 #10「产品实现技术栈」——为 billing-svc 增加 Java 例外（见决策 6）
- **关联**：[ADR-0021](0021-unified-rmb-billing.md)、[ADR-0074](0074-frontend-backend-separation-nestjs-product-api.md)、[ADR-0084](0084-generation-worker-java-runtime.md)（Java 运行时先例与治理形态）

## 背景

new-api 从「我们的用户体系 + 计费平台」变成「带一把统一调用 key 的上游模型供应商」。这个切换由**外部事件**驱动，不由我们排期：new-api 独立那天，它那边的用户表与 quota 就都不再是我们的。

于是出现两个必须在切换日之前解决的硬目标：

1. **不能白嫖** —— new-api 停止替我们扣费的那天，我们必须能自己扣。这是**外部事件**，不是可以推迟的内部优化。
2. **用户不能丢** —— 能自己登录、自己管权限。

现状盘点（切换前的耦合）：

- 登录、注册、改密、会话里的执行凭证，全部经 `AccountService` 转发到 new-api。
- 会话存的是**该用户自己的 `sk-`**，Guard 每请求回注给下游代打 new-api。**一用户一把 key。**
- 余额、消费流水、充值记录读的都是 new-api 的 quota。
- 管理端的「管理员」有两个概念：进不进得了后台看 new-api 的 role，我们的角色表只管别处。

## 决策

### 1. new-api 降级为上游供应商，凭证从「每用户一把」变成「项目一把」

统一 key 由部署注入（`NEW_API_UPSTREAM_KEY`）。它的性质随之改变：不再是「某个人登录的产物」，而是**部署配置**，与 `NEW_API_BASE_URL` 同级。

⚠️ **过渡期的已知后果**：new-api 的 per-user 数据（消费流水、充值记录）从此返回**项目维度**的数。这不是 bug，是「上游不再认识我们的用户」的必然结果——也正是必须自建计费的原因。计费域接过来之前，那些接口的数值没有意义。

### 2. 自建用户体系：账号主体在我们自己的库

- 账号主体 = `identity_users`（由老的 `users` 改名 + 加唯一索引而来），`username` 与 `email` 都是登录凭据且**都唯一**（邮箱不唯一会让「用邮箱登录」命中任意一行，等于能用别人的邮箱登进来）。
- 口令 = **bcrypt cost 10**，与 new-api 的 Go 实现（`golang.org/x/crypto/bcrypt`）同档，这样存量的 `$2a$10$...` 哈希**直接可校验，不需要重算**。
- 角色 = **集合**（`identity_roles` / `identity_user_roles`），不是数值阈值。「是不是管理员」是集合成员问题，见 `libs/core/identity/roles.ts`。
- 登录与注册**必须同时切**：只切登录不切注册，会让新用户注册进 new-api 而登录查我们的库——**注册完立刻登不上**，报的还是「用户名或密码错误」。

### 3. 自建计费体系：批次积分 + 复式账本，独立进程与独立库

账本单位 = **整数积分**（不是 mc，也不是 new-api 的 quota）。恒等式 `wallet + frozen == Σ lots.remaining` 是核心不变式。

三条语义由设计冻结：

- **预扣 / 结算 / 返还**：提交时冻结（`frozen`）而非直接扣；终态由 MQ 事件驱动结算或全额返还。
- **结算按冻结的版本 + 冻结的折扣复现**，不按当前目录。否则「提交时看到 7 折、结算按原价扣」。
- **结算/返还走 MQ 不走 RPC**：它们不该阻塞任何用户请求，且必须能重投。只有 Hold 在用户等待路径上。

### 4. 服务边界（最终形态：微服务）

| 服务 | 运行时 | 职责 |
| --- | --- | --- |
| `identity-svc` | TypeScript (NestJS) | 会话校验（`VerifySession`）、角色/等级、登录留痕 |
| `business-api` | TypeScript (NestJS) | 浏览器业务 API；Guard 调 `VerifySession`；提交时调 billing 的 Hold |
| `billing-svc` | **Java (Spring Boot)** | 权威计价 + 账本；RPC 面只有 Hold / QueryBalance / ListTransactions |
| `worker-java` | Java (Spring Boot) | 生成执行；终态发 MQ 事件解冻预扣 |

跨进程契约以 **Buf proto** 为语言中立的单一事实来源（`contracts/proto/`）。Java 用 protobuf-maven-plugin，TS 用 protobuf-es v2。

### 5. 切换顺序（不可颠倒）

1. 契约冻结 → 2. billing-svc 上线（**`BILLING_ENFORCE_HOLD=false`，只接路径不扣钱**）→ 3. 登录/注册切本地 → 4. 影子对账 → 5. **断 sk- 链与打开 `BILLING_ENFORCE_HOLD` 必须同一发布窗口**。

第 2 步的开关默认 `false` 只有一条理由：切换前 billing 一旦真扣，new-api 那边还在扣，**用户被扣两遍**。

### 6. 红线 #10 修订：billing-svc 是 Java 例外

红线 #10 原文要求「其余服务端与 Worker 进程使用 Node.js LTS」。billing-svc 取 Java，理由与 ADR-0084 同源且**不是技术优势**：团队母语是 Java，而账本是**钱路径**——它必须能被逐行 review。一个「编译过、测试绿、但某天少扣了一笔」的账本比不能 review 的账本危险得多。

约束（与 ADR-0084 决策 2 同款的防漂移条款）：

- billing-svc 与 `worker-java/` **不共享进程、不共享库**，只经 **DB + MQ + proto 契约**交互。
- 计价规则**不在 Java 里硬编码**，全部来自 pricing catalog 配置；Java 侧只实现「怎么算」，不实现「算什么价」。
- 金标套件对账：计价与账本行为先以 TS characterization 测试固化，Java 侧以同一批用例验收。

> ⚠️ 红线 #10 与 `CONTEXT.md` 的文本修订是**规则源改动**，走分支 → PR，不在本 ADR 落地。

### 7. new-api 只有一个出口

降级为上游供应商之后，new-api 的每一处出站都必须经过**同一个模块**
（`backend/libs/shared/upstream/new-api-egress.ts`），它管三件事：base URL 解析
（未配置即抛，不返回空串）、路径拼接、`X-Trace-Id` 统一补。

**触发**：收敛之前 `NEW_API_BASE_URL` 被**六处各读各的**（ops 客户端、文生文、
素材库、cost-estimator、agent 模型网关、skill-format）。于是「new-api 到底从哪进来」
没有答案，只有六份各自的回答：拼接方式、trace 头、缺失时的行为各不相同，改一处不影响
另一处，出问题要逐个排查。两个 chat 控制器还都是**裸 `fetch`**，连 ops 客户端都不走——
它们看起来像两件事，正是因为它们是两套各写各的。

**刻意不管两件事**，因为它们本来就不是重复的：

- **鉴权**：new-api 有两套并存的模型——用户面的项目统一 key、Agent 计费面的服务令牌
  （`bwsvc_` 前缀）+ 计费主体头。塞进出口就得让出口分辨「这次是哪种调用」，
  那只是把分支换个地方。
- **超时**：文生文按总时长、Agent 网关按**空闲**时长。两者对「上游卡住」的定义本来就
  不同（Agent 那边的理由见其注释：按总时长会误杀跑到 155 秒的正常调用）。

### 8. 上游调用面的边界

按「只有 worker 与素材库能调 new-api」这条规则，`backend` 里剩下的模型调用
（`/api/text/completions` 文生文、`/api/internal/agent-model/*` Agent 模型网关）
**保留在 business-api**。理由：`worker-java` 是 MQ 驱动的**异步作业执行器**
（claim / 租约 / fencing / 终态写库 / 预扣-结算生命周期全围着一行 `generation_jobs`），
而这两条是**同步流式**请求，没有 job 行。硬搬进去不是搬移，是塞一个异物；
真要剥离，落点是单独一个 model-gateway 服务。

## 被否决的方案

- **继续转发 new-api**：它独立那天所有人一起登不上，且我们无法自己扣费。这不是取舍，是把风险留给一个不由我们决定的日子。
- **把 new-api 的用户表 ETL 进来后仍用它的 quota 当账本**：等于把「计费权威」留在一个即将与我们无关的系统上；它哪天清了 quota，我们的账就没了。
- **billing 用 TypeScript 与 backend 同进程**：钱路径需要独立进程 + 独立库——同进程意味着一次 OOM / 一次错配的迁移能同时带走业务与账本。这条由决策者显式纠正过（初版方案是 backend 内的一个模块）。
- **影子模式（双写对账表）**：需要额外的 `billing_shadow_entries` 表与开关，而「对比上游扣费记录」用 `/api/log/self` 直接查即可，不必在库里再养一份副本。已整刀回滚。
- **登录保留 new-api 转发、只切计费**：用户体系是「用户不能丢」那条硬目标本身，砍掉它等于只完成一半。

## 后果

- 正向：两个硬目标都可在切换日自动达成；new-api 的独立时间点从「我们的风险」变成「我们的事件」。
- 成本：一次跨越 TS/Java 两栈、四个服务的迁移；契约先行带来的前期冻结成本；过渡期 per-user 数据不可用的产品缺口。
- 已知风险（本 ADR 不解决，均已登记）：
  1. **存量管理员角色 ETL 未做** —— new-api 的 admin 迁到 `identity_user_roles` 的步骤还没写进 runbook，漏做会导致切换后无人能进管理端。
  2. **worker 侧 usage 上报为空** —— 目前终态事件带空用量，billing 按预扣额结算；对 `partially_succeeded` 而言这条兜底偏平台（billing 侧打 WARN，见 `SettlementService`）。
  3. **`identity-svc` 尚未独立成进程** —— 当前身份逻辑仍在 `business-api` 内（`libs/shared/identity`），契约里的 `VerifySession` RPC 面已定义但未接线。
  4. **取消（cancelled）状态的返还路径** 目前依赖终态统一出口，尚未覆盖「claim 前取消」这类不走 JobFinalizer 的路径。
  5. ~~`creditsPerYuan` 未定档~~ —— **已定档（2026-09-25）**：值 = **15**，且留在定价目录
     `billing_pricing_catalogs.document` 里（版本化、随 job 冻结、管理端可查），**不进**
     独立的 key-value 配置表——那样会脱离版本冻结，改一次数就说不清已提交未结算的任务按哪个算。
     该字段此前声明了却从未被读取（真正的换算在 `RoundingPolicy` 里写死 1000mc=1积分），
     现已加编译期校验与管理端回显。`docs/specs/billing-units-contract.md` 的同批修订已完成。
  6. **设计文档不在仓内** —— 代码注释引用的《计费逻辑详细设计》《迁移与切换 runbook》没有进仓（本仓只有 `docs/specs/billing-units-contract.md`）。要么把它们落进来，要么把注释改成自包含的说明。
  8. **契约与实现不符（已确认，未修）** —— `HoldRequest` 的注释写着「`command_id` 是客户端生成的
     幂等键，**设计意图就是 Hold 能发生在写 job 之前**」，但 billing 侧落不了地：`HoldCommand`
     硬校验 `jobId > 0`，预留唯一键建在 `generation_job_id` 上，`settle`/`refund` 都按 job_id 找预留。
     所以「预扣在写 job 之前」这条路走不通，回滚只能靠**补偿**（已实现）。要真正落地那条设计，
     得先让预留不依赖 job_id —— 那是一次跨服务的改动。
  9. **建任务路径没有幂等表** —— 同一 `Idempotency-Key` 重复提交会产生**两个 job、两笔冻结**
     （净额由补偿保证正确）。要真正做到「同一个 key 只冻一次」，前提是建任务路径自己也有幂等表
     并复用同一个 job 行（job_id 不变才谈得上 billing 重放）。
  7. **TS 侧的账单面与充值面已切断（2026-09-25）**：用户身份面更早删除；**余额**改问 billing
     `QueryBalance`，**消费流水**改问 `ListTransactions`，**管理端 dashboard / orders** 改读我们自己
     的库；充值面曾**整条删除**（本仓当时没有支付通道）。
     **2026-09-25 补记**：充值已接回，走 **BlueWhalePay 的杭州银行（hccb）主扫渠道**，
     不再经由 new-api。商户配置分两层——我们配 pay 的地址与商户号/应用密钥/回调地址
     （`system_settings`，AES-256-GCM 加密）；pay 那边配渠道与路由（住它们库里，不重复配）。
     到账积分 = `原价 × creditsPerYuan`，读 billing 定价目录。
     剩下的 new-api 调用只有**上游本职**：text-completions / agent 模型网关 / 素材（真人人像库）/
     技能格式化 / 定价目录。
     ⚠️ 若严格执行「只有 worker 与素材库能调 new-api」，这几类都要另作安排——需要一个明确决定。
- 成立前提：切换顺序不可颠倒。**先打开真扣、后断 sk- 链** = 用户被扣两遍；**先断链、后接好计费** = 白嫖。
