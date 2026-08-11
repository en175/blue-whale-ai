# Mastra 独立 Agent 服务迁移决策记录

## 时间

2026-08-11

## 状态与用途

**状态：讨论中，已确认项持续追加。**

本文是蓝鲸现有 Agent 模块迁移讨论的持久决策记录，用于防止长会话中的结论丢失。它不是最终实施规格；全部设计确认后，将据此形成正式 ADR、领域术语更新和实施规格。除「待验证与未决项」外，下文均为用户已经明确确认的决定。

## 目标与范围

1. 现有 `apps/agent-worker` 与 `packages/agent-runtime` 整体退役，不继续作为新 Agent 的运行基础。
2. 新 Agent 使用 Mastra 开源框架实现，迁移到独立仓库、独立服务。
3. 蓝鲸 Canvas 只集成 Agent UI 和消费 Agent 产物，不在蓝鲸仓库继续维护一套自研 Agent 编排实现。
4. V1 是面向创作需求对齐的多轮 Agent：支持文生文、图片理解后生文、主动盘问、后台运行和最终 PromptCard；不负责生图或生视频。
5. 用户将 PromptCard 带入蓝鲸 BottomDock 后，自行编辑和触发后续生成。

## 选择后台 Agent Runtime，而非单请求聊天

采用持久化后台 Agent Runtime：

- 页面关闭后 AgentRun 可以继续执行；
- 支持多步骤工具调用、暂停、恢复、取消和失败重试；
- 等待用户输入时 Workflow 持久化为暂停状态，不占用一个持续 HTTP 请求；
- 蓝鲸重新打开页面后可以恢复快照并继续订阅事件；
- V1 暂不引入多 Agent 协作，但架构不得阻断后续扩展。

多轮盘问与后台执行是两个不同维度。V1 同时选择「多轮引导式会话」和「持久化后台执行」。

## 总体职责边界

### 蓝鲸负责

- Canvas、AgentChatPanel 和历史会话入口；
- 现有用户登录态、User 与 Project 权限；
- Agent REST/SSE 的同源 BFF 入口；
- 服务间授权签发；
- 内部 Agent Model Gateway；
- New API 用户计费归属；
- Asset 权限、TOS 对象和短期签名 URL；
- Standalone Session 使用的隐藏 AgentWorkspaceProject；
- BottomDock、GenerationDraft 与 GenerationJob；
- 生成时冻结 PromptCard 来源、提示词快照和最终模型参数。

### 独立 Mastra Agent 服务负责

- Tenant、本地 ExternalPrincipal 与 TenantMembership 权限投影；
- AgentDefinition、SkillDefinition 及版本；
- AgentSession、AgentMessage、AgentRun；
- Workflow 状态、后台执行、暂停与恢复；
- Memory、长期摘要和最近消息窗口；
- 用户可见 ReasoningTrace；
- 附件引用与工具调用记录；
- PromptCard 聚合、不可变 PromptCardRevision 及其嵌套 PromptContent；
- REST 快照与可恢复 SSE 事件流。

### New API 负责

- 统一模型访问；
- 模型能力与白名单；
- 最终用户额度和实际扣费事实。

## 部署决定

1. V1 不引入 Vercel。Vercel 不是 Mastra 的前置条件。
2. 蓝鲸继续沿用当前 Docker / 自有服务器部署方式。
3. 新 Agent 仓库以独立 Docker 常驻服务部署在现有基础设施。
4. V1 可将 Mastra HTTP API 与 Workflow 执行器放在同一服务，规模需要时再拆分。
5. Mastra Agent、Workflow、Storage 和常驻执行 Runtime 共同替代旧 `agent-worker` 的 Agent 编排职责；业务鉴权、资产和计费仍在蓝鲸/New API。

## Tenant 与用户隔离

1. Agent 服务从 V1 引入真实 Tenant 概念，不把 `tenant_id` 等同于 `user_id`；Agent 服务拥有本地 Tenant 资源、资源归属和隔离规则。
2. new-api 仍是 User 身份和账户事实的唯一权威；Agent 服务不保存密码、登录 Token、邮箱、余额或其他账户事实，也不建立第二套账户中心。
3. Agent 服务以 `integration_id + external_user_id` 唯一映射本地 ExternalPrincipal；该身份只能来自蓝鲸 BFF 的可信认证上下文，不能由浏览器自行声明。
4. 每位蓝鲸用户首次可信调用时自动创建一个 Personal Tenant，并自动建立不可由普通接口修改的 owner TenantMembership；Personal Tenant 与用户一一对应，但 `tenant_id` 不等于 `user_id`。
5. V1 不提供成员邀请、角色修改或移除成员接口。
6. 未来同一 User 可以加入一个或多个 Organization Tenant，无需迁移 Personal Tenant 数据；企业成员关系仍由蓝鲸或企业身份系统权威管理，Agent 服务只保存并执行受信任的 TenantMembership 权限投影，不能自行决定谁属于企业。
7. Agent 资源访问同时校验：
   - `integration_id`；
   - `tenant_id`；
   - `external_user_id`；
   - `external_project_id`（Project-bound Session）；
   - 目标资源 ID。
8. 浏览器不能自行声明可信 Tenant/User；这些身份来自蓝鲸 BFF 已认证身份和服务间凭证。

## AgentSession 与 Project

1. 一个 Project 可以拥有多个 AgentSession。
2. V1 UI 直接支持新建、查看历史、切换、自动标题、重命名、归档和删除会话。
3. 一个 AgentSession 创建时绑定以下上下文之一：
   - `blue_whale_project`；
   - `standalone`；它不绑定用户可见 Canvas Project，但 Blue Whale 集成可以另外提供隐藏的 Asset 存储作用域。
4. Session 的上下文绑定创建后不可变，避免历史消息和资产权限被重新解释。
5. 用户界面可提供：
   - **复制**：创建绑定目标 Project 的新 Session；
   - **移动**：复制到目标 Project，然后归档原 Session；
   - **解绑**：复制成 Standalone Session，然后归档原 Session。
6. V1 的复制、移动与解绑只允许同一 Personal Tenant/User 自己的 Project 或 Standalone 上下文之间执行；Organization Tenant 的跨成员数据转移权限另行设计。
7. 复制以源 Session 的正式已提交历史形成一致快照：复制 User/Assistant AgentMessage，以及 PromptCard 和全部 PromptCardRevision；目标侧为 Session、Message 与 Card 创建新身份，并保存 `copied_from_*` 来源。
8. 正式消息中已经存在的图片分析和文字结论属于用户明确转移的正式成果，可以复制；AssetMention 只保留为不可用来源标记，原 Asset、SessionAssetGrant、原图与图片分析缓存不复制，用户必须在目标上下文重新授权。
9. AgentRun、AgentInputBatch、RunEvent、Capability、计费记录和内部审计不复制；SessionBrief 不直接复制，由目标 Session 根据允许复制的正式历史重新生成。
10. 有活动 AgentRun 时禁止复制、移动或解绑，避免复制到流式半成品或不一致状态。
11. 移动与解绑只有在目标 Session 完整创建成功后才归档原 Session；目标创建失败时原 Session 保持不变。

## Session 生命周期

- **归档**：从默认列表隐藏，可恢复；
- **删除**：不可恢复，删除前先取消活动 Run，然后删除 Agent 消息、Run、PromptCard 和附件引用；
- 删除 AgentSession 不删除蓝鲸 Asset 或 TOS 对象；
- 已用于 GenerationJob 的 PromptCard 即使后来删除，蓝鲸仍保留生成时冻结的提示词快照和来源标识；
- V1 不提供回收站。

## Agent 与 Skill

1. 底层从 V1 支持多个、版本化的 AgentDefinition 和 SkillDefinition。
2. V1 UI 只暴露一个默认创作 Agent。
3. 默认 Agent 固定装载至少以下能力：
   - `creative-brief-grilling`：基于信息充分度主动盘问；
   - 图片分析；
   - PromptCard 写作。
4. Session 创建时冻结 AgentDefinition 和 SkillDefinition 版本，运行中的会话不随发布静默改变行为。
5. V1 不开放普通用户上传或编辑 Skill；后续可扩展为系统、Tenant 或用户级配置。
6. 盘问按信息缺口驱动，不使用机械固定问卷；一次优先询问最关键的问题。

## V1 工具范围

V1 只提供两个只读工具族：

1. 读取用户明确授权的附件/图片；
2. 读取蓝鲸传入的最小 Project 上下文。

暂不加入联网搜索。工具采用注册式配置，后续可扩展知识库、搜索和其他业务工具，而不修改 Agent/Workflow 主干。

## Asset 与 TOS

1. TOS 文件本体、蓝鲸 Asset 身份、Project 归属和权限只保留一份，权威仍在蓝鲸。
2. Agent 服务不复制 Asset 表或 TOS 对象，只保存消息上的不可变 AgentMessageAssetMention、Session 级可撤销 SessionAssetGrant，以及受预算约束的分析摘要。
3. 用户在消息中首次明确添加 Asset 时，同时创建 AgentMessageAssetMention 与 SessionAssetGrant；Mention 证明哪条消息附带过该 Asset，Grant 决定后续 Run 是否仍可读取。一次授权可跨多轮使用，不要求每轮重复 `@`。
4. Agent 每次读取原始资产都必须通过蓝鲸受控 Tool/API；蓝鲸实时校验 Tenant、User、Project、Asset 状态和权限后发放短期 TOS 签名 URL。SessionAssetGrant 不能绕过实时校验。
5. 用户可以从 Session 移除 Asset 并撤销 Grant；撤销后禁止再次读取原文件，既有缓存分析不再进入后续模型上下文，但已经正式接纳的历史消息与 PromptCardRevision 不被改写。
6. AgentChatPanel 必须展示当前 Session 的有效素材授权清单，使用户可见 Agent 仍能读取哪些 Asset。
7. Session 复制、移动或解绑不复制 SessionAssetGrant 或缓存分析；历史中的 Mention 只保留为来源事实，在目标上下文中显示为不可用引用，用户必须重新授权。
8. Agent 默认不能扫描整个 Project 素材库。
9. 只有用户在当前 Session 明确选择、拖入或引用的 Asset 才进入可读清单。
10. Project 上下文只给最小文字摘要；不自动把全部 Canvas 内容或所有 Asset 送入模型。
11. Agent 缺少素材时必须向用户请求授权或补充。
12. 蓝鲸和 Agent 可以使用同一 MySQL 基础设施，但 Agent 使用独立 schema/表；双方不直接读写对方业务表，只通过版本化接口通信。

### Standalone Session 的 AgentWorkspaceProject

1. Blue Whale 集成中的 Standalone Session 附件仍由蓝鲸 Asset/TOS 体系唯一管理，Agent 服务不建立第二套附件存储。
2. 蓝鲸为每个 User 最多惰性创建一个隐藏系统用途 Project：`purpose=agent_workspace`；只有首次在 Standalone Session 上传附件时创建，新建空 Session 不创建。
3. AgentWorkspaceProject 从普通 Project 列表隐藏，不能作为 Canvas Project 打开，也不能与现有 `purpose=generation_inbox` 混用。
4. 多个 Standalone Session 可以通过各自独立的 SessionAssetGrant 引用同一 Workspace Asset；跨 Session 不自动授权。
5. 从普通 Project 解绑产生 Standalone Session 时不复制原 Project Asset；旧引用保持不可用来源事实。User 必须重新上传到 AgentWorkspaceProject，或通过未来的显式导入操作创建合法 Workspace Asset。
6. 删除一个 AgentSession 不删除 AgentWorkspaceProject 或其中 Asset；Asset 删除使用蓝鲸独立资产操作，因为其他 Session 可能仍在引用。
7. Agent 服务保持接入产品中立：其他 Integration 可以提供自己的附件适配器和存储作用域，不要求复用蓝鲸 AgentWorkspaceProject。

## PromptContent 与 PromptCard

### 分层

```text
PromptCard                    Agent 服务持久化的稳定卡片身份
  └── PromptCardRevision      不可变卡片版本与来源属性
        └── PromptContent     Agent 创作的嵌套提示词内容
  ↓ 用户带入
GenerationDraft / BottomDock  蓝鲸中的可编辑本地草稿
  ↓ 用户提交
GenerationJob                 蓝鲸冻结的最终生成事实
```

### 权威与包装

1. PromptCard 是聚合根和稳定资源身份，归属一个 AgentSession。
2. PromptCardRevision 是不可变版本，以 `card_id + revision` 唯一标识，记录来源 AgentRun、创建时间、可选生成建议以及完整 PromptContent。
3. PromptContent 是 Agent 真正创作的嵌套值对象，不拥有独立资源 ID 或独立版本号。
4. PromptCard 聚合由 Agent 服务唯一持久化；蓝鲸不复制一张 PromptCard 表。
5. 蓝鲸读取并展示具体 PromptCardRevision；真正创建 GenerationJob 时保存：
   - `source_agent_card_id`；
   - `source_agent_card_version`；
   - 不可变提示词快照；
   - 用户最终确认的模型、比例、尺寸、数量等参数。
6. Agent 可以建议比例、风格或模型策略，但不能替用户锁定最终生成参数。

### 版本与多方案

- “修改现有方案”在同一 PromptCard 下产生新的不可变 PromptCardRevision；
- “再给一个方案”产生新的 PromptCard 身份；
- 一次确认 Run 可以按用户明确要求产出一张或多张完整 PromptCard；
- 同一 Run 产出的多张卡通过 `source_run_id` 查询，不额外建立持久化批次资源；
- 蓝鲸消费 `card_id + revision`，后续卡片修改不改写已生成任务。

### V1 卡片类型

V1 只产出完整、已确认、可带入 BottomDock 的 PromptCard。资料、灵感、图片和品牌信息只作为会话附件或引用存在，不引入第二种“资料卡”。多份资料的融合由 Agent 完成并形成新的完整 PromptCard，不由前端简单拼接字符串。

### 带入输入框

- 带入只创建/更新 GenerationDraft，不自动生成、不自动扣费；
- 空输入框直接填入；
- 有未提交草稿时允许用户选择替换、追加或取消；
- 默认完整 PromptCard 是经过讨论后的一个完整方向，推荐使用替换；
- 多张完整卡片的融合应回到 Agent 生成新卡，而不是无脑追加。

## 明确确认后才能产卡

AgentSession 的交互阶段至少区分：

```text
open
awaiting_clarification
awaiting_final_confirmation
```

SessionPhase 只表达 Agent 当前在等待用户什么：`open` 表示正常开放讨论；另外两种分别表示等待澄清输入和等待最终产卡确认。“正在理解、分析图片、整理信息”等执行活动归 AgentRun 状态与 RunEvent，不属于 SessionPhase；PromptCard 是否已经生成由 PromptCardRevision 表达，不使用额外的 `ready` 阶段。

1. 信息充分不等于获得产卡授权。
2. Agent 必须先总结理解，并等待用户明确确认。
3. 明确确认可来自自然语言，也可来自“生成任务卡”按钮。
4. 普通盘问 Run 只能回复、提问和读取授权附件，不能创建 PromptCard。
5. 任何 PromptCardRevision 提交都必须绑定同一 AgentRun 内已经持久化的 ConfirmationEvidence；没有确认凭证时，即使模型输出了卡片候选也必须拒绝提交。
6. 用户点击“生成任务卡”时，以幂等 `action_id` 创建 `kind=confirm_prompt_card` 的 AgentInputBatch，并为其首次 AgentRun 形成 `kind=ui_action` 的 ConfirmationEvidence；历史中投影为可见操作记录，不伪造用户 AgentMessage。
7. 用户使用自然语言确认时，原文照常保存为 AgentMessage 并进入新的 AgentInputBatch；只有 `input_session_phase=awaiting_final_confirmation` 且该 Run 结构化判定本次输入构成明确确认后，才能形成绑定 `source_message_id` 的 `kind=natural_language` ConfirmationEvidence，并为该 Run 开放 `prompt:write` 提交权限。
8. 自然语言表示拒绝、继续修改或仍有歧义时，不形成 ConfirmationEvidence、不开放 `prompt:write`，继续讨论或澄清。
9. 用户明确确认产卡时始终创建新的 AgentRun，不恢复此前提出总结或确认问题的 Run。
10. 用户仅回答最后一个问题、“看起来不错”、长时间不回复或 Agent 自行判断充分，都不构成产卡确认。
11. AgentInputBatch 创建时冻结 `input_session_phase`；只有 Run 成功提交时才能更新下一 SessionPhase，失败或取消不改变此前阶段。成功生成 PromptCard 后 Session 回到 `open`，允许继续修改、要求新方案或讨论其他方向。
12. 失败重试复用原 AgentInputBatch，但每个新 Run 都必须重新形成属于本 Run 的 ConfirmationEvidence；旧 Run 的 `prompt:write` 授权和 Capability 不得跨 Run 复用。

## AgentRun 状态与并发

AgentInputBatch 表示一次稳定、冻结的用户输入，可以包含一条或多条有序 AgentMessage，或一个显式 UI 操作；AgentRun 表示对该 InputBatch 的一次执行尝试。AgentSession 跨多轮长期存在，Run 不跨越新的用户输入。V1 Run 状态集合：

```text
queued
running
payment_required
completed
failed
cancelled
```

并发规则：

- 一个 AgentSession 同时最多一个活动 AgentRun；
- Run 执行中新消息立即分别持久化为不可变 AgentMessage，并投影为 pending 输入，不隐式取消或修改当前 Run；
- 当前 Run `completed` 后，服务按消息顺序把尚未消费的连续 pending AgentMessage 原子归入一个新的 AgentInputBatch，并自动创建首次 AgentRun；InputBatch 保留有序原文，不把多条消息拼接成一条假消息；
- 当前 Run `cancelled` 后若存在 pending 消息，也自动启动下一 InputBatch，使“停止旧回答”后可以处理用户刚补充的内容；没有 pending 时不创建新 Run；
- 当前 Run `failed` 后暂停 pending 队列，不自动产生新的模型费用；用户可以选择“重试失败任务”，复用失败 InputBatch 创建新 Run并保持 pending 等待，或选择“跳过并继续”，放弃重试并启动 pending InputBatch；
- 当前 Run 处于 `payment_required` 时 pending 保持等待；用户只能充值后恢复当前 Run，或取消当前 Run 后再自动处理 pending；
- pending AgentMessage 永不因 Run 终态或队列选择而删除，只改变是否已经归入 InputBatch；
- AgentInputBatch 与消息的有序关联对 `message_id` 建立唯一约束，保证一条用户消息最多归属一个 InputBatch；InputBatch 创建后冻结，之后到达的消息进入下一 Batch；
- Session 空闲时，通常由当前接纳的一条用户消息原子创建 AgentInputBatch 与首次 AgentRun；
- Agent 提出澄清问题或请求最终确认时，本次 Run 正常完成，并把 AgentSession 分别推进为 `awaiting_clarification` 或 `awaiting_final_confirmation`；用户后续输入创建新 Run；
- `payment_required` 是同一 Run 的可恢复阻断：充值后用户明确继续，为原 Run 发放新 Capability，并从持久化 Workflow checkpoint 恢复；
- 进程崩溃恢复同一个 Run 的内部 Workflow checkpoint，不创建新 Run；
- 只有用户显式停止才取消当前 Run；
- 不允许两个 Run 同时对同一 Session 产出回复或 PromptCard。

## 失败、取消、重试和幂等

1. Worker/进程崩溃后从持久化 Workflow 状态恢复。
2. 模型调用结果无法确认时不自动重复调用，避免重复扣费；Run 进入 `failed`。
3. 用户重试会为同一个冻结 AgentInputBatch 创建新的 AgentRun 和新的 Capability，记录 `retry_of_run_id` 与递增 `attempt_no`；新 Run 继承同一输入与 Session 上下文，但不复用旧 Run 授权。用户修改输入后再次发送会创建新的 InputBatch，不属于重试。
4. 用户取消后撤销 Capability、停止后续步骤；未正式完成的 PromptCard 不产生。
5. 同一确认 Run 最多成功产出一次确定的 PromptCard 批次；重复请求幂等返回首次结果。
6. 用户只看到简短可行动错误；内部保留审计证据。
7. `failed` Run 不自动推进 pending 队列；“重试失败任务”和“跳过并继续”都是需要幂等命令身份的显式用户操作。

## AgentMessage、RunEvent 与正式输出

1. 用户输入被服务接纳后立即成为不可变的正式 AgentMessage；Session 空闲时它与新的 AgentInputBatch、首次 AgentRun 原子创建，Session 忙碌时先作为 pending 输入保存、待活动 Run 结束后再归入下一 InputBatch。后续 Run 失败或取消不得删除、隐藏或改写该用户消息。
2. Assistant 文字与 ReasoningTrace 在执行中通过 RunEvent 流式展示；RunEvent 是 SSE 断线恢复与短期交付记录，不是正式会话消息，也不进入后续模型上下文。
3. Run 成功时，在同一事务中提交完整 Assistant AgentMessage、完整 ReasoningTrace、该 Run 产生的全部 PromptCardRevision、SessionPhase 变化以及 Run `completed` 状态。
4. Run 失败或取消时，半截 Assistant 文字、半截 ReasoningTrace 和未完成 PromptCard 不进入正式会话历史；用户原始消息继续显示，并关联 `failed` 或 `cancelled` 状态、友好错误与重试入口。
5. 内容型 RunEvent 在终态后按保留策略清理；审计只长期保留排障和计费所需的最小元数据，不把失败半成品重新包装成历史消息。

## Memory 与上下文成本

采用：

```text
完整历史消息（用户查看）
+ 版本化 SessionBrief（长期摘要）
+ 最近消息窗口
+ 当前授权附件摘要
+ 当前 pending 输入
```

- 原始历史不因摘要而删除；
- 接近上下文限制时才更新长期摘要；
- 图片本体不在每轮重复发送，优先复用结构化分析结果，除非用户要求重新分析；
- 已撤销 SessionAssetGrant 的 Asset 分析不再进入 SessionBrief、最近消息窗口之外的派生附件上下文或后续模型输入；
- 每个 Run 限制模型调用次数、输入/输出 Token 和总预算。

### SessionBrief 权威边界

1. SessionBrief 是版本化、可重建的内部模型上下文缓存，不是用户确认过的会话事实；正式 AgentMessage 与 PromptCardRevision 才是会话权威。
2. 每个 SessionBrief 版本至少记录 `through_message_sequence`、`source_digest`、`summary_schema_version` 与 `model_policy_version`，明确它总结到哪条消息以及由什么规则生成。
3. 用户当前输入、当前 AgentInputBatch 和最近正式消息始终优先于 SessionBrief；Brief 不得覆盖或改写原始历史。
4. 新版本 Brief 只能使用正式已接纳消息与当前有效 SessionAssetGrant 允许的分析摘要；已撤销 Grant 的派生附件上下文不得进入新版本。
5. Brief 更新使用的模型调用计入当前 AgentRun 的 Capability 和预算；生成失败不得产生错误的正式消息，可以继续使用仍有效的旧 Brief 加最近消息窗口，或在后续 Run 重建。
6. Session 复制不复制旧 Brief，由目标 Session 根据允许转移的正式历史重新生成。
7. V1 不把 SessionBrief 作为用户可编辑卡片展示；用户纠正上下文时通过新的正式 AgentMessage 表达。

## 模型策略

1. V1 用户不直接选择 Agent 模型。
2. 系统通过版本化 ModelPolicy 从 New API 白名单选择模型。
3. 后续必须可扩展：
   - Tenant/套餐策略；
   - 质量、成本、速度偏好；
   - 高级用户有限模型选择；
   - 纯文本与图片理解分别选择模型。
4. 用户输入不能直接把任意 `model_id` 透传给 Agent 或 New API。

## 模型调用、授权与计费

### 固定调用链

所有 Agent 模型调用统一走 New API，不直连外部模型供应商：

```text
Mastra Agent
  → 蓝鲸 Internal Agent Model Gateway
  → New API
  → 模型供应商
```

### 凭证原则

- Mastra 不保存、不接收用户 `sk-*`；
- Mastra 不持有 New API Root Token；
- 浏览器只访问蓝鲸同源 BFF；
- Agent 服务调用蓝鲸内部接口时使用双层授权：
  1. Agent 服务身份凭证；
  2. Redis 中的 Run-scoped Capability。

### Run-scoped Capability

Capability 至少绑定：

- Tenant、User、Project、Session、Run；
- 允许的 scope 与模型集合；
- 最大模型调用次数；
- 最大输入、输出和总 Token；
- 过期时间；
- `active / revoked / exhausted` 状态。

Redis 只保存原始 Capability 的摘要和授权记录，不保存原始 Key。用户取消 Run 后立即撤销；Capability 不得跨 Run、Session 或 Project 重放。

### 防白嫖与余额不足

- 每个 AgentRun 发放独立短期 Capability，不给 Session 长期模型权限；
- 蓝鲸在运行前校验额度，内部网关在每次模型调用前原子消费 Capability 预算；
- New API 是最终扣费权威，Redis 预算只是前置护栏；
- 同时执行 User、Tenant 和来源级限流与并发上限；
- 余额不足或运行中预算耗尽时进入可恢复 `payment_required`；
- 不自动切换便宜模型，不由企业垫资；
- 用户充值后明确点击继续，发放新 Capability 并从持久化 Workflow 恢复；
- 已经成功并收费的步骤不重复执行。

## 用户可见 ReasoningTrace

V1 提供 Codex 式、可流式、可折叠、可持久化的 ReasoningTrace：

- 展示 Agent 专门生成的可读思考摘要和运行状态；
- 当前轮执行时展开，历史轮默认折叠；
- 不等同于模型原始隐藏推理；
- 不展示系统提示词、密钥、Capability、完整 Tool 参数或内部错误堆栈。

## REST 与 SSE 契约

采用版本化 REST 快照 + 可恢复 SSE：

```text
POST /v1/sessions
GET  /v1/sessions
POST /v1/sessions/{id}/messages
GET  /v1/runs/{id}
POST /v1/runs/{id}/cancel
POST /v1/runs/{id}/retry
POST /v1/sessions/{id}/archive
POST /v1/sessions/{id}/copy
GET  /v1/runs/{id}/events?after=<sequence>
```

SSE 事件信封包含 `event_id`、单调递增 `sequence`、`type`、`run_id` 与 `data`。核心事件至少包括：

- `run.status_changed`；
- `message.delta` / `message.completed`；
- `reasoning.delta`；
- `tool.status_changed`；
- `prompt_card.created`；
- `run.payment_required`；
- `run.failed`。

断线后以最后事件序列恢复；V1 不使用 Agent → 蓝鲸 webhook。浏览器不直连 Agent 服务，由蓝鲸 Next.js BFF 代理 REST 与 SSE。

## 审计与可观测性

V1 必须提供 Run 级审计和端到端 Trace：

- `trace_id` 贯穿蓝鲸、Agent、内部模型网关和 New API；
- 记录 Tenant/User/Project/Session/Run、Capability 摘要、ModelPolicy 版本；
- 记录状态迁移、模型调用次数、Token/费用结果、Tool 名称与成败；
- 用户只查看自身状态与友好错误；管理员审计接口必须受权限保护；
- 日志禁止记录用户 `sk-*`、原始 Capability、TOS 签名 URL、系统提示词和原始隐藏推理。

## 与现有领域文档的已知冲突

本节只记录迁移后必须处理的冲突，不在讨论中直接改写当前生产领域定义。正式 ADR 接纳前，现有 `CONTEXT.md` 与 Accepted ADR 仍描述当前系统。

1. **运行拓扑**：`CONTEXT.md` 与 ADR-0068 当前把 Next.js、`agent-worker`、`generation-worker` 定义为同一模块化单体的多进程入口；新方案把 Agent 拆到独立仓库与独立服务，必须显式修订或 Supersede。
2. **Worker 保留决定**：ADR-0059 明确保留独立 Node `agent-worker`；新方案决定退役它，必须显式 Supersede 对应条款。
3. **会话归属与数量**：当前 `Conversation` 定义普通 Canvas Project 只有唯一 AgentChatPanel 消息流，且消息归蓝鲸 Product API；新方案允许一个 Project 多个 AgentSession，且会话历史权威迁移到 Agent 服务。
4. **AgentRun 权威**：当前 `AgentRun`、`AgentAdvance`、`RunCommit`、RunPin、Lease 和 RuntimeManifest 都是蓝鲸产品模型；新方案退役自研 Agent 执行后，哪些概念删除、哪些映射到 Mastra Workflow、哪些仅保留为历史数据，必须在迁移 ADR 中逐项说明。
5. **计划产物**：当前 AgentChatPanel 产出蓝鲸持久化 `PlanMessage` 并可直接应用；V1 新方案产出 Agent 服务权威的 PromptCard，先带入 BottomDock 草稿，不自动应用或生成。旧 Agent 路径的 PlanMessage 语义不能静默沿用。
6. **思考展示**：ADR-0071 与当前 `ThinkingTrace` 定义要求展示并持久化模型原始思维链；新方案只展示 Agent 专门生成的用户可见 ReasoningTrace，不等同于原始隐藏推理，必须显式修订或 Supersede。
7. **模型选择**：当前 AgentChatPanel 已接入能力表驱动的模型选择；新方案 V1 由系统 ModelPolicy 选模型、UI 不直接选，未来才开放受限选择。迁移时必须处理现有入口和契约。
8. **AssetMention 授权周期**：当前 `CONTEXT.md` 只允许本轮冻结 UserMessage 上的 AssetMention 放行该 AgentRun 读取，历史引用不会自动延续；新方案新增可撤销 SessionAssetGrant，使一次明确授权可跨多轮使用。迁移 ADR 必须显式取代旧的逐消息读取放行语义，同时保留每次原始 Asset 读取的蓝鲸实时验权。
9. **隐藏 Agent Workspace**：当前领域只有 `purpose=generation_inbox` 的隐藏系统 Project；新方案为 Standalone Session 新增独立 `purpose=agent_workspace`，必须在迁移 ADR 中定义其创建、隐藏、Asset 生命周期和与 GenerationInbox 的边界。
10. **AgentChatPanel 职责**：当前 AgentChatPanel、GenerationInbox、PlanMessage、Creative Skill 与生成入口之间有既定职责；新方案目前只明确了 Canvas PromptCard 主路径，其他入口不能被默认视为已经迁移。

## 待验证与未决项

以下内容尚未确认，不得被视为已经决定：

1. 拉取 Mastra 官方代码/Starter 后验证当前版本对持久化 Workflow、暂停/恢复、Storage、SSE 和后台执行的精确支持方式。
2. New API 是否已有正式的“服务代表真实 User 调用并计费”的接口；若没有，需要先冻结并实现内部委托调用契约。
3. Agent 独立仓库名称、包结构、Mastra/Node 精确版本和数据库 schema 名称。
4. Redis 的现有基础设施、持久化策略和故障模式。
5. 独立 Agent Docker 的生产部署位置、实例数和扩缩容策略。
6. PromptContent/PromptCard 的精确 JSON Schema 与 BottomDock 字段映射。
7. 旧 Agent 数据是否全部舍弃，以及切换窗口和回滚策略。
8. 最终 ADR 的拆分方式，以及对现有 `CONTEXT.md`、Agent 相关 ADR 的 Supersede 清单。
9. **Creative Skill 迁移**：当前 Official/Personal Creative Skill、`Use`/`auto`、对话总结技能和已发布 Skill 资产，是迁入新 Agent 服务、保留为蓝鲸 Tool，还是 V1 暂时退役。
10. **GenerationInbox 范围**：V1 新 Agent 是否只接 Canvas AgentChatPanel，还是同时替换 `/generate` 的独立 Conversation 与 Agent 入口。
11. **组织 Tenant 权限**：V1 只有 Personal Tenant；未来 Organization Tenant 中 Session 默认私有还是 Project 成员共享、角色如何控制复制/删除/产卡，尚未定义。

## 复核结论

截至 2026-08-11 本次复核：已确认的对话结论均已进入本文；此前发现的 Run 粒度矛盾已经用户确认解决为「Session 跨多轮、Run 对应一次用户动作、确认产卡新建带 `prompt:write` 权限的 Run」。本文现在是完整的「已确认决策 + 明示未决项」记录，但仍不是完整实施规格。后续每次确认新决定，都应立即更新本文并再次检查是否影响已确认项或现有 ADR。

## 下一步

1. 继续完成核心数据模型、Workflow、接口、错误处理和迁移设计确认；
2. 只读拉取/检查 Mastra 官方代码与文档，验证框架能力；
3. 将确认后的方案形成正式设计规格；
4. 更新领域词汇并创建必要 ADR；
5. 用户审核规格后，再创建独立 Agent 仓库和实施计划。
