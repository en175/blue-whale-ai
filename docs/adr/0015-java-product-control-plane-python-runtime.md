# ADR-0015：Java 产品控制面与双 Worker 运行时分层

- **状态**：Accepted
- **IK3UUX 范围状态**：Superseded — 本文只记录迁移前 Java/Python 基线；目标改为同一 TypeScript
  代码库中的 `product-api`、`agent-worker`、`generation-worker`，见
  [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。
- **日期**：2026-07-13

Blue-Whale 已合入承载 Project、Canvas、GenerationJob 和 Asset 的 Java 后端，同时此前 Spike 验证了 Python Agent 编排与不透明 checkpoint 的可替换边界。为避免双公开后端和双重事实权威，决定由 **Java Product API** 作为唯一公开产品控制面，由 **Python Agent Worker** 执行 LLM、Skill、Tool 和 Agent 编排，由 **Java Generation Worker** 执行图片/视频 GenerationJob 与供应商 Adapter；三个运行单元通过产品中性的窄 Interface 协作。

Project、Canvas、Conversation、AgentRun、GenerationJob 与 Asset 在 Java 代码内保持独立领域 Module 和一致性边界，但首版不拆成各自的网络微服务。Python 不直接写产品领域表或持有独立权威库，RuntimeCheckpoint 由 Java 按 Run 版本、租约和栅栏原子接纳，内容对 Java 不透明且固定到创建时的引擎版本。

## Considered Options

- 拒绝继续使用 Python + FastAPI 作为公开产品 API：它会与现有 Java 后端形成双重权威。
- 拒绝全部使用 Java 执行 Agent 编排：它会放弃已验证的 Python 框架替换边界。
- 拒绝每个聚合立即拆成网络微服务：单区域小规模首版不值得承担分布式一致性和运维成本。
- 拒绝把 API、Agent 执行和生成执行保留在同一进程：长耗时任务必须能够独立扩展和故障隔离。

## Consequences

- Java Product API、Python Agent Worker 和 Java Generation Worker 成为三个独立运行单元。
- 图片/视频供应商 Adapter 归 Generation Worker；LLM 和 Agent 框架 Adapter 归 Python Agent Worker。
- 对外流式状态必须来自 Java 接纳后的持久化产品事件。
- 现有同进程 `@Async`、`JobPoller` 和内存 `JobStreamBus` 仅是迁移基线，不再定义目标架构。
- 完整设计见[产品后端领域边界与运行时分层设计](../specs/2026-07-13-backend-domain-runtime-layering-design.md)。
