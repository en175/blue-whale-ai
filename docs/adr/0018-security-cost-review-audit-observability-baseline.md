# ADR-0018：安全、成本、内容审核与可观测性基线

- **状态**：Accepted
- **IK3UUX 范围状态**：Limited — 保留当前核心流程直接需要的认证、Project/Asset 隔离、内容审核与
  成本硬限制；生产 SLO、完整告警/可观测性、长期审计与灾备验收留待上线准备，见
  [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。
- **身份部分取代**：手机号、refresh、Java Product API 与 Java JWT 身份方案由
  [ADR-0062](0062-new-api-account-center-and-quota-billing.md) 取代；本 ADR 的服务端认证上下文、
  对象级授权、审核、成本与审计原则继续有效。
- **日期**：2026-07-14

## 背景

ADR-0015 已确定 Java Product API 是唯一公开产品控制面，Python Agent Worker 与 Java
Generation Worker 只通过产品中性的窄接口执行工作；ADR-0016、ADR-0017 已冻结公开 API、
可重放事件流、持久化、幂等与恢复语义。进入后端实施规划前，还必须回答身份与对象隔离、内容
审核、Agent 工具授权、密钥、成本硬边界、审计、可观测性、错误契约和首版 SLO 如何共同构成
可验证的生产基线。

当前仓库已有手机号验证码登录、Token 刷新与退出能力，首次成功登录会创建 User；但部分 Agent
与 Asset 接口仍信任客户端传入的 `X-User-Id`，对象访问和预签名也未形成真实安全边界。本 ADR
冻结目标架构的产品权威和默认阈值，不把现状接口视为已满足要求，也不在本票实现后端功能或选择
具体基础设施厂商。

## 决策

### 1. 所有产品能力以已认证 User 为入口

首版不提供匿名或访客模式。首次手机号验证码登录同时完成注册；除注册、登录和刷新 Token 所需的
认证入口外，所有产品 API 都要求有效 Access Token，并从服务端认证上下文取得 User 身份。客户端
传入的 `userId`、`X-User-Id` 或浏览器本地标识不构成身份或授权依据，应从受保护接口契约中移除。

每次资源操作都必须沿 `User → Project → 目标资源` 做对象级授权。无权访问与资源不存在对外统一
返回 `404 RESOURCE_NOT_FOUND`，避免泄露对象是否存在。身份认证、对象授权和下述安全决定均由
Java Product API 控制，Worker、模型和前端不能绕过。

### 2. Asset 永久私有，临时 URL 只授予受限传输能力

对象存储中的 Asset 永久私有，数据库只保存不可变对象键和元数据，不保存临时 URL。签发上传或
下载 URL 前，服务端必须再次确认当前 User 对所属 Project 与 Asset 的权限。

- 上传 URL 有效期为 10 分钟，并绑定 HTTP 方法、目标对象键、内容类型、大小上限和内容校验和；
- 下载 URL 有效期为 5 分钟，只授权读取已确认归属的对象；
- URL 在有效期内属于可转交的 Bearer Capability，因此不得进入日志、Trace、错误、事件或审计；
- 签发权限只决定能否取得 URL，Asset 身份、归属和生命周期仍以产品数据库为权威。

### 3. 输入与输出都必须经过产品权威的 ContentReview

> **部分取代**：ADR-0023 取消了 AgentChatPanel 用户消息和 BottomDock 文字提示词的独立前置
> ContentReview；上传素材与所有输出仍适用本节，直到后续 ADR 明确调整。

用户提示词与上传素材在进入 Agent 或供应商前审核；模型文字与生成媒体在向 User 展示、下载或
作为后续输入前审核。只有产品控制面接纳的明确通过决定才能继续。拒绝、超时、审核服务不可用或
结果无法验证时一律 fail closed。

供应商自带审核可作为决定证据，但不能直接成为产品权威。审核记录保存内容摘要、模态、规则与
模型版本、供应商证据引用、决定、原因码和时间，不保存不必要的原始内容。已经通过并接纳的历史
Asset 不因审核服务短时不可用而失效；新内容及产生新派生内容的操作仍须按当时策略审核。

### 4. 模型只提议动作，确定性控制面授权副作用

Agent 只能输出符合版本化 schema 的 AgentActionProposal，不能直接调用工具或取得授权。Java
Product API 在产生任何副作用前，确定性校验已认证 User、Project、AgentRun、工具 allowlist、
参数 schema、资源归属、幂等身份、成本额度，以及需要时仍有效且匹配的 UserInputRequest。

用户素材、网页、提示词、模型回复和工具输出全部视为不可信数据，其中的文字不能授予权限、扩大
工具范围或覆盖系统策略。密钥不得进入模型上下文；工具只取得执行当前动作所需的最小权限和最短
生命周期凭据。任何校验缺失、歧义或策略服务不可用都不得执行副作用。

### 5. 生产密钥由专用 Secret Manager 管理

生产环境密钥不得保存在源码、镜像、数据库、普通配置、提示词、日志、Trace、错误、事件或审计
中。运行负载优先使用工作负载身份和动态短期凭据；无法动态化的密钥按环境、运行时和供应商拆分，
遵循最小权限，并具备轮换、撤销和访问审计。必需密钥缺失时服务启动失败，不带缺省密钥降级运行。

本地开发可以使用被版本控制忽略的环境文件。具体 Secret Manager 产品留待基础设施选型，但候选
产品必须满足身份集成、版本化、自动轮换、撤销和审计能力。

### 6. 付费副作用先做最坏情况 CostReservation

每次可能计费的供应商调用前，产品控制面按版本化价格目录、最坏可选参数和保守人民币换算预留
额度；取得可证明的实际成本后结算并释放差额。结果不明时预留保持占用，直到对账证明实际成本或
按人工处置关闭。重试只要可能产生新费用，就必须建立新的预留。

默认成本策略如下：

- 单次动作预估成本不超过 ¥2 可直接执行；大于 ¥2 且不超过 ¥20 必须经自然语言确认；
- 单次动作硬上限 ¥20，单 Project 滚动 24 小时 ¥50，单 User 滚动 24 小时 ¥100、滚动 30 天
  ¥500；用户确认不能突破任何硬额度；
- 全局预算和按供应商预算必须显式配置且不得留空；额度使用达到 70%、85%、100% 时分别告警；
- 价格目录保留供应商原始币种、计价单位、生效时间和来源版本，并使用保守的版本化人民币汇率；
- 供应商成本未知、参数为 `auto` 或区间不确定时按可达最坏值预留，无法建立上界则拒绝调用。

CostReservation 与实际结算只用于运营限额、防滥用和对账，不是账单、扣款、发票或财务计费事实。

### 7. AuditRecord 是独立、不可变的安全证据

AuditRecord 采用 append-only、不可变存储，与产品事件和普通运行日志分离。每条记录至少包含主体、
目标、动作、允许或拒绝决定及原因、策略与价格版本、`request_id`、`correlation_id`、`trace_id`、
产品时间和运行环境。认证与注册、对象授权和临时 URL、ContentReview、动作与工具副作用、
UserInputRequest、成本预留与结算、Job 取消/重试/异常终态、管理与导出、密钥操作，以及审计自身的
读取和导出都必须留痕。

审计不得包含原始提示词、媒体、模型推理、原始工具输出、手机号、Token、密钥、临时 URL 或供应商
原始响应。AuditRecord 默认保留 365 天，普通运行日志默认保留 30 天；法律保全策略可以延长但不能
静默缩短。审计读取仅授予专门角色，并对读取和导出行为再次审计。

身份、权限、临时 URL、审核通过、动作与工具、Job 创建/取消/重试、成本、管理/导出/密钥等安全
关键写操作必须与审计证据同成败：审计写入不可用时阻止新操作。已经启动的 Worker 可在业务结果
提交事务中把原始时间戳和审计载荷写入可靠本地表或 Outbox，随后重放；缓冲必须有容量上限、受保护
且接近满载时停止接纳新的副作用。已有元数据、Snapshot 与事件重放等只读能力可继续。

Metrics、Trace 或普通日志不可用不阻塞业务，但必须暴露丢弃量、缓冲压力并立即告警；它们不能替代
安全关键审计。

### 8. 使用供应商中立的 OpenTelemetry 观测链路

Java Product API、Python Agent Worker 和 Java Generation Worker 都接入 OpenTelemetry SDK，
通过 OTLP Collector 输出 Trace、Metrics 和 Logs。HTTP、队列、Outbox、Callback Inbox 与 Worker
任务统一传播 W3C Trace Context。

`request_id` 标识一次公开 API 请求，`trace_id` 标识一次技术调用链，`correlation_id` 标识跨多个
请求、Run 和 Job 的产品流程。供应商回调先校验身份，再以 GenerationJob 为关联创建新 Span Link；
外部回调携带的上下文不能作为可信父 Span。

正常流量默认采样 10%；错误、慢请求、认证或授权拒绝、审核拒绝/不可用、成本拒绝、重试耗尽与
恢复动作保留 100%。Trace 默认保留 7 天、运行日志 30 天、Metrics 90 天、AuditRecord 365 天。
观测数据和 Baggage 不得携带原始提示词、媒体、手机号、Token、密钥、临时 URL、供应商原始响应或
模型推理。

首版至少覆盖：

- API 的 RED 指标、认证与对象授权拒绝；
- 队列、Outbox、Inbox、租约、Reconciler 的积压、年龄、失败和恢复；
- AgentRun、GenerationJob、供应商调用及按模型/分辨率分组的耗时与终态；
- ContentReview 的模态、决定、不可用与耗时；
- 工具授权、成本预留/结算/额度使用，以及审计和遥测写入健康度。

Metrics 标签不得包含 User、Project、Asset、AgentRun、GenerationJob 等高基数身份；需要定位单个
流程时使用受访问控制的日志、Trace 和 AuditRecord。

### 9. 所有失败使用统一、安全且可对账的错误契约

公开 API、Job 结果和 SSE 错误统一为：

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "当前操作超过可用额度。",
    "retryable": false,
    "retry_after_seconds": null,
    "request_id": "req_...",
    "input_request_id": null,
    "budget_effect": "reservation_released"
  }
}
```

`budget_effect` 只能是 `none`、`reserved`、`reservation_released`、`actual_settled` 或
`pending_reconciliation`。首版稳定错误码至少包含：

- `AUTHENTICATION_REQUIRED`、`RESOURCE_NOT_FOUND`、`VALIDATION_FAILED`；
- `CONTENT_REJECTED`、`CONTENT_REVIEW_UNAVAILABLE`、`ACTION_NOT_ALLOWED`、`INPUT_REQUIRED`；
- `QUOTA_EXCEEDED`、`RATE_LIMITED`、`STALE_VERSION`、`CURSOR_EXPIRED`；
- `PROVIDER_TEMPORARILY_UNAVAILABLE`、`GENERATION_FAILED`、`INTERNAL_ERROR`。

`429` 与 `503` 可以给出 `retry_after_seconds`。多输出生成按输出槽位表达部分成功，不能把已经接纳的
Asset 隐藏在单一失败中。未知异常统一返回 `500 INTERNAL_ERROR`，不暴露堆栈、内部类名、供应商
原始错误或敏感配置。

### 10. 首版采用可兑现的单区域 SLO

注册/登录、Project Snapshot 与公开命令接纳的月度可用性目标均为 99.5%。延迟目标为：公开 API
P95 不超过 500ms，Snapshot P95 不超过 1s，产品事实提交到 SSE 可见 P95 不超过 2s，Outbox
交付 P95 不超过 5s，Worker 领取 P95 不超过 10s，Reconciler 在 5 分钟内发现卡住记录，审计写入
P95 不超过 200ms。

ContentReview 按文字、图片和视频分别统计可用性与延迟。供应商生成耗时不计入 Blue-Whale API
可用性 SLO，但必须按供应商、模型和分辨率记录 P50、P95、超时与失败率。SLO 使用滚动 30 天窗口；
只有在容量测试、故障演练和恢复数据证明可以兑现后，才讨论提高到 99.9%。

以下情况必须告警：审计写入失败；API 5xx 在 5 分钟内超过 5%；Outbox 年龄超过 30 秒；最老队列
任务超过 60 秒；ContentReview 不可用率在 5 分钟内超过 1%；供应商失败率在 10 分钟内超过 20%；
成本达到 70%/85%/100%；遥测丢弃或缓冲逼近容量；认证拒绝异常升高；密钥异常访问；审计完整性
校验失败。

## Considered Options

- 拒绝匿名 User 或客户端自报 User ID：这会使对象级授权无法建立可信主体，并直接产生 BOLA 风险。
- 拒绝公开对象桶或长期 URL：URL 泄漏会绕过产品归属检查，也无法按 User 权限撤销后续签发。
- 拒绝只审核输入或只依赖供应商审核：Agent 和生成供应商都可能产生新的违规输出，产品必须保留
  最终决定权。
- 拒绝让模型直接执行工具：提示注入可以把不可信内容转化为权限，副作用必须经过确定性控制面。
- 拒绝调用后再统计成本：异步、自动重试和结果不明都可能在发现超额前继续付费。
- 拒绝把 AuditRecord 混入产品事件或普通日志：三者的读取权限、完整性、内容最小化和保留周期
  不同。
- 拒绝首版承诺 99.9%：单区域架构尚无容量与演练证据，99.5% 才是可以衡量并逐步提高的目标。

## Consequences

- 现有 `X-User-Id` 接口、对象存储 stub 和匿名假设只作为迁移基线，后续实现必须统一接入服务端
  Token 身份、对象授权和私有 Asset 签发边界。
- Java Product API 新增 ContentReview、AgentActionProposal 授权、CostReservation 和
  AuditRecord 的权威接纳职责；Worker 只能提交证据和候选结果。
- 安全关键写操作在审计不可用时降低可用性，这是有意的 fail-closed 取舍；普通遥测故障则以告警
  和受限缓冲降级。
- 成本阈值、价格目录、汇率、审核策略、工具 schema 和错误码都需要版本化，以便 Job 恢复、对账
  和审计能解释当时决定。
- 本 ADR 冻结语义、默认阈值和验收口径；具体表结构、组件产品和部署拓扑仍需在实施票中确定。

## 不包含

- 重建账户、登录与认证中台；首版复用现有手机号验证码首次登录即注册的能力；
- 充值、扣款、订单、账单、发票、会计核算或完整计费中台；
- Secret Manager、内容审核供应商、对象存储、OpenTelemetry 后端或告警平台的具体产品选型；
- 多区域容灾、99.9% SLO、法务保全流程和审计外部认证；
- 数据库表结构、迁移脚本、控制器、Worker、前端或基础设施实现。

## 参考资料

- [OWASP API Security Top 10 — Broken Object Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)
- [Amazon S3 — Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [OWASP — Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [OWASP — AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
- [OWASP — Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [OWASP API Security Top 10 — Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)
- [OpenAI API Pricing](https://developers.openai.com/api/docs/pricing)
- [OpenAI — Image generation](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenTelemetry — Signals](https://opentelemetry.io/docs/concepts/signals/)
- [OpenTelemetry — Metrics and high-cardinality dimensions](https://opentelemetry.io/docs/concepts/signals/metrics/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [OWASP — Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [OWASP — REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [OWASP — Error Handling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html)
