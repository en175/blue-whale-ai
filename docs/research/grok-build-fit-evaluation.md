# Grok Build 对 Blue-Whale Agent 创作后端的可借鉴性评估

> 调研问题：xAI 开源的 Grok Build 能否在不接管产品领域模型与公开 API 的前提下，作为 Blue-Whale Agent 创作后端的基础？哪些 Agent 工程设计值得借鉴、哪些不适合照搬？如何转译为 Blue-Whale 自有后端架构？受限 Spike 应验收什么？
> 本文只做架构借鉴与落地边界评估，不实施集成。
> 触发工单：[评估 Grok Build 对 Blue-Whale Agent 后端的可借鉴性](https://e.gitee.com/hangzhou_xuanfu_1/projects/883843/requirements/list?issue=IK1H93)。

> 评估对象：[`xai-org/grok-build`](https://github.com/xai-org/grok-build)
>
> 关联 Blue-Whale 对象：`blue-whale-agent-workspace`、Agent 对话后端、Canvas、Asset、GenerationJob、AgentRun、确认门、Skill 库与 Prompt Optimizer。

## 结论（TL;DR）

**不建议把 Grok Build 作为 Blue-Whale Agent 后端的直接运行时。**

Grok Build 是面向代码库操作的终端 AI coding agent，核心对象是 session、文件、命令、代码编辑、工具调用、沙箱、权限与工作区恢复。Blue-Whale 的核心对象是 Project、Canvas、Asset、GenerationJob、AgentRun、视频/图片生成链路、自然语言确认门和创作 Skill。

二者同属 Agent 系统，但产品语义不同。Grok Build 不应反向定义 Blue-Whale 的后端对象和状态机。

**推荐路线：**

1. Blue-Whale 继续以自有 `Project / AgentRun / GenerationJob / Asset / Canvas Node / Confirmation Gate` 为唯一产品语义权威。
2. Grok Build 仅作为 Agent 工程化参考，重点借鉴：Plan Mode、Tool Layer、权限审批、Hooks、Skills / Plugins、Headless、Session、Sandbox、Background Tasks、Subagents。
3. 后端实现时，把 Grok Build 的"可控 Agent"思想转译成 Blue-Whale 的生成授权门、工具端口、事件流、状态恢复和执行审计。
4. 不接入 Grok Build TUI，不复用其代码 Agent 的 session / workspace / file checkpoint 模型作为产品数据库。
5. 先做一个受限 Spike，验证 Blue-Whale 自有 AgentRun 能否稳定承接"计划、工具调用、长任务、确认门、恢复"这几类能力。

一句话：**Grok Build 值得学的是"如何把 Agent 工程化管住"，不是它的终端界面，也不是它的代码 Agent 业务模型。**

## 1. 评估基线

### 1.1 Grok Build 能力基线

根据 Grok Build README 和用户指南，它是 SpaceXAI 的终端 AI coding agent，具备以下特征：

- 全屏 TUI，可理解代码库、编辑文件、执行 shell 命令、联网搜索、管理长任务。
- 支持交互式 TUI、headless 脚本 / CI、ACP 编辑器嵌入。
- Rust 实现，仓库包含 CLI / TUI 与 agent runtime。
- 目录分层包括：
  - `xai-grok-pager`：TUI。
  - `xai-grok-shell`：Agent runtime、leader / stdio / headless 入口。
  - `xai-grok-tools`：终端、文件编辑、搜索等工具。
  - `xai-grok-workspace`：本机文件系统、VCS、命令执行、checkpoints。
  - 其他 config、MCP、markdown、sandbox 等 crate。
- 用户指南覆盖：MCP、Skills、Plugins、Hooks、Headless、Agent Mode、Subagents、Sessions、Sandbox、Plan Mode、Background Tasks、Permissions。

### 1.2 Blue-Whale 后端语义基线

Blue-Whale Agent 后端的核心不是"操作代码库"，而是"协助用户完成图片 / 视频创作"。

现有 `blue-whale-agent-workspace` 已形成以下设计基线：

- **双入口**：
  - BottomDock 直生：要快，纯参数透传，零 Agent 编排。
  - Agent 对话：要好，走 decision_context、Prompt Optimizer、图像理解、确认门和生成任务。
- **核心对象**：
  - Project：顶层工作区。
  - Canvas：用户可见事实来源。
  - Asset：图片 / 视频文件实体。
  - GenerationJob：异步生成任务。
  - Canvas Node：画布上的 image / video 素材节点。
  - AgentRun / Agent Turn：Agent 编排过程。
- **关键规则**：
  - 后端先算 `decision_context`。
  - 主 Agent 只按 `decision_branch` 收口。
  - Prompt-only 不启 GenerationJob，不写 Canvas。
  - Provider 调用前必须有 `optimized_prompt`。
  - 图生图 / 图生视频前必须有 `asset_understanding`。
  - 确认门必须由后端铁闸实现，不能只靠 LLM 自觉。

### 1.3 评估范围

本文不评估 Grok Build 的代码质量、安装体验或模型效果。

本文只回答：

- Grok Build 哪些 Agent 工程设计值得 Blue-Whale 后端借鉴？
- 哪些部分不适合照搬？
- Blue-Whale 应如何把这些设计转译为自己的后端架构？
- 做 Spike 时应验收什么？

## 2. Grok Build 能力画像

### 2.1 Plan Mode：先计划，后执行

Grok Build 的 Plan Mode 是一个结构化规划阶段。Agent 会先阅读和搜索代码库、形成实施方案、写入 plan 文件，再等待用户批准。Plan Mode 下除计划文件外，其他文件编辑会被拒绝。

这体现了一个关键工程原则：

> 高风险或高不确定任务，不应让 Agent 直接执行；应先形成可审查计划，再进入实施。

对 Blue-Whale 的对应价值：

- Full Canvas 不应从用户一句需求直接进入视频生成。
- Brief、分镜、首批视觉、视频生成前都应有计划或阶段结果。
- 高成本 Provider 调用前必须经过确认门。
- Agent 的"计划"应是产品对象，不是临时聊天文本。

### 2.2 Tool Layer：把真实动作封装为工具

Grok Build 内置工具包括文件读取、搜索、编辑、终端命令、Web 搜索、任务列表、子 Agent、记忆搜索等。Agent 不直接操作系统，而是通过工具层发起动作，工具层再受权限、Hook、沙箱约束。

对 Blue-Whale 的对应价值：

Blue-Whale 后端也应把真实动作封装为明确工具或服务端端口，例如：

- `classify_intent`
- `select_skill`
- `understand_asset`
- `draft_prompt`
- `optimize_prompt`
- `create_generation_job`
- `update_canvas_node`
- `advance_stage`
- `record_product_context`
- `recover_active_jobs`

关键边界：

- Agent 负责提出意图和组织用户可见解释。
- 工具负责执行确定性动作。
- 后端铁闸负责决定能不能执行。
- 产品数据库负责保存事实。

### 2.3 Permissions：工具调用要经过授权链

Grok Build 的工具调用授权不是单点判断，而是多层链路：

1. PreToolUse Hook 可先阻断。
2. deny / ask / allow 规则按优先级判断。
3. 已记住的授权可复用。
4. 内置只读操作可自动通过。
5. permission mode 决定最终是提示、自动批准还是自动拒绝。

这套机制对 Blue-Whale 的启发是：生成授权也应是链式判断，而不是一句"用户说继续"。

Blue-Whale 可以转译为：

1. 生成前 Hook / Guard：检查素材、版权、成本、模型能力。
2. 产品规则 deny：无 ready node、无 understanding、无 optimized_prompt 时拒绝推进。
3. ask：高成本视频生成、跨产品切换、消耗较高的重试需要明确确认。
4. allow：低成本 Brief、低成本视觉探索可用弱继续推进。
5. mode：未来可支持"创作草稿模式 / 严格确认模式 / 企业成本保护模式"。

### 2.4 Hooks：生命周期切点

Grok Build 的 Hooks 可以在 SessionStart、UserPromptSubmit、PreToolUse、PostToolUse、Stop、SubagentStart 等节点执行脚本或 HTTP 回调。PreToolUse 可阻断危险动作，PostToolUse 可做日志、通知和自动格式化。

对 Blue-Whale 的对应价值：

Blue-Whale 后端应设计 Agent 生命周期事件，而不是只做一个大函数：

- `agent_turn_started`
- `decision_context_built`
- `before_tool_call`
- `after_tool_call`
- `before_generation_job_create`
- `generation_job_started`
- `generation_job_done`
- `canvas_node_updated`
- `before_stage_advance`
- `agent_turn_done`
- `agent_turn_failed`

其中部分 Hook 可用于：

- 成本预算检查。
- Provider 限流。
- 内容安全检查。
- 生成失败审计。
- Prompt / Provider 参数留档。
- 质量评分与回放。

### 2.5 Skills：可复用任务程序

Grok Build 的 Skill 是一个包含 `SKILL.md` 的目录，用于捕获可复用流程。它有名称、描述、触发条件、可用工具、可手动调用，也可由模型按描述自动触发。

对 Blue-Whale 的对应价值：

Blue-Whale 的 Skill 库更像"创作策略包"，而不是简单提示词。可借鉴 Grok Build 的这些原则：

- 每个 Skill 必须有明确 metadata。
- 每个 Skill 必须说明适用场景和触发条件。
- Skill 应保持聚焦，一类创作套路一个 Skill。
- Skill 可被用户手动 Use，也可被 auto 推荐。
- Skill 应可被 inspect / list / enable / disable。
- Skill 不直接越权创建 GenerationJob，只影响创意结构和提示词生成。

不应照搬的是：

- Grok Build Skill 偏代码任务流程，Blue-Whale Skill 偏创作策略。
- Blue-Whale Skill 必须受产品状态机约束，不能因自动触发就跳过 Brief、分镜或确认门。

### 2.6 Plugins：能力包安装与信任模型

Grok Build Plugin 可打包 Skills、Slash Commands、Agents、Hooks、MCP server、LSP server，并有信任模型。项目级插件需要显式 trust，未信任的插件不会激活可执行组件。

对 Blue-Whale 的对应价值：

未来 Blue-Whale 可以把以下能力打包为"创作插件"或"行业包"：

- 电商商品图插件。
- UGC 广告插件。
- 短剧分镜插件。
- 品牌片插件。
- 平台投放规格插件。
- Provider 适配插件。

但 Blue-Whale 的插件信任边界应更严格：

- 第三方 Skill 不得直接调用 Provider。
- 第三方 Hook 不得绕过成本和确认门。
- 插件输出必须归一化为内部 `SkillRecommendation / PromptDraft / StagePlan`。
- 插件不能定义产品数据库 schema。

### 2.7 Headless：无界面运行

Grok Build 支持 `grok -p` headless 模式，可用于脚本、CI 和自动化，并支持 JSON / streaming-json 输出。

对 Blue-Whale 的对应价值非常高：

Blue-Whale 后端 AgentRun 必须天然 headless：

- 前端页面关闭后，GenerationJob 继续跑。
- SSE 断开后，后端继续维护 AgentRun。
- 用户刷新页面后，可从 Project 恢复 Canvas、messages、active_jobs。
- AgentRun 不应依赖浏览器内存或 WebSocket 连接存活。
- 可用内部脚本回放 AgentRun 做测试。

### 2.8 Sessions：持久化、恢复、压缩与回放

Grok Build 会自动保存 session，包含用户输入、Agent 响应、工具调用、TODO 状态、文件快照、token 使用、子 Agent session。`updates.jsonl` 是权威 conversation log，可用于 resume。它还支持 compact、rewind、fork、worktree session。

对 Blue-Whale 的对应价值：

Blue-Whale 也需要类似机制，但对象要换成产品语义：

| Grok Build | Blue-Whale 对应 |
|---|---|
| Session | AgentRun / Conversation |
| updates.jsonl | agent_events / turn_events |
| File snapshot | Canvas snapshot / stage snapshot |
| Rewind | 回到某个创作版本 / 恢复某个 Canvas 状态 |
| Compact | conversation_summary / product_history_summary |
| Fork session | 基于当前 Canvas 开新方向 |
| Worktree | 创作分支 / 版本分支 |

关键判断：

Grok Build 的 session 存储格式可以借鉴，但不能直接作为 Blue-Whale 的产品真相源。Blue-Whale 需要数据库里的 Project、Asset、GenerationJob 和 Canvas 状态作为权威，事件日志用于回放和审计。

### 2.9 Sandbox：执行隔离

Grok Build 的 Sandbox 使用 OS 级机制限制文件系统和网络访问。它支持 workspace、read-only、strict 等 profile，也支持 deny 列表。

Blue-Whale 不需要照搬"文件系统沙箱"，但需要同级别的能力沙箱：

- Provider 调用沙箱：哪些模型可用、最大成本、最大并发。
- Asset 访问沙箱：Agent 只能访问当前 Project / 当前用户有权访问的素材。
- Prompt 沙箱：不把内部 prompt、工具参数、系统指令泄露给用户。
- 插件沙箱：第三方 Skill / Hook 不得越权调用生成或读取不相关资产。
- 网络 / 外部服务沙箱：MCP、素材库、检索服务必须按白名单接入。

### 2.10 Background Tasks：长任务不阻塞主会话

Grok Build 支持 background command、task_id、查询输出、等待多个任务、终止任务、monitor 和 scheduler。

这与 Blue-Whale 的 GenerationJob 高度相关：

- 生图 / 生视频天然是长任务。
- Agent 对话不能阻塞在 Provider 完成前。
- 需要 job_id 和状态查询。
- 需要 SSE 事件流。
- 需要 active_jobs 恢复。
- 需要失败、重试、部分成功和结果回画布。

可借鉴点：

- 启动长任务后立即返回 ID。
- 后续通过事件 / 查询拿状态。
- 多任务状态集中管理。
- 前台对话和后台任务解耦。
- 任务完成后产生通知 / canvas_update。

不应照搬点：

- Grok Build 背景任务是命令 / 子 Agent 进程。
- Blue-Whale 背景任务是 Provider Job 和资产生成，需要更强的产品状态机。

### 2.11 Subagents：并行子任务

Grok Build 支持 spawn subagent，并在 session / tasks pane 中管理。

Blue-Whale 已经有 Director + Brief / Skill / Image Understanding / Prompt / Storyboard / Generation / Review 的多 Agent 分工。这一点与 Grok Build 思路一致。

建议边界：

- 子 Agent 不应该是自由对话进程。
- 子 Agent 应是受限 worker，输入输出有 schema。
- Director 只调度，不亲自写完整分镜、提示词或审核结论。
- 子 Agent 输出必须经 Director 收口，再进入用户可见消息或后端工具。

## 3. 可借鉴点总表

| Grok Build 设计 | Blue-Whale 可借鉴方式 | 优先级 |
|---|---|---:|
| Plan Mode | Full Canvas / 高成本视频生成前计划与确认 | P0 |
| Permission Chain | 生成授权门、确认门、成本控制 | P0 |
| Tool Layer | Provider、Prompt、Asset、Canvas 操作端口化 | P0 |
| Headless Mode | AgentRun 脱离前端连接独立运行 | P0 |
| Background Tasks | GenerationJob 长任务模型 | P0 |
| Session Persistence | AgentRun 事件日志、恢复、回放 | P0 |
| Hooks | 生命周期切点、审计、内容安全、成本检查 | P1 |
| Skills | 创作策略包标准化 | P1 |
| Plugins | 行业包 / Provider 包 / 团队能力包 | P2 |
| Sandbox | 工具、素材、Provider、插件权限隔离 | P1 |
| Subagents | 多 Worker 分工与并行执行 | P1 |
| Compact | 长对话摘要、产品历史压缩 | P1 |
| Rewind / Fork | 创作版本恢复和方向分支 | P2 |
| ACP / Editor integration | 暂无直接价值，除非未来做开放 Agent 协议 | P3 |
| TUI | 不建议借鉴为主产品形态 | 不采用 |

## 4. Blue-Whale 最值得深入学习的 Grok Build 工程机制

本章从“源码学习清单”角度补充：哪些 Grok Build 机制值得 Blue-Whale 后端深入拆解，应该学什么，如何转译到视频 / 图片创作后端，以及哪些部分不能照搬。

### 4.1 工具系统：从“模型直接做事”改成“模型调受控工具”

Grok Build 的工具系统有一个核心思想：Agent 不直接修改真实世界，而是通过工具层执行动作。文件读取、搜索、编辑、命令执行、Web 检索、任务管理、子代理、MCP 工具都被封装成明确工具，工具描述、权限、错误恢复和上下文注入都有统一管线。

Blue-Whale 应重点学习的不是具体工具名，而是这套分层：

```text
Agent 意图
  -> 工具调用请求
  -> 权限 / 状态 / 成本校验
  -> 业务服务执行
  -> 结构化结果
  -> Agent 收口给用户
```

对应到 Blue-Whale，P0 工具层至少应包含：

| Blue-Whale 工具 | 职责 | 不能让 LLM 自由发挥的点 |
|---|---|---|
| `understand_asset` | 调视觉模型，生成 asset_understanding | 不能假装看懂图片 |
| `select_skill` | 从 Skill 库选择创作套路 | 不能绕过用户手动 Use 或 auto 设置 |
| `optimize_prompt` | 生成 provider 可用 prompt 和用户友好 preview | 原始 optimized_prompt 不能直接展示 |
| `authorize_generation` | 判断是否允许创建 GenerationJob | 高成本、无素材理解、无 prompt 时必须阻断 |
| `create_generation_job` | 创建异步生成任务 | 不能由 Agent 直接写 job 状态 |
| `update_canvas_node` | 创建 / 更新 image 或 video 节点 | Canvas 只承载素材，不承载过程消息 |
| `advance_stage` | 推进 workflow stage | 必须独立校验 ready node |
| `append_agent_event` | 写入事件日志 | 用于恢复、审计和回放 |

建议后端实现一个内部 `AgentHarnessPort`，让 Director 只能通过端口调用能力。这样做的直接收益是：

- 每个工具可以单测。
- 真实 Provider 可以替换为 Fake Provider。
- Spike 可以不依赖真实生图 / 生视频成本。
- 工具错误可以结构化返回，减少 Agent 重试时乱猜。
- 后端可以在工具层统一做日志、权限、成本和审计。

不应照搬 Grok Build 的部分：

- 不照搬文件编辑、shell 命令、Git 操作作为核心工具。
- 不把 Blue-Whale 的 Canvas / Asset 当成文件系统。
- 不让 Tool call 状态直接等于产品状态。
- 不让 LLM 直接决定数据库最终写入。

### 4.2 上下文压缩：把“长对话”变成可恢复的产品状态

Grok Build 的上下文压缩不是简单摘要，而是把长会话拆成几类信息：确定性重注入的规则 / 环境 / 当前任务状态，以及由模型总结的历史叙述。它特别重视最后一条用户请求、项目规则、当前工作状态、后台任务和 TODO 的保留。

Blue-Whale 的长对话也会遇到同类问题：

- 用户在一个 Project 里连续做多个产品方向。
- 同一产品经历 Brief、Skill、分镜、首批视觉、视频、修改和重试。
- 用户会说“刚才那个”“上一版”“用前面的产品”“继续做这个方向”。
- 前端断线或刷新后，需要恢复 AgentRun 和 active_jobs。
- 上下文太长时，不能把所有历史消息都塞给模型。

Blue-Whale 应把上下文拆成三层，而不是只做聊天摘要：

| 层 | 内容 | 谁是权威 |
|---|---|---|
| 产品事实 | Project、Canvas、Asset、GenerationJob、Stage、confirmed node | 数据库 |
| 编排状态 | AgentRun、current_stage、awaiting_confirm、pending intent、active_jobs | 后端状态机 |
| 历史叙述 | 用户偏好、产品历史摘要、已放弃方向、对话脉络 | 可由 LLM 总结 |

建议新增或明确以下对象：

```text
conversation_summary
product_history_summary
agent_run_snapshot
stage_snapshot
active_jobs_snapshot
last_user_intent_during_generation
```

压缩时必须确定性保留：

- 当前 Project ID。
- 当前 active_product_context。
- 当前 stage 和确认门状态。
- 当前 Canvas ready / generating / failed 节点。
- active_jobs。
- 用户最近一次明确修改意图。
- 已确认的 Skill / Brief / Storyboard。

可以交给 LLM 总结：

- 用户偏好的风格。
- 多轮沟通中的非关键描述。
- 已完成方向的自然语言摘要。
- 放弃过的产品方向及原因。

不应照搬 Grok Build 的部分：

- 不用文件快照替代 Canvas snapshot。
- 不把压缩摘要当产品事实。
- 不允许摘要覆盖数据库里的 confirmed node、Asset、GenerationJob。
- 不依赖模型总结来判断是否可以确认或推进阶段。

### 4.3 权限与安全：把确认门升级成生成授权系统

Grok Build 的权限系统值得学习的地方是“多层阻断”，而不是某个具体权限模式。它不是只问用户 yes / no，而是把 Hook、规则、记住的授权、内建只读判断和 prompt policy 组合成一条授权链。

Blue-Whale 也需要一条生成授权链：

```text
before_generation
  -> 资源归属检查
  -> 素材理解检查
  -> prompt 完整性检查
  -> stage / confirmation 检查
  -> 成本与并发检查
  -> provider 能力检查
  -> allow / ask_user / deny
```

建议把现有确认门扩展为两个层次：

| 层 | 职责 | 示例 |
|---|---|---|
| Confirmation Gate | 用户是否确认当前阶段结果 | ready node 才能确认，弱继续不直接推进高成本阶段 |
| GenerationAuthorizationGate | 是否允许创建 GenerationJob | 无 optimized_prompt、无 asset_understanding、成本超限时拒绝 |

最低限度规则：

- 没有 `ready` 或 `awaiting_confirm` 节点：不能确认。
- 节点 `generating`：不能确认。
- 用户弱继续：低成本阶段可推进，高成本视频必须二次确认。
- Agent 链路创建 GenerationJob 前必须有 `optimized_prompt`。
- 图生图 / 图生视频前必须有 `asset_understanding`。
- 当前用户无 Asset 权限：拒绝。
- generating 中用户要求新任务：不并行，记录 pending intent。
- provider 参数不合法：拒绝或请用户修改。
- 生成失败：必须写 failed node 和 error message。

对 Blue-Whale 来说，权限与安全还包括成本安全：

- 单 Job 最大成本。
- 单 Project 并发 Job 上限。
- 单用户每日生成上限。
- 高成本模型二次确认。
- 重试只重试失败输出，不重复消耗成功输出。

不应照搬 Grok Build 的部分：

- 不把 shell 命令 allow / deny 语义直接迁移到视频生成。
- 不把“always approve”做成默认创作模式。
- 不让用户一次授权变成后续所有高成本生成的空白支票。
- 不让 Hook 崩溃时默认放行高成本 Provider 调用。

### 4.4 Sessions / Background Tasks：让 AgentRun、GenerationJob、Project 可恢复

Grok Build 的 Session 和 Background Tasks 对 Blue-Whale 很有参考价值。它把会话更新保存为可恢复日志，并把长任务从前台对话里解耦出来。Blue-Whale 的生成任务天然更需要这套思想，因为图片 / 视频生成比代码命令更慢、更贵、更容易失败。

Blue-Whale 应把这两个机制转译为：

| Grok Build | Blue-Whale |
|---|---|
| Session | AgentRun / Conversation |
| updates.jsonl | agent_events / turn_events |
| Rewind point | Canvas / Stage snapshot |
| Background command | GenerationJob |
| Task output | Asset + Canvas Node |
| Resume session | Project 恢复 + AgentRun 恢复 |
| Compact session | conversation_summary + product_history_summary |

P0 必须做到：

- `POST /agent/turn` 返回前后，关键事件都写入 agent_events。
- GenerationJob 创建后不依赖 SSE 连接存活。
- 前端刷新后，`GET /projects/{id}` 能恢复 Canvas、messages、active_jobs。
- Job 完成后必须能把 Asset 吸收到 Canvas。
- Job 失败后必须能展示 failed node 和 error message。
- 用户在生成中表达的新意图要记录，生成完成后能接上。

建议事件流最少包含：

```text
turn_started
decision_context_built
branch_selected
tool_call_started
tool_call_done
generation_authorized
generation_job_created
generation_job_progress
generation_job_done
canvas_node_updated
confirmation_waiting
stage_advanced
turn_done
turn_failed
```

SSE 只是一种传输方式，不应该是事实来源。正确关系是：

```text
数据库状态 / agent_events 是事实
SSE 是把事实变化推给前端
前端断线后通过 Project 恢复事实
```

不应照搬 Grok Build 的部分：

- 不用本地 session 目录作为产品存储。
- 不让对话日志替代结构化表。
- 不承诺 Provider Job 一定可取消。
- 不把“后台任务完成”直接等同于用户确认。

### 4.5 Skills / Hooks / Plugins：先内部标准化，再开放扩展

Grok Build 的 Skills、Hooks、Plugins 说明了一个成熟 Agent 系统如何扩展能力：Skill 提供可复用流程，Hook 插入生命周期，Plugin 打包能力并带有信任边界。

Blue-Whale 可以借鉴这个方向，但要分阶段做。

P0 应先做好内部 Skill 标准：

```text
skill_id
name
description
applicable_scenes
required_inputs
output_contract
prompt_rules
example_inputs
example_outputs
risk_notes
```

每个 Skill 的职责应该是：

- 定义创意结构。
- 定义适用场景。
- 提供分镜 / 画面 / 卖点表达套路。
- 影响 Prompt Optimizer 的创意输入。

Skill 不应该：

- 直接调用 Provider。
- 直接创建 GenerationJob。
- 直接改 Canvas。
- 跳过 Brief、图像理解或确认门。
- 替用户确认结果。

Hooks 可以作为 P1 能力加入，优先放在这些节点：

| Hook | 用途 |
|---|---|
| `before_skill_select` | 限制行业 Skill、按用户权限过滤 |
| `after_skill_select` | 记录推荐理由，供调试 |
| `before_prompt_optimize` | 注入平台规则、品牌限制 |
| `after_prompt_optimize` | 检查敏感词、版权、格式 |
| `before_generation_job_create` | 成本、素材、权限、模型能力检查 |
| `after_generation_job_done` | 质量评估、自动 review、失败归因 |
| `before_stage_advance` | 确认门铁闸 |

Plugins 建议放到 P2，不要过早做开放生态。可以先内部模拟插件包：

- 电商商品图包。
- UGC 广告包。
- 短剧分镜包。
- 品牌片包。
- 平台投放规格包。
- Provider 适配包。

插件化前必须先解决：

- Skill 输出 schema。
- 插件信任边界。
- Hook 是否可阻断。
- 插件能访问哪些 Asset。
- 插件是否能触发成本动作。
- 插件版本升级如何影响历史 AgentRun。

不应照搬 Grok Build 的部分：

- 不让未信任插件执行外部调用。
- 不让第三方 Skill 绕过产品状态机。
- 不把插件定义的数据结构直接进产品数据库。
- 不把 Hook 失败默认放行用于高成本生成链路。

## 5. 不适合照搬的部分

### 5.1 不照搬 TUI

Grok Build 是终端工作台。Blue-Whale 是 Web Canvas 创作产品。

Blue-Whale 的第一界面应该是：

- Canvas。
- AgentChatPanel。
- Skill 面板。
- BottomDock。
- 资产节点和生成状态。

不是终端 scrollback、命令输出和文件 diff。

### 5.2 不照搬代码工作区模型

Grok Build 的 workspace 围绕文件、Git、命令执行和代码编辑。

Blue-Whale 的 workspace 围绕：

- Project。
- Canvas。
- Asset。
- GenerationJob。
- Stage。
- AgentRun。
- ChatMessage。

如果把 Blue-Whale 硬套到"文件 + 命令 + session"的模型，会导致产品对象失真。

### 5.3 不让 Grok Build session 替代 AgentRun

Grok Build session 是 coding agent 会话。Blue-Whale AgentRun 是创作意图和生成流程。

Blue-Whale 的 AgentRun 需要表达：

- 当前产品方向。
- 当前 workflow stage。
- 当前确认门。
- 关联的 GenerationJob。
- Canvas 节点状态。
- Prompt 优化结果。
- 资产理解结果。
- 生成失败和恢复策略。

Grok Build session 不具备这些产品语义。

### 5.4 不让工具权限替代生成授权

代码 Agent 的权限重点是：能不能读文件、改文件、跑命令。

Blue-Whale 的权限重点是：

- 能不能消费用户素材。
- 能不能调用视觉模型。
- 能不能启动 Provider。
- 能不能消耗积分 / 成本。
- 能不能进入高成本视频生成。
- 能不能复用历史产品素材。

所以只能借鉴"授权链"思想，不能复用其权限语义。

### 5.5 不让 Skill 自动触发绕过状态机

Grok Build Skill 可根据描述自动触发。Blue-Whale 也可以 auto 推荐 Skill，但不能让 Skill 自动越权推进阶段。

必须保证：

- Skill 只能影响创意结构和生成策略。
- Skill 不能跳过 Brief。
- Skill 不能跳过 asset_understanding。
- Skill 不能跳过 Prompt Optimizer。
- Skill 不能直接创建 GenerationJob。
- Skill 不能替用户确认结果。

## 6. 对 Blue-Whale 现有 Agent 编排的映射

### 6.1 Plan Mode → Stage Plan + 确认门

Blue-Whale 已有 Full Canvas 多阶段：

```text
Brief -> Skill -> Stage Plan -> Storyboard -> First Visuals -> Video -> Review
```

建议把 Grok Build Plan Mode 思想明确固化为：

- Brief 是用户目标计划。
- Stage Plan 是创作执行计划。
- Storyboard 是视频生成计划。
- First Visuals 是视觉方向验证。
- Video Generation 是高成本执行。

其中视频生成前必须是高成本确认门。

### 6.2 Permission Chain → GenerationAuthorizationGate

建议 Blue-Whale 后端显式引入 `GenerationAuthorizationGate` 或同等模块。

它在 `create_generation_job` 前执行：

```text
输入：project_id, agent_run_id, stage_id, intended_job, assets, prompt, user_intent
输出：allow | ask_user | deny
```

最小规则：

- 无 `optimized_prompt`：deny。
- 图生图 / 图生视频无 `asset_understanding`：deny 或 ask_user。
- 高成本视频 + 用户弱继续：ask_user。
- generating 中新请求：deny 并记录 pending intent。
- 当前用户无 asset 权限：deny。
- provider 不支持参数组合：deny 或 ask_user。

### 6.3 Tool Layer → AgentHarnessPort

建议后端定义内部端口，而不是让 Director 直接调业务函数：

```text
AgentHarnessPort
  build_decision_context()
  classify_intent()
  select_skill()
  understand_asset()
  optimize_prompt()
  authorize_generation()
  create_generation_job()
  update_canvas()
  advance_stage()
  append_agent_event()
```

这样可以做到：

- 真实 Provider 和 Fake Provider 可替换。
- Spike 能用模拟生成任务。
- 每个工具可单测。
- Agent 输出不直接污染数据库。

### 6.4 Session Persistence → Agent Event Log

借鉴 Grok Build 的 append-only JSONL 思想，但落到 Blue-Whale 数据库：

```text
agent_events:
  event_id
  project_id
  agent_run_id
  turn_id
  event_type
  payload
  created_at
```

可记录：

- `turn_started`
- `decision_context_built`
- `l1_classified`
- `branch_selected`
- `tool_call_started`
- `tool_call_done`
- `generation_authorized`
- `generation_job_created`
- `canvas_node_updated`
- `confirmation_waiting`
- `stage_advanced`
- `turn_done`
- `turn_failed`

产品状态仍以结构化表为准，事件日志用于恢复、审计和排查。

### 6.5 Background Tasks → GenerationJob

Blue-Whale 的 `GenerationJob` 应借鉴 Grok Build background task 的"立即返回 ID + 后续查询 / 事件更新"模式。

建议 P0 状态：

```text
queued -> processing -> succeeded | failed
```

建议 P1 扩展：

```text
partially_succeeded
cancel_requested
expired
absorbed
```

必须保证：

- Job 可独立查询。
- Job 可绑定 Project / User / AgentRun / Stage。
- Job 输出 Asset 后写 Canvas Node。
- 失败必须写 failed node 和 error message。
- 前端断线不影响 Job。

### 6.6 Sandbox → 产品能力隔离

Blue-Whale 不一定需要 OS sandbox，但需要产品级能力沙箱：

| 能力 | 隔离规则 |
|---|---|
| Asset | 只能读取当前 user / project 有权资产 |
| Provider | 按模型、成本、并发、地区、能力白名单调用 |
| Prompt | 原始 optimized_prompt 不直接展示给用户 |
| Skill | Skill 只能输出结构化建议，不直接执行生成 |
| Plugin | 未信任插件不能运行 Hook 或外部调用 |
| MCP | 默认不接；接入时必须按 server / tool 白名单授权 |

## 7. 三种方案对比

| 方案 | 描述 | 优点 | 风险 | 结论 |
|---|---|---|---|---|
| A. 直接接入 Grok Build Runtime | 尝试复用其 shell / runtime / session | 快速获得成熟 coding agent 能力 | 产品语义错位，TUI/文件/命令模型侵入，状态机难对齐 | 拒绝 |
| B. 借鉴架构，Blue-Whale 自建 Agent Runtime | 学 Plan / Tools / Permission / Session / Background / Sandbox 思路，用自有对象实现 | 语义清晰，可控，适合产品后端 | 需要工程实现 | 推荐 |
| C. 只借鉴文档层，不做 runtime 工程化 | 继续维护 Markdown Skill，让 LLM 读规则自由执行 | 短期快 | 确认门和状态不可复现，难调试，难产品化 | 仅适合 demo |

推荐选择：**B. 借鉴架构，Blue-Whale 自建 Agent Runtime。**

## 8. 建议的 Blue-Whale 后端架构

### 8.1 P0 架构分层

```text
API Layer
  POST /api/projects/{project_id}/agent/turn
  POST /api/projects/{project_id}/generate
  GET  /api/jobs/{job_id}
  GET  /api/jobs/{job_id}/stream

Agent Orchestrator
  build_decision_context
  L1 classifier
  decision_branch composer
  Director switch
  confirmation gate

Tool / Port Layer
  asset understanding
  skill selector
  prompt optimizer
  generation authorization
  generation job creator
  canvas updater

Runtime State
  Project
  AgentRun
  AgentTurn
  Stage
  CanvasNode
  Asset
  GenerationJob
  AgentEvent

Providers
  image model
  video model
  vision model
  LLM model
```

### 8.2 P0 最小闭环

先不要做完整 Full Canvas。

先跑通：

```text
用户输入
  -> decision_context
  -> decision_branch
  -> visible_reasoning
  -> prompt optimizer
  -> generation authorization
  -> GenerationJob
  -> SSE
  -> Canvas Node
  -> confirmation gate
```

### 8.3 P1 扩展

P0 稳定后再加：

- Full Canvas 多阶段。
- Skill 库 auto 推荐。
- 产品切换。
- 多图消歧。
- 长对话 summary。
- Agent event replay。
- Provider 多模型调度。
- 内容安全 Hook。
- 创作版本恢复。

## 9. 受限 Spike 验收门槛

Spike 只做一条 tracer bullet：

```text
Agent 对话输入
  -> 后端 decision_context
  -> L1 classifier
  -> decision_branch
  -> Director 输出 visible_reasoning
  -> Prompt Optimizer
  -> GenerationAuthorizationGate
  -> 模拟 GenerationJob
  -> SSE 推送
  -> Canvas Node ready
  -> 用户确认
  -> advance_stage 铁闸
```

全部满足才允许进入正式后端落地：

1. `has_generating=true` 时跳过 L1，直接进入 `generation_in_progress`。
2. `prompt_only` 只输出 `optimized_prompt_preview`，不创建 GenerationJob，不写 Canvas。
3. Agent 链路 Provider 前必须存在 `optimized_prompt`。
4. 展示给用户的是 `optimized_prompt_preview`，不是原始 provider prompt。
5. 图生图 / 图生视频前必须存在 `asset_understanding`。
6. 没有 ready node 时，明确确认也不能推进。
7. 用户只说"继续 / 好了 / 下一步"，不能自动推进高成本视频生成。
8. `advance_stage` 必须由后端独立校验，不能相信主 Agent 判断。
9. `GenerationJob` 和 `CanvasNode` 状态分离，不能用一个对象混管。
10. 生成失败必须写 `failed` node 和 `error` message。
11. SSE 断线后，Project 恢复能拿到 active_jobs 和当前 Canvas 状态。
12. 所有工具调用写入 agent_events。
13. visible_reasoning 不泄露 prompt、worker 文件名、JSON、工具参数、本地路径。
14. Fake Provider 替换真实 Provider 后，AgentRun 测试仍通过。
15. 删除 LLM 自由发挥路径后，确认门测试仍通过。

任一核心门槛失败，说明当前设计仍停留在 demo 级，不应进入生产后端。

## 10. 风险与边界

### 10.1 最大风险：只学界面，不学控制面

Grok Build 最有价值的是控制面：权限、工具、Hook、沙箱、会话、后台任务。

如果 Blue-Whale 只学"有个 Agent 对话框"，但不实现后端铁闸和状态恢复，会得到一个看起来聪明但不可控的生成聊天框。

### 10.2 第二风险：文档规则没有变成可执行规则

`blue-whale-agent-workspace` 里的 Markdown 规则必须转为：

- 代码组合器。
- 数据库字段。
- API 契约。
- 测试场景。
- 工具端口。
- SSE 事件。

否则规则只存在于提示词里，无法保证稳定。

### 10.3 第三风险：过早插件化

Grok Build 的 Plugins 很完整，但 Blue-Whale 不应过早做开放插件市场。

先把内部 Skill 标准化，等以下能力稳定后再插件化：

- Skill metadata。
- Skill selector。
- Skill 输出 schema。
- 成本与权限边界。
- Provider 调用授权。
- 审计与回滚。

### 10.4 第四风险：把取消当成产品语义

代码 Agent 可以 kill background command。视频生成 Provider 未必能可靠取消。

Blue-Whale 需要区分：

- AgentRun 暂停。
- GenerationJob 取消请求。
- Provider 实际取消。
- Job 完成后结果是否吸收进 Canvas。

不要承诺"用户说取消就一定取消 Provider Job"。

## 11. 最终判断

Grok Build 对 Blue-Whale 的价值集中在 **Agent 后端工程化方法**，不在具体运行时复用。

应重点借鉴：

- Plan Mode：高成本执行前先计划、再确认。
- Tool Layer：所有真实动作端口化。
- Permissions：工具和生成动作必须经过授权链。
- Hooks：关键生命周期可审计、可阻断。
- Skills：创作流程模块化。
- Plugins：未来能力包化，但必须有信任边界。
- Headless：AgentRun 不依赖前端连接。
- Sessions：事件日志、恢复、压缩、回放。
- Sandbox：能力隔离。
- Background Tasks：长任务独立运行并可恢复。
- Subagents：多 Worker 分工，但输出必须结构化。

不应采用：

- Grok Build TUI 作为产品形态。
- 文件 / 命令 / Git workspace 作为 Blue-Whale 事实源。
- Grok Build session 作为 AgentRun。
- 代码 Agent 权限语义作为生成授权语义。
- Skill 自动触发绕过 Blue-Whale 确认门。

**最终建议：**

> **不接入 Grok Build 整体运行时；以 Grok Build 为 Agent 工程化参考，Blue-Whale 自建以 Project、Canvas、Asset、GenerationJob、AgentRun 和确认门为中心的后端 Agent Runtime。**

## 官方证据索引

- Grok Build GitHub README：<https://github.com/xai-org/grok-build>
- Grok Build Getting Started：<https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/01-getting-started.md>
- Grok Build Skills：<https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/08-skills.md>
- Grok Build Plugins：<https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/09-plugins.md>
- Grok Build Hooks：<https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md>
- Grok Build Headless Mode：<https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md>
- Grok Build Session Management：<https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md>
- Grok Build Sandbox：<https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/18-sandbox.md>
- Grok Build Plan Mode：<https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/19-plan-mode.md>
- Grok Build Background Tasks：<https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/20-background-tasks.md>
- Grok Build Permissions and Safety：<https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/22-permissions-and-safety.md>
