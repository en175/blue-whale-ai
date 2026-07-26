# ADR-0026：生成媒体审核失败复用结果并有界恢复

- **状态**：Accepted
- **日期**：2026-07-15
- **修订**：[ADR-0051 Node Generation Worker 执行与恢复边界](0051-node-generation-worker-execution-and-recovery-boundary.md)（审核超时后的重试身份）

生成供应商返回媒体只证明供应商执行成功，不代表 Blue-Whale 已接纳产品结果。Java Product API 的 ContentReview 拒绝某个生成结果时，对应输出槽位进入 `failed` 并使用 `CONTENT_REJECTED`，隔离区对象立即进入清理流程并最迟在一小时内删除，不创建 Asset、Card 或 NodeItem。审核记录与 AuditRecord 只保存摘要、决定、原因码和证据引用，不保存原始媒体。

多输出 GenerationJob 中至少一个槽位通过且至少一个槽位被拒绝时，任务进入 `partially_succeeded`；全部被拒绝时进入 `failed`。供应商调用已经产生的实际成本仍按事实结算，不能因产品拒绝而记作未调用或释放为零成本。该边界保留供应商执行事实，同时确保只有产品接纳的结果才能成为 Asset。

供应商结果等待审核时，GenerationJob 保持 `processing`，内部阶段为 `reviewing`；结果保存在私有隔离区，User 只看到“结果处理中”。自动恢复最多 15 分钟，仅对网络超时、限流、服务端错误和服务不可用按指数退避与抖动重试，并始终复用同一结果、摘要、策略版本和逻辑审核身份；每次供应商调用追加 ReviewAttempt，不重新生成，也不建立第二次生成 CostReservation。明确拒绝、非法请求、鉴权或权限配置错误不自动重试并立即告警。

15 分钟仍无法形成决定时，ContentReview 与 GenerationJob 分别进入不可变的 `failed`，Job 错误码为 `CONTENT_REVIEW_UNAVAILABLE`，隔离结果继续保留 24 小时。User 在期限内仅重试审核时创建关联的新 GenerationJob 与新 ContentReview，复用原隔离结果，不重开旧记录、不重新生成或重复计费；到期后硬删除隔离结果，后续重试必须重新生成并重新确认可能产生的费用。生产启用前必须用受控环境 P95、P99 校准上述预算。
