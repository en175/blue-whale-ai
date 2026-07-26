# ADR-0052：跨进程契约、行为规范与不可绕过发布链

- **状态**：Accepted
- **日期**：2026-07-26
- **决策者**：KimJohn
- **关联工单**：[确定跨进程 TypeScript 契约与版本策略](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3UWG)
- **关联决策**：[ADR-0016 Project 公开 API 与可重放产品事件流](0016-project-api-and-replayable-event-stream.md)、[ADR-0050 无状态 AgentAdvance](0050-stateless-agent-advance-and-invocation-boundary.md)、[ADR-0051 Generation Worker 恢复边界](0051-node-generation-worker-execution-and-recovery-boundary.md)

## 背景

Node Product API、Agent Worker、Generation Worker、Payment Gateway、Web 与 Go 支付边界需要共享可验证的
wire contract，但不能共享框架私有类型或把 TypeBox、Fastify、Ajv 的实现细节变成长期协议。Schema 只能
描述机器可执行的形状和接口元数据，不能完整表达状态机、事务、授权、重试、核对和副作用顺序；若只比较
Schema，又会漏掉不改字段但改变产品行为的破坏性变更。

因此采用：

> TypeBox 与结构化接口描述作为 wire shape 和机器可执行接口元数据的唯一编辑源，发布中立标准制品；
> 版本化行为规范约束可观察语义；四个契约族独立版本化；Manifest、兼容证明和三层发布门禁共同保证
> 契约检查不可绕过，同时保留未来替换 TypeBox 的能力。

## 决策

### 1. 四个独立契约族

只建立以下四个契约族，各自拥有独立 SemVer、稳定 Schema 标识和责任人：

1. `public-api`：Web 与 Product API 的公开 HTTP、Snapshot 和 SSE 产品事件。
2. `agent-work`：Product API 与 Agent Worker 的工作领取、RunCommit、调用证据和恢复合同。
3. `generation-work`：Product API 与 Generation Worker 的工作领取、供应商观察、候选交付和恢复合同。
4. `payment-control`：Go 与 Node Payment Gateway 的私有支付控制合同。

契约族负责人对发布负责；任何兼容性判断必须由负责人和受影响消费者共同记录。应用版本与合同版本分离：
实现修复若只是恢复对既有合同的遵守，只升级应用版本并增加回归测试；只有 wire shape、行为规范或可观察
语义发生变化时才升级合同版本。

### 2. 唯一编辑源与中立发布制品

每个 operation 或 event 的 Contract Definition Source 由以下内容组成：

- TypeBox Schema；
- 结构化接口元数据，包括 operation/event 标识、HTTP 方法与路径、成功状态、错误类型、幂等身份、
  feature gate、consumer 与 safe no-op 声明；
- 对版本化行为规范稳定标识的引用。

TypeBox 只负责 wire shape 和可机器执行的接口元数据，不承载状态机、事务、领域授权、重试、恢复、核对、
支付事务或副作用顺序。生成的 JSON Schema、OpenAPI、事件描述、DTO、validator、serializer、传输外壳、
SSE decoder、fixtures 和文档字段不得再由第二份手写 DTO 或 Schema 定义。TypeBox/Fastify 私有类型不得跨包
导出。

发布权威是由该编辑源确定性生成的中立制品，而不是 TypeBox AST。首版固定生成：

- JSON Schema Draft 2020-12，显式声明 `$schema`，稳定 `$id` 至少包含契约族、Schema 和 major；
- HTTP 使用 OpenAPI 3.1.2；
- SSE 使用版本化 event manifest，不引入 AsyncAPI；
- 跨语言 fixtures、行为场景索引和 Contract Manifest。

只允许可移植的标准 JSON Schema 表达；禁止 JavaScript 私有类型、自定义运行时语义、隐式默认值、类型强制
或输入变异。图片和视频字节继续走对象存储，控制信息使用 HTTPS + JSON，实时产品事件使用 SSE。第三方
协议由 Adapter 隔离；只有真实性能数据证明 JSON 不满足要求时，才重新评估二进制协议。

### 3. OpenAPI、Fastify/Ajv 与 Draft 2020-12 兼容边界

兼容性核验结论如下：

- [OpenAPI 3.1.2](https://spec.openapis.org/oas/v3.1.2.html#schema-object) 的 Schema Object 是 JSON
  Schema Draft 2020-12 的超集，并继承 Draft 2020-12 的解析要求；因此发布 OpenAPI 3.1.2 与中立
  Draft 2020-12 Schema 对齐。
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12) 改变了 tuple、动态引用与 vocabulary；
  每份根 Schema 必须显式声明 dialect，CI 必须用官方 meta-schema 和测试 fixtures 校验。
- [Fastify 的验证与序列化文档](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) 说明
  请求验证使用 Ajv v8，但示例仍使用 Draft 7；默认 Ajv 基线还启用 `coerceTypes`、`useDefaults` 和
  `removeAdditional`。该默认链路不符合本 ADR 的严格、无变异输入要求。
- [Ajv 的 JSON Schema 文档](https://ajv.js.org/json-schema.html#draft-2020-12-breaking) 明确支持 Draft
  2020-12，但必须使用 2020-12 专用 export，并且同一 Ajv 实例不能混用 Draft 2020-12 与旧 draft。

因此 Fastify 不能直接沿用默认 validator compiler。每个服务必须使用固定版本的独立 Ajv 2020-12 实例和
自定义 validator compiler，关闭 `coerceTypes`、`useDefaults`、`removeAdditional`，显式配置并测试需要
assert 的 `format`。旧 draft 若在迁移工具中仍需读取，必须使用隔离进程或隔离 Ajv 实例，不能进入生产
请求校验器。

Fastify 默认响应序列化由 fast-json-stringify 处理，不能据此假设所有 Draft 2020-12 keyword 均可直接
执行。生成链必须为运行时 serializer 生成经 fixtures 证明等价的受限投影，或使用经验证的自定义
serializer；任何 keyword、引用、format 或 closed-object 语义无法证明等价时，构建失败。OpenAPI
生成器、Ajv、format 插件、serializer 和 TypeBox 均固定版本，并在升级时重新运行完整跨语言 fixtures。

### 4. 严格写入、宽容读取与安全停止

- 内部请求、命令和标准化回调使用 closed object；未知字段、未知判别值和未登记扩展一律拒绝。
- 第三方原始通知先按渠道规则验签和防重放，允许额外字段；Adapter 随后只输出严格内部合同。
- 响应和已知事件允许消费者忽略未知可选字段，但生产者仍使用 closed schema，防止内部数据泄漏。
- 未知错误、事件、状态或枚举不得猜测、静默降级或回退旧版本；必须安全停止、记录最小证据并告警。
- 新请求字段遵循“先升级接收方，再启用发送方”；发送开关默认关闭并可独立撤销。

### 5. 单向、确定性的代码生成

代码生成是不可逆的单向链：

```text
TypeBox + structured metadata + behavioral spec refs
  -> JSON Schema / OpenAPI / event manifest / fixtures / Contract Manifest
  -> TypeScript DTO、validator、serializer、HTTP transport shell、SSE decoder
  -> payment-control Go DTO 与薄 transport interface
```

只生成 DTO、校验、序列化、HTTP 传输外壳和 SSE event decoder。认证、HMAC、领域幂等身份、重试、恢复、
核对、支付事务、状态机和领域判断全部手写。生成器及依赖固定版本，输出必须确定性；合同源与生成物原子
提交。CI 使用跨语言正反 fixtures、字节级重生成和中立发布物 diff 阻止漂移，生成文件禁止手工编辑。

### 6. JSON 标量与序列化档案

- wire 字段统一 `snake_case`。领域 ID 是按各自类型约束的不透明字符串；只有数字来源 ID、序列号、
  cursor、aggregate version 和 fencing token 使用十进制字符串。
- 金额使用 `{currency, minor_units}`，currency 为大写 ISO 4217，minor_units 为十进制整数字符串；quota、
  成本和用量必须声明单位与精度，禁止浮点金额、quota 或成本。
- 可选字段默认缺省；只有明确业务空状态才使用 `null`。有限且跨语言安全的普通数值才使用 JSON number，
  禁止 NaN、Infinity 和负零。
- 时间统一为 UTC RFC 3339、固定毫秒精度；deadline 使用绝对时间。摘要使用 `sha256:<lowercase-hex>`。
- 大文件只通过稳定对象引用、媒体类型、大小和内容摘要传递；base64、临时 URL 和令牌不得成为身份或进入
  持久回执。

### 7. HTTP 成功、错误与传输故障

成功响应直接返回 operation 专属 DTO 并使用正确的 2xx 状态，不使用 `{code,data,meta}` 或通用 metadata
数据袋。分页、批量和部分成功必须有明确业务结构。`202 Accepted` 只返回稳定身份、状态和接纳 cursor，
不固化临时 URL、令牌或估时；临时 URL 只允许出现在实时查询。

所有 Blue Whale 应用生成的 HTTP 错误使用 RFC 9457 `application/problem+json`。错误类型目录不可变；
`type` 与 `code` 是前端业务判断和本地化键，`detail` 只供人读。校验错误使用严格 `violations` 结构且不得
回显用户数据。网络中断、TLS 失败和 timeout 是“无响应”的传输故障，不伪造 Problem Details。SSE 建连后
的订阅级致命错误使用 `event: problem`，不写入产品事件日志。

合同版本和 Manifest 摘要响应 header 只用于诊断和部署预检，不能参与运行时拒绝、协商或部署信任。

### 8. 领域身份与幂等

优先使用领域原生身份；只有缺少原生身份的副作用命令才使用 `Idempotency-Key`。键的 scope 至少包含契约
族、major、operation、认证主体和资源，但键本身不授予权限。

幂等指纹只包含登记的业务语义字段，排除授权、追踪和传输信息；严格校验后使用跨语言 canonical JSON 和
SHA-256，金额、大整数及时间先按本 ADR 的精确格式表示。身份、digest、权威事实、事件、Outbox 和稳定
receipt 必须在同一权威事务边界提交。相同身份与相同 digest 返回首次 receipt；相同身份与不同 digest
返回稳定的 409 Problem。结果不明只能使用原业务身份核对，新的物理 Attempt 必须另获权威许可。

幂等记录按业务生命周期保留并遵循数据最小化；receipt 不得固化临时 URL、Secret 或 token。

### 9. `payment-control` v1

`payment-control` v1 只包含三个稳定 operation：

1. `CreatePayment`：Go 调用 Payment Gateway；`tradeNo` 是 TopUp 身份及创建支付的幂等身份。
2. `GetPayment`：Go 调用 Payment Gateway，读取原支付身份的权威网关状态。
3. `ConfirmTopUp`：Payment Gateway 调用 Go；使用稳定 `gateway_event_id` 作为事件幂等身份，同时校验
   渠道交易号唯一性和付款证据指纹。

Gateway 不得传入 quota，Go 必须根据自身权威订单与策略独立计算。双向使用不同 HMAC 密钥；先验签再解析
JSON，签名至少覆盖 method、canonical path、timestamp、nonce、原始 body digest、契约族和完整版本。
HMAC 重试使用新 timestamp 与 nonce，但业务身份保持不变。精确路径、字段、header、canonicalization、
时钟窗口、密钥轮换和 replay retention 由后续合同编写票冻结。

v1 不提供自动退款。未知状态、冲突、晚到付款、渠道交易号冲突或付款证据冲突全部安全停止并进入人工
对账，不得静默回退旧版本或自动猜测归属。

### 10. 持久事件与 SSE

ADR-0016 定义的完整持久事件封套继续有效：`contract_version` 是 `public-api` 完整合同版本，`cursor` 是
唯一排序依据，`occurred_at` 是 Product API 接纳时间，`content_digest` 覆盖除自身外的完整持久事件且只作
一致性指纹，`causation_id` 可引用命令、消息或事件，无直接原因时缺省。

SSE `id=cursor`、`event=event_type`、`data=完整封套`，只保证 Project 内按 cursor 有序，至少一次交付。
未知事件不得应用或推进 cursor。消费者只允许一次同 major Snapshot 恢复；Snapshot 完整校验成功后，才可
用其状态和 high-watermark 原子替换本地状态并恢复订阅。再次失败即进入合同不兼容，禁止循环重连。只有
已登记且消费者在 Manifest 中明确声明为安全 no-op 的已知事件，才可不更新状态而推进 cursor。

### 11. SemVer 与人工兼容判定

- `patch` 不改变合同 wire、行为规范或可观察语义；恢复既有合同的实现修复只升级应用版本。
- `minor` 只允许已证明向后兼容的增量；新增请求字段先升级接收方并默认关闭，新事件先由全部目标消费者
  声明支持再启用生产者。
- 删除字段、增加必填项、收紧校验、改变单位/精度/null、身份/幂等、排序、状态机、错误含义、事务或
  副作用顺序属于 `major`。
- 新枚举、错误或事件默认不兼容；无法证明外部消费者安全时一律发布新 major。
- 自动 diff 只发现结构变化和明显违规。契约族负责人及受影响消费者必须人工记录影响范围、兼容级别、
  理由和场景测试证据；Schema 字节未变也不能豁免可观察行为变更。

每个 Schema 的稳定 `$id` 固定 major。major 升级顺序为 receiver dual-read、消费者升级、发送者切换、旧
major 退役。禁止自动协商、猜测、静默降级、失败后回退旧 major。旧 major 只有在旧消息、未决任务、支付
对账全部处理完成，活动状态不再依赖旧 decoder，且回滚窗口结束后才能退役。

公开 major 还受已发布支持窗口保护；具体期限由独立决策票确定。在该期限发布前，不得退役任何公开 major。

### 12. 版本化行为规范

状态转换、事务边界、领域授权、重试、恢复、核对和副作用顺序写入版本化行为规范；ADR 只记录为何选择该
规则，不复制完整运行规范。每个 operation/event 元数据引用稳定规范 ID。Manifest 同时固定机器合同和
行为规范的版本及 digest。

任何可观察行为变化都必须声明影响的契约族、operation/event、生产者、消费者、持久数据和回滚路径，
人工判定兼容级别，并通过对应场景测试。无法由 fixtures 或场景测试证明的行为不得发布。

### 13. Contract Manifest 与三层发布门禁

每个制品内嵌不可变 Contract Manifest，至少声明：制品和生成器身份、各契约族支持版本与角色、Schema /
OpenAPI / event manifest / behavior spec / fixtures 的 digest、支持 major、safe no-op、字段与事件能力、开关
标识及默认状态。Manifest 只声明制品能力，不记录环境实际开关值；实际值和首次启用/首次产生数据状态由
部署系统版本化管理。

Manifest digest 排除自身字段后计算，并与 CI 签名和来源证明共同验证。完整 Manifest 只向内部运维开放；
公开面只暴露合同版本和 Manifest digest。运行时诊断 header 不作为协商或部署信任来源。

发布链包含不可跳过的三层：

1. **合并门禁**：中立制品 diff、SemVer、行为影响记录、consumer compile、fixtures、字节级重生成和
   场景测试全部通过。
2. **制品门禁**：只有 CI 生成、签名、具备来源证明且内嵌匹配 Manifest 的不可变制品可进入部署仓库。
3. **部署预检**：用候选与当前可信 Manifest、制品 digest、全部活动版本及环境状态版本构建生产者—消费者
   兼容图；任何边缺少证明即拒绝部署。

部署和回滚使用同一套证明。预检绑定滚动部署期间全部活动版本及环境状态版本，状态变化必须重新检查。
环境必须记录新字段、事件和行为版本首次启用及首次产生数据；关闭开关不能消除既有数据。旧制品即使受信
任，只要无法处理已产生的数据，就禁止回滚；不存在安全回滚时只能向前发布兼容修复。

不保留降低或跳过合同检查的紧急通道。高优先级通道保留全部检查；紧急操作需要双人授权、事故编号、限时
有效和完整审计，且只能选择与当前状态兼容的既有可信制品。所有第一方消费者必须编译并通过场景测试；
外部消费者由公开 major 兼容规则和支持窗口保护。

### 14. 不可变历史包与一次性迁移

每个已发布合同版本形成不可变历史包，包含完整 Schema、接口与事件描述、行为规范快照、fixtures、
Manifest、生成器信息、签名和来源证明。持久消息记录完整合同版本与内容指纹。生产运行时只使用制品内置、
Manifest 声明的 decoder；历史版本只读归档，禁止动态下载或执行合同。

旧 major 退役不删除历史包。只要持久数据、审计或法定留存仍引用某版本，对应历史包和离线核验能力必须
保留。未知版本或摘要不匹配的数据必须隔离并离线核验；支付数据同时进入人工对账。历史迁移只能作为独立、
可审计、可验证的一次性任务执行，禁止运行时自动迁移、猜测解析或回退旧实现。

## 被否方案

- **TypeScript 类型或 TypeBox AST 直接成为跨进程协议**：绑定实现语言，无法形成中立兼容证据。
- **手写 DTO、JSON Schema 与 OpenAPI 多源维护**：必然漂移，无法证明哪个版本是权威。
- **沿用 Fastify 默认 Ajv 配置**：默认 dialect 与输入变异语义不满足 Draft 2020-12 严格合同。
- **统一大版本或运行时协商/降级**：扩大无关服务发布半径，并让失败路径产生不可审计的协议选择。
- **紧急发布跳过合同门禁**：会把未知协议直接写入持久数据，之后即使关闭开关也无法安全回滚。
- **运行时下载 decoder 或自动迁移历史数据**：让生产正确性依赖可变外部状态，且无法审计每次解释。
- **内部 gRPC/Protobuf 或媒体 base64**：当前没有性能证据支持额外协议和工具链复杂度。

## 验收矩阵

后续合同与实现必须至少覆盖：

1. Draft 2020-12 meta-schema、OpenAPI 3.1.2、Ajv 2020-12 和 serializer 投影对同一正反 fixtures 得出等价结果。
2. Fastify 默认 coercion/default/removal 全部被测试证明关闭；未知内部字段和判别值 fail closed。
3. 四个契约族独立升级；patch 合同漂移、错误 SemVer 和未登记行为变化被合并门禁拒绝。
4. TS 与 Go 对金额、大整数、时间、null/缺省、canonical digest、Problem Details 和 HMAC base string 逐字节一致。
5. 新请求字段、新事件与行为版本只有在 receiver-first、默认关闭开关和 consumer 场景证明后才能启用。
6. 未知 SSE 事件不推进 cursor，只允许一次同 major Snapshot 恢复；safe no-op 必须与消费者 Manifest 匹配。
7. `tradeNo`、`gateway_event_id`、渠道交易号和付款证据 digest 的重复、冲突、timeout、晚到与人工对账路径确定性收敛。
8. 部署和回滚对滚动期间全部活动版本、制品 digest、环境状态版本及已产生数据执行同一预检。
9. 每个历史版本均可离线核验；未知或摘要异常数据隔离，迁移任务不可被普通运行时触发。

## 后续边界

- 分别通过 [public-api 合同票](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK41WU)、
  [agent-work 合同票](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK41WV)、
  [generation-work 合同票](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK41WW) 与
  [payment-control 合同票](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK41WX) 编写精确
  Schema、行为场景和 fixtures；`payment-control` 同时冻结 HMAC 字段表与 canonicalization。
- 在公开 v1 GA 前通过[公开 major 支持期限决策](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK41WT)
  决定支持期限、弃用通知、支持责任和退役证据。
- 后续实现票必须被相应合同编写票阻塞；合同未关闭前不得进入 `ready-for-agent` 或修改生产者/消费者代码。
