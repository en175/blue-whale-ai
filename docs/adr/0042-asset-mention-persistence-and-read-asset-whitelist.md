# ADR-0042：@ 引用 Asset 持久化与 read_asset 白名单第三源

- **状态**：Accepted
- **日期**：2026-07-22
- **决策者**：用户（与 Agent grill-with-docs 会话共同得出，触发工单：IK33ZV，IK2QC7 AC#2 follow-up；实施规格见 IK33ZV description）

> **IK3UUX 范围状态**：保留消息中不可变的 Asset 引用，以及从权威 NodeItem/Asset 关系计算读取范围；
> PendingConversationInput、精确浏览器路径和 command 格式不作为前置，见
> [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。

## 背景

IK2QC7 落地 read_asset 白名单 = 画布节点 `data.assetId` ∪ 本 AgentRun 的 `agent_run` 来源 GenerationJob 输出。AC#2 要求「仅对选中或 @ 引用的 Asset 放行」，但纯对话 @ 引用进不了白名单。根因链：

1. 画布「添加到对话」入口在编排层即丢弃 assetId（同作用域可用但未透传）；
2. AgentChatPanel 输入器只插入纯文本 `@name`，mention pill 工具模块无调用方（死代码）；
3. 消息实体 / 接纳 DTO / `conversation_messages` 表均无引用承载位。

同时，仅放行不够：Agent 在文本里看到 `@[图1]` 也拿不到 assetId——`CanvasNodeSummary` 无名称、`history` 的 `MessageItem` 无引用字段，名称匹配在「@ 后删除画布节点」场景整个失效。

历史实现曾假设每条用户消息创建一个 AgentRun；目标模型已取消这一前提。同一 Run 可以按服务端顺序消费
多条 PendingConversationInput，因此引用的可见范围必须由 Conversation 与 Advance 输入水位明确决定。

## 决策

### D1. 引用关系独立关联表持久化

新建 `message_asset_reference`（`id / message_id / conversation_id / project_id / asset_id / mention_seq` + `gmt_create / gmt_modified / version / is_delete`；索引 `(conversation_id)`、`(project_id)`）。冗余 `conversation_id / project_id` 使白名单反查无需 JOIN 消息表。不采用 `conversation_messages` 加 JSON 列。

### D2. 前端 pill 结构化承载 + `referenced_asset_ids` 协议

复活改造 mention pill 工具模块，pill 携带 assetId 数据属性；pill 在消息文本中序列化为 `@[name]`（与技能 mention 的 `@name` 纯文本形态区分）；消息接纳请求体新增可选 `referenced_asset_ids: number[]`（DOM 序、去重、上限 10），请求幂等 hash 纳入该字段。接纳时只做归属校验（Asset 存在且 `projectId+userId` 匹配），越权/失效 id 静默过滤 + warn 日志、持久化有效子集——不 400、不卡 status；引用行与消息、AgentRun 同一事务落库，Worker 认领 Run 时引用必然可查。

### D3. 白名单第三源 = Run 所属 Conversation 全量引用

`read_asset` 放行集合新增第三源：按 `run.conversationId`（叠加 `projectId` 双保险）直查关联表并入既有两源；`read_asset` 主体与 `projectId+userId+status=normal` 三元组零改动。范围不扩到 Project（GenerationInbox 多段 Conversation 独立），不缩到 Run（切断多轮追问连续性）——与 Agent 可见对话上下文同边界。

### D4. 引用无失效语义

引用是消息事实的一部分，落定即不可变；不提供随消息编辑/删除的失效机制（用户消息 insert-only，无编辑/删除端点）；Asset 后续状态变化由读取时三元组兜底。未来若引入消息删除，以 `is_delete` 级联即可，表结构不变。

### D5. Agent 感知通路：history 携带有序引用

Conversation 渐进读取 `history` 的 `MessageItem` 新增 `referenced_asset_ids`（按 `mention_seq` 升序，无引用为空数组；按页单次 IN 批量查询，无 N+1），Python Worker 透传进模型上下文 JSON。`mention_seq` 使 Agent 能把文本中 `@[name]` 出现顺序与 id 列表精确对齐。不采用名称匹配。

## 备选方案与不采纳理由

- **`conversation_messages` 加 `referenced_asset_ids` JSON 列**：白名单反查需扫全量消息逐行解析 JSON 且无法索引，与全仓规范表 + 显式索引的设计惯例不符。
- **Run 范围白名单**：每消息一 Run 的模型下等价于仅本条消息；追问「把它改暖一点」的新 Run 读不到上轮 @ 的素材，切断对话连续性。
- **Project 范围白名单**：GenerationInbox 允许一个 Project 并存多段独立 Conversation，跨对话引用不应互通。
- **越权 id 整体 400**：陈旧 pill 场景极少发生，却挂在发送消息这条最高频主路径上；真正闸门是读取时三元组，accept 过滤只是数据卫生，故过滤 + warn 日志。
- **Agent 侧名称匹配（`CanvasNodeSummary` 加名称）**：重名/改名不可靠，且「@ 后删除画布节点」场景匹配路径整个失效；结构化 id 列表精确，且随引用表顺带可得。
