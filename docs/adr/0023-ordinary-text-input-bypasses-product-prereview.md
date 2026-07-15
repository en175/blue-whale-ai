# ADR-0023：普通用户文字输入不做独立前置 ContentReview

- **状态**：Accepted
- **日期**：2026-07-15

AgentChatPanel 用户消息和 BottomDock 文字提示词在提交后立即进入既有产品流程，不先调用独立 ContentReview 服务，也不向 User 展示“审核中”状态。普通文字输入位于 User 的私有 Project 中，额外前置调用会增加延迟、成本和审核服务单点依赖，却不能替代 Java Product API 对工具权限、对象归属、成本和副作用的确定性控制。

Agent 或生成供应商仍执行自身自动安全策略，其可验证结果作为 ReviewEvidence；供应商拒绝时产品返回安全错误。Agent 文字输出和生成媒体仍须在向 User 展示前由 Java Product API 形成产品权威 ContentReview 决定。该决定接受普通文字输入可能在产品独立审核前到达 Agent 或生成供应商的取舍，部分取代 ADR-0018 第 3 节及 ADR-0022 的原始全输入范围，但不改变上传图片、视频或任何输出的现有审核边界。
