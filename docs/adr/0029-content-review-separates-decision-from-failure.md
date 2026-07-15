# ADR-0029：ContentReview 契约分离决定、故障、尝试与策略

- **状态**：Accepted
- **日期**：2026-07-15

ContentReview 规范化模型使用 `review_state = pending | decided | failed`。只有 `decided` 携带 `decision = pass | reject`；`failed` 的 `decision` 必须为空，并以 `failure_code` 表达 `timeout`、`unavailable`、`rate_limited`、`invalid_evidence`、`invalid_request`、`authentication_failed` 或 `authorization_failed`。只有 `decided + pass` 允许内容继续，其他组合一律 fail closed。

`reason_codes` 是仅用于 `reject` 决定的产品规范化安全原因码集合，可包含：`sexual_content`、`minor_safety`、`violence`、`self_harm`、`hate_or_harassment`、`illegal_or_regulated`、`privacy_or_sensitive_data`、`fraud_or_impersonation`、`cyber_abuse`、`prompt_attack`、`resource_abuse`、`custom_policy` 和 `unclassified_policy_risk`。供应商标签必须通过带版本的映射表转换；未知或无法可靠映射的标签归入 `unclassified_policy_risk` 并拒绝。普通 User 和公开 API 只得到 `CONTENT_REJECTED` 与本地化安全提示，不返回原因码、标签、置信度、命中规则或原文；规范化原因码只对具备安全运营权限的内部角色可见。

ContentReview 的逻辑唯一身份由 `project_id + subject_type + subject_id + content_digest + modality + direction + policy_version` 组成。同一身份的并发请求复用一个逻辑审核，不建立跨 User 或跨 Project 的全局摘要缓存。ContentReview 只能从 `pending` 进入不可变终态 `decided` 或 `failed`；每次供应商调用追加一条 ReviewAttempt，自动恢复期间逻辑审核保持 `pending`，单次尝试失败不能伪装成内容拒绝。终态失败后的 User 重试创建关联的新 ContentReview，不重开或改写旧记录；`decided + reject` 不自动重审，内容改变后才形成新的受审主体。

每个 ContentReviewPolicy 是不可变配置包，包含适用模态和方向、产品判定规则、供应商配置引用、阈值、原因码映射版本和证据要求。任意变化都创建新 `policy_version`，生命周期为 `draft → validated → active → retired`；每个生产环境的模态与方向组合同时只有一个活动版本。候选版本先在非生产验证，再以影子模式比较且不影响 User 决定；启用和回滚只影响新审核，既有审核及其 ReviewAttempt 固定创建时版本，历史 Asset 不因普通策略升级重审。策略启用、停用和回滚写入 AuditRecord。

Blue-Whale 只持久化规范化决定、内容摘要、模态、策略版本、原因码和最小化证据引用，不持久化供应商完整响应、审核请求副本、命中原文或额外媒体副本。产品事实随关联 Asset、GenerationJob 或 Conversation 保留并参与未来 Project 删除流程；最小化 AuditRecord 按 ADR-0018 保留 365 天。删除动作只审计对象标识摘要、原因、时间和结果，不复制原始内容；删除失败必须告警并重试。
