# ADR-0035：首版生产观测采用火山引擎 APMPlus 托管后端

- **状态**：Accepted
- **日期**：2026-07-16

[ADR-0018](0018-security-cost-review-audit-observability-baseline.md) 已冻结 OpenTelemetry、OTLP、
W3C Trace Context、采样与保留周期、敏感数据边界和生产告警阈值，但没有选择具体观测后端。
首版决定在生产 VKE 中部署 APMPlus OpenTelemetry Collector，以火山引擎 APMPlus 及其全栈
可观测平台作为 Trace、Metrics、Logs、看板和告警的托管后端。Java Product API、Python Agent
Worker 与 Java Generation Worker 只依赖标准 OpenTelemetry SDK、OTLP 和 W3C Trace Context；
APMPlus 鉴权、路由与部署细节留在 Collector 和基础设施配置中，不进入产品业务代码。

## Considered Options

- 拒绝首版自建 Tempo、Loki、Prometheus 和 Grafana：它能提供最大的后端自主性，但会在单区域、
  小规模生产阶段新增多套有状态组件的容量、升级、备份和自身可用性责任。
- 拒绝首版接入 Grafana Cloud：它能减少自运维并保持统一体验，但会在现有火山引擎生产边界之外
  新增网络、数据驻留、权限和供应商管理面。
- 采用 APMPlus 托管后端：复用 VKE 的 Collector 组件和火山引擎统一看板、告警能力，把首版投入
  集中在可验证的业务埋点、关联标识与告警规则，同时由标准 OTLP 边界保留后端替换路径。

## Consequences

- IK10PU 验收前必须在目标生产地域和实际套餐中证明 Trace 7 天、运行日志 30 天、Metrics 90 天
  的保留周期可兑现，并证明 ADR-0018 的全部必需告警阈值能够配置、触发、恢复和投递。
- 任一硬约束不能满足时，本决策自动重开；不得通过缩短保留期、删除告警或绕过 Collector 验收，
  应重新评估自建 Grafana、Tempo、Loki、Prometheus 组合。
- 后端替换应主要影响 Collector exporter、基础设施资源、看板和告警配置，不要求重新改写三个运行
  单元的业务埋点。
- IK10PU 只有按 [ADR-0033](0033-controlled-production-validation-and-ownership.md) 完成两阶段受控
  验证后才算完成：非生产环境执行自动化验收、全部告警规则校验与故障注入；生产 `cn-beijing`
  的隔离 VKE namespace 实际部署三个运行单元与 Collector，只使用合成数据，不接入真实用户流量、
  素材或公开展示面。
- 生产隔离验证必须证明三个运行单元的链路贯通、日志与 Trace 可关联、看板可查询，并至少演练一条
  Warning 和一条 Critical 告警的触发、通知与恢复。仅提交 SDK、部署清单、看板或告警规则不构成
  完成。
- Agent 负责可重复的部署、验证和证据脚本；生产控制台操作继续由 `@kimjohn` 执行或明确授权。
  本 ADR 不改变三个独立运行单元的既有边界。
- 所有生产告警的触发与恢复通知统一投递到“生产告警”飞书群，使用飞书应用机器人；恢复通知不得
  关闭。Critical/P0 另行电话通知当班负责人，邮件只作备用，不使用短信。
- 首版不自建告警转发服务；飞书机器人、电话和恢复通知由火山引擎统一告警能力直接承载。IK10PU
  的生产演练必须分别证明飞书触发与恢复消息可达，以及 Critical/P0 电话通知可达。
- 首版只使用两个可处置严重级别：P0/Critical 表示已经或即将造成用户不可用、安全或审计失守、
  成本硬边界触发，要求飞书与电话通知并在 5 分钟内认领；P1/Warning 表示服务降级、积压或风险
  上升但尚未越过关键边界，只发飞书并要求在 30 分钟内认领。
- Recovery 只表示恢复状态，不是第三个严重级别；普通信息留在看板和日志中，不配置 P2/Info
  生产通知。
- 以下事件直接定为 P0/Critical：审计写入失败、审计完整性校验失败、API 5xx 在 5 分钟内超过
  5%、ContentReview 不可用率在 5 分钟内超过 1%、成本额度达到 100%，以及密钥异常访问。
- Outbox 或队列积压、供应商失败、遥测丢弃或缓冲压力、认证拒绝异常升高，以及成本达到 70%
  或 85% 时先定为 P1/Warning；只有达到单独冻结的升级条件才转为 P0。告警接收责任和这些升级
  条件仍需另行冻结。
- Outbox 最老记录年龄超过 30 秒时触发 P1，超过 5 分钟时升级为 P0；最老待领取任务超过 60 秒
  时触发 P1，超过 5 分钟时升级为 P0。5 分钟升级边界与 Reconciler 发现卡住记录的既有上限
  一致。
- 单个供应商失败率在 10 分钟内超过 20% 时触发 P1；只有当图片或视频某一模态的所有已启用
  供应商连续 5 分钟都被健康状态或熔断器判定为不可用时才升级为 P0。仍有备用供应商可用时保持
  P1；没有请求流量不能被解释为供应商不可用。
- 任一 Trace、Metrics 或 Logs 信号出现丢弃，或 Collector exporter 缓冲使用率连续 5 分钟达到
  70% 时触发 P1；Collector 全部副本连续 5 分钟不可用，或任一信号的 exporter 缓冲连续 5 分钟
  达到 90% 时升级为 P0。
- Collector 全部不可用必须由独立的 VKE 或云监控探测，不能依赖 Collector 自己上报。AuditRecord
  不属于普通遥测，继续使用审计写入失败和完整性失败的直接 P0 规则。
- 认证拒绝在 5 分钟内不少于 50 次且拒绝率达到 20% 时触发 P1；认证拒绝本身不自动升级为 P0，
  只有调查确认攻击或凭据泄漏后才由当班负责人升级安全事件，密钥异常访问仍直接 P0。
- 认证 Metrics 只记录全局低基数计数，不使用手机号、User 或 IP 标签；具体来源仅在受访问控制的
  日志和 Trace 中调查。
- 告警所有权使用角色而不是个人联系方式：`production-oncall` 是所有 P0/P1 的首要责任角色；
  `security-owner` 共同接收审计、密钥和认证告警；`cost-owner` 共同接收成本 70%、85% 和 100%
  告警。首版三个角色均由 `@kimjohn` 承担，团队扩展时只调整火山引擎联系人组成员。
- 每条告警规则必须包含 `owner`、`service`、`severity` 和 `runbook_url`；手机号、邮箱等个人联系
  方式只保存在云平台联系人组中，不进入仓库。
- P0 立即通知 `production-oncall`；5 分钟仍未认领时再次电话通知，并升级到
  `production-backup`。`production-backup` 必须至少包含一名与主值班人不同且电话已验证的联系人；
  缺少该联系人时生产告警验收不通过。
- P1 在 30 分钟内未认领时只重新通知飞书群和 `production-oncall`，不因无人认领自动改变严重
  级别。Recovery 关闭活动告警，但必须保留触发、认领和恢复记录。
- Java Product API 与 Java Generation Worker 首版复用同一 Java 制品，但必须以两个独立 VKE
  Deployment 运行。Product API 关闭 Worker 调度并使用
  `service.name=blue-whale-product-api`；Generation Worker 使用非 Web 运行配置，只启用 Worker
  调度，并使用 `service.name=blue-whale-generation-worker`。
- Python Agent Worker 使用 `service.name=blue-whale-agent-worker`。三个运行单元分别配置
  ServiceAccount/IRSA、资源配额、扩缩容、健康检查和故障域；仍在同一 Pod、同一 JVM 或共用
  `service.name` 均不满足验收。IK10PU 不要求为 Generation Worker 拆分新 Maven 模块或独立 JAR。
- 三个运行单元的 OpenTelemetry SDK 对集群内 Collector 使用 AlwaysOn，先发送完整 Trace；
  Collector 执行尾采样，普通流量保留 10%，错误、安全或审核拒绝、审核不可用、成本拒绝、重试
  耗尽和恢复动作保留 100%。Metrics 和 Logs 不跟随 Trace 的 10% 采样。
- 完整 Trace 只允许在 VKE 集群内部短暂流转，尾采样完成后才发送到 APMPlus；不得让应用 SDK
  直接向 APMPlus 全量上报，也不得用入口头采样代替尾采样。
- Collector 采用两层拓扑，不使用每 Pod sidecar：每个 VKE 节点运行轻量 Agent Collector
  DaemonSet，接收本节点 OTLP 并提供短时重试与缓冲；Agent 按 `traceID` 把 Trace 路由到 Gateway。
- Gateway 使用固定两个副本的 StatefulSet，负责过滤、尾采样、批处理和导出 APMPlus；两个副本
  必须跨节点分布，配置反亲和与 `PodDisruptionBudget(minAvailable=1)`。首版不启用 Gateway HPA，
  容量测试证明需要后再人工调整副本，避免扩缩容导致 Trace 路由重分片。
- 如果 APMPlus VKE 组件不能配置所需处理器或按 `traceID` 负载均衡，则使用上游 OpenTelemetry
  Collector 承载 Agent/Gateway，并通过标准 OTLP 导出到 APMPlus；不得为使用托管组件而削弱
  尾采样正确性。
- `blue-whale-gateway` 作为入口基础设施纳入 IK10PU，使用
  `service.name=blue-whale-gateway`，接收或创建 W3C `traceparent` 并向 Product API 继续传播；
  它不是第四个产品运行单元，但必须纳入端到端 Trace、RED 指标、日志和生产演练。
- 网关删除 SkyWalking 工具依赖、gRPC 日志 appender 和 B3-only MDC，日志改用标准
  `trace_id`/`span_id` 关联并通过相同 Collector 链路上报；不保留双写或长期双传播协议。
- Java 网关、Product API 与 Generation Worker 采用固定版本的 OpenTelemetry Java Agent，自动
  覆盖 Spring、HTTP、JDBC、Redis 等通用边界；Python Agent Worker 采用固定版本的
  `opentelemetry-distro` 与 `opentelemetry-instrument` 覆盖标准库、HTTP 和日志关联。Agent 与
  Python 依赖版本必须在镜像或部署配置中固定，不得在生产启动时漂移。
- 自动埋点之外，应用通过标准 OpenTelemetry API 为 Outbox、AgentRun、GenerationJob、
  ContentReview、成本预占、审计健康、恢复流程，以及 Python 编排、检查点和工具调用补充业务
  Span 与低基数 Metrics。不得只依赖自动埋点，也不得改为全量手工埋点。
- 产品代码不得依赖 APMPlus 专有 SDK；业务埋点只使用标准 OpenTelemetry API，并继续通过
  OTLP、W3C Trace Context 和统一 Collector 接入托管后端。
- IK10PU 的端到端链路从 `blue-whale-gateway` 开始，不接入浏览器端 RUM。浏览器 OpenTelemetry、
  Web Vitals、会话回放、Source Map 和前端 JavaScript 异常采集均不属于本工单；浏览器隐私授权、
  敏感数据过滤、CSP 和前端采样策略应在独立后续工单中设计。
- 因此 IK10PU 的完成不以浏览器异常进入 APMPlus 为条件，生产受控演练由网关接收合成请求并创建
  或延续 W3C Trace Context；不得为了宣称浏览器到后端的全链路而临时扩大首版范围。
- Collector 使用 `status_code=ERROR` 规则保留全部错误 Trace。对可能返回 HTTP 2xx、但仍要求
  100% 保留的业务结果，作出决定的 Span 必须写入低基数属性
  `blue_whale.sampling.reason=<固定枚举>`；Trace 中任一 Span 命中该属性时保留整条 Trace，其余
  正常 Trace 继续按 10% 采样。
- 固定枚举仅包括 `security_reject`、`audit_failure`、`content_review_reject`、
  `content_review_unavailable`、`cost_reject`、`retry_exhausted` 和 `recovery`。新增枚举必须同步
  修改 Collector 策略与验收用例，不能依赖任意字符串隐式保留。
- 强制保留属性只能由服务端业务逻辑根据已验证的结果产生，不接受客户端输入，也不写入或读取
  W3C Baggage。外部调用方不得通过 Header 或 Baggage 操纵生产采样率。
- IK10PU 的完成交付物必须在仓库中版本化：Collector 配置、VKE 部署清单、各运行单元的 OTel
  配置、可导入或可自动创建的看板与告警规则、每条告警对应的 Runbook、非生产故障注入脚本、
  生产合成验证脚本，以及脱敏的机器可读验收报告。截图只能作为辅助证据，不能充当配置来源。
- 能通过 APMPlus API 或导入机制管理的资源必须可重复创建；确实没有自动化接口的控制台步骤，
  必须提供精确 Runbook 和导出配置快照，由 `@kimjohn` 执行或授权。口头步骤和仅有截图不满足
  验收。
- 每条告警的 `runbook_url` 必须指向版本化文档。密钥、手机号、邮箱、飞书机器人凭据和联系人组
  成员只保存在云平台或 Secret 中，不写入仓库、验收报告或截图。

## 参考资料

- [APMPlus：Python 应用通过 OpenTelemetry 接入](https://www.volcengine.com/docs/6431/81123)
- [VKE：可观测组件概述](https://www.volcengine.com/docs/6460/101015)
- [火山引擎全栈可观测平台](https://www.volcengine.com/product/observe)
- [OpenTelemetry Java Agent](https://opentelemetry.io/docs/zero-code/java/agent/)
- [使用 OpenTelemetry API 扩展 Java Agent](https://opentelemetry.io/docs/zero-code/java/agent/api/)
- [OpenTelemetry Python 自动埋点](https://opentelemetry.io/docs/zero-code/python/)
- [OpenTelemetry 尾采样](https://opentelemetry.io/docs/concepts/sampling/)
- [OpenTelemetry Baggage 安全边界](https://opentelemetry.io/docs/concepts/signals/baggage/)
