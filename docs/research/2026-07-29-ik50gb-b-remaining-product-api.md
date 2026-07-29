# IK50GB-B 剩余产品 API 迁移调研

- **日期**：2026-07-29
- **范围**：GenerationInbox、Conversation、UserInputRequest、AgentRun、Project/Job SSE
- **目标**：迁移到 TypeScript，并为 IK50GB-C 删除 Java rewrite 提供可验证前置

## 结论

IK50GB-B 不能按 Java Controller 数量机械迁移。目标应是一个 Node 拥有的产品事实闭环：

```text
Conversation / GenerationInbox command
  -> MySQL transaction
  -> Message + AgentRun + ProjectEvent
  -> TypeScript Agent Worker
  -> Assistant Message + AgentRun terminal state + ProjectEvent
  -> Snapshot / Project SSE
```

浏览器继续使用仓库当前已经接入的 `/api/...` 路径。本轮不引入已被
[ADR-0055](../adr/0055-prelaunch-typescript-unification-scope.md) 缩减的完整 `/api/v1`
治理平台，也不建立 Node 到 Java 的兼容适配。

## 现状证据

### 1. TypeScript 缺少的不是代理，而是产品事实应用层

- `packages/persistence/prisma/schema.prisma` 没有 Conversation、Message、AgentRun、
  UserInputRequest 与 ProjectEvent 模型。
- `blue_whale_web/lib/snapshot/handle-get-snapshot.ts` 把 Conversation、AgentRun 和
  high-watermark 固定返回为空或 `0`。
- `apps/agent-worker` 只有 readiness；没有持久任务 claim/commit loop。
- `apps/product-api` 也只有 readiness。现有产品 Route Handler 实际位于 Next.js。

因此只新增 Route Handler 会产生不可恢复的空壳，不能满足无 Java 运行。

### 2. Java 行为只能作为迁移盘点

Java `ConversationCommandService` 当前会为每条普通消息创建新 Run，并 supersede 旧 Run；
这与更新的 Conversation 输入队列决策不一致。B 采用上线前最小语义：

- 消息、Run、事件与幂等回执同事务落盘；
- 同一 Conversation 只保留一个非终态 Run；
- 等待输入时只接受准确的 `reply_to_input_request_id`；
- 普通消息进入活动 Run 的输入序列，不再复制 Java 的无条件 supersede。

复杂 Runtime Bundle pin、旧 checkpoint 兼容和 Java V1–V18 历史迁移不进入本切片。

### 3. UserInputRequest 不保留独立确认接口

Java 的 `POST /api/projects/{projectId}/input-requests/{requestId}/confirm` 没有浏览器调用方，
并且与 ADR-0016/0054 已确定的 Conversation 回复语义冲突。B 只迁移 UserInputRequest 状态和
通过 Conversation 消息回答的应用用例，不迁移独立 `confirm` Route。

### 4. Job SSE 直接退役

仓库当前没有 `/api/jobs/{id}/stream` 的浏览器消费者。ADR-0016 明确按 Job 的内存
`JobStreamBus` 不能迁移为公开兼容层。B 只实现持久、可重放的 Project SSE；GenerationJob
变化追加到 ProjectEvent。IK50GB-C 删除 Job SSE rewrite，不新增同路径 Node 实现。

### 5. 数据库所有权移到 Node

当前 Prisma 模型面向正在使用的 BIGINT 产品表，而
`packages/persistence/schema/001_baseline.sql` 是另一套尚未接入 Web 的 UUID 试验基线。
仓库没有生产用户或必须迁移的数据，因此采用一次性 fresh baseline：

- Prisma schema 是 TypeScript 持久化模型；
- Node-owned baseline 与 Prisma 模型对齐；
- Conversation、AgentRun、UserInputRequest、ProjectEvent 直接进入该 baseline；
- 不运行 Java migration，不做旧库原地升级。

## B 的完成边界

B 完成时必须证明：

1. Conversation 与 GenerationInbox 使用认证上下文中的 new-api `userId` 做归属校验。
2. 消息接纳、幂等重放、Run 创建/续接和 ProjectEvent 在事务内一致。
3. TypeScript Agent Worker 能 claim 持久 Run，提交 assistant message 和终态；旧 fence 被拒绝。
4. Snapshot 返回 Conversation、AgentRun、活动 UserInputRequest 与真实 high-watermark。
5. Project SSE 可先重放后订阅；断开后清理；GenerationJob 变化也进入同一事件流。

Java rewrite、启动拓扑和真实 new-api smoke 仍由 IK50GB-C 完成。
