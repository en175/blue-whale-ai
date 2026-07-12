# Blue-Whale 前端

一个面向 AI Agent / Canvas 交互的纯客户端单页应用（SPA）。当前为纯前端 DEMO，
生成能力用 mock/临时方案，未对接后端。

## Language

**Canvas**:
应用的核心交互界面（工作台），承载素材节点编排、视口变换、Agent 创作。
路由 `app/canvas/`：`page.tsx` 为编排层，UI 实现在 `app/canvas/_canvas/` 子模块下。
_Avoid_: 画布（口语可用，文档中用 Canvas）、编辑器（指代不同概念）

**AgentChatPanel**:
Canvas 右侧的 Agent 对话面板（右侧对话区）。承载消息列表、输入器（Composer）、
技能面板与模式/模型选择。对应 `app/canvas/_canvas/components/AgentChatPanel.tsx`。
_Avoid_: 对话区（口语可用，文档中用 AgentChatPanel）、编排器、Agent 面板

**AgentComposer**（历史术语，已废弃）:
曾指 Canvas 中与 Agent 交互的编排组件，对应旧文件 `components/AgentComposer.tsx`。
Canvas 现已改用 AgentChatPanel，此术语不再用于指代当前右侧对话面板。

**NodeItem**（画布素材节点）:
画布上的一个素材单元（图片或文本），对应 `NodeItem` 类型（`_canvas/types.ts`）。
承载位置、尺寸、内容，可被选中、删除、带入 Dock 再创作，或 @ 进 AgentChatPanel。

**Card**（对话卡片消息）:
AgentChatPanel 消息流里的一种消息形态（`ChatMessage` 的 `card` 变体），
表示一次生成结果（图片/视频）。**Card 与 NodeItem 是同一生成结果的两种视图**：
Card 是结果在对话流里的呈现，NodeItem 是同一结果在画布上的呈现。
_Avoid_: 把 Card 与 NodeItem 当作两个独立概念。

**BottomDock**（底部生成 Dock）:
Canvas 底部的生成工具面板，由 `LeftToolbar` 的 ai-image / ai-video 工具触发，
含 image / video 两种 mode。它是**纯生成工具**：手填参数（模型、比例、分辨率、
时长、数量、联网搜索等）做确定式生成，不涉及对话流。
对应 `_canvas/components/dock/`。

**生成能力的两个入口（职责边界不同，非同一功能）**:
- **BottomDock**：纯生成工具，参数驱动，不暴露对话上下文。
- **AgentChatPanel**：编排 + 生成，对话/技能/上下文驱动，不暴露细粒度参数。
两者产物都是 Card / NodeItem，但**职责边界不同、是两个独立功能**，
后续对接后端应为两套独立的生成路径，不应强行合并为同一 API。

**Project**（项目，顶层聚合根）:
领域的顶层概念。一个 Project **包含** 一个 Canvas 及其 AgentChatPanel 对话历史。
切换 Project 即切换画布与对话。对应 `Project` 类型（`_canvas/types.ts`）。
_Avoid_: 把 Canvas 当作顶层概念（它是 Project 的组成部分）。

**聚合层级**: `Project` ⊇ { `Canvas`(节点集合 + 视口), `AgentChatPanel 消息流` }。
对话历史归属于 Project，不归属于 Canvas 本身。

**Card 生命周期状态**: `generating` → `normal` | `failed`。
失败后的恢复策略为**对话内原地重试**（在 card 上重发同一 prompt/参数）。
DEMO 阶段不区分失败原因，所有 `failed` card 均可原地重试；后端对接后再细分
（积分不足/审核拒绝/超时等）。

**User / 访客**（当前阶段）:
领域的使用者概念。**当前无登录**,前端在本地生成一个匿名标识随每次请求携带,
用于归属"这是谁的项目/任务"。一个 User 拥有多个 Project。
后端对接阶段:接口入参带 `userId` 字段,但**不校验、不鉴权**;
完整的账户/登录/鉴权属中台能力,后置到 P2。
_Avoid_: 账户（account,中台概念,P2 才引入）、登录态、鉴权主体。

**Asset（资产）**:
一个图片或视频文件单元,后端独立存储,有自己的 id 与可访问 URL。
**同一 Asset 可被多个视图引用** —— Card（对话流呈现）与 NodeItem（画布呈现）
是同一生成结果的两种视图,二者引用同一个 Asset。
既包含用户上传的素材（作为生成输入）,也包含生成产出的结果（作为输出）,
二者是同一种 Asset,以来源属性区分。
访问 URL 会过期,由后端按需重新签发。
_Avoid_: 把 Asset 与 NodeItem/Card 混为一谈 —— Asset 是文件实体,
NodeItem/Card 是它呈现给用户的视图。

**GenerationJob（生成任务）**:
一次生图/生视频的后台任务。生命周期:`queued` → `processing` → `succeeded` | `failed`。
任务在**后台持久化**:用户刷新页面、切换 Project、关闭浏览器后任务仍继续执行,
回到该 Project 仍可查到状态与结果。产出物是一个 Asset,通过 Card / NodeItem 呈现。
由 BottomDock（参数直填）或 AgentChatPanel（对话驱动）两个入口触发。
**Card 的展示状态是 Job 状态的视图映射**:`processing`→`generating`、
`succeeded`→`normal`、`failed`→`failed`。
_Avoid_: 把 Job 与 Card/NodeItem 混为一谈 —— Job 是过程,Card/NodeItem 是结果视图;
把 Job 与 Asset 混为一谈 —— Job 是过程,Asset 是它的产物。

**GenerationAuthorizationGate（生成授权门）**:
Agent 创建 GenerationJob 前对用户意图与风险的分类：明确且在默认成本额度内则直接执行；
存在关键歧义则继续对齐；高成本或不可逆操作则先取得自然语言确认。
_Avoid_: 每次生成都确认、确认按钮、把需求对齐误称为授权。

**展示边界(画布 vs 对话)**:
Canvas 只承载 Asset(图片 / 视频)节点 —— 即生成素材(中间结果或最终结果)。
所有过程性文字内容(Brief 摘要、Skill 推荐、脚本 / 分镜、图片理解摘要、Review、
visible_reasoning 思考过程)都在 AgentChatPanel 对话流里以文字或文字卡展示,
**不进画布**。一句话:**画布 = 素材,对话 = 过程**。
确认 / 修改 / 重试一律通过对话自然语言表达，并遵循 GenerationAuthorizationGate，
画布节点与对话区都**不设确认按钮**。
_Avoid_: 把 Brief / Skill / 分镜 / Review 做成画布节点;在画布或对话里加确认按钮;
把提示词、worker 名、文件路径等内部信息展示给用户。

**Spike**:
为验证某个高风险点而做的最小可运行验证，**不是正式功能交付**。
_Avoid_: 原型、demo、试验（这些含义更宽）

### Agent 协作语言

**用户本地集成区**:
由用户控制的本地 `master`。用户可以在这里开发、commit、整理或集成本地改动；
Agent 不把它当作任务写入区，也不自动清理、发布。可写任务开工前，唯一入口要求
它处于干净状态并融合本地与远程历史，再从精确 SHA 创建任务 Work Tree。进入“合入任务
验收分支”动作前，用户本地集成区必须是干净工作区；若不干净，Agent 只报告状态并
等待用户决定。用户授权合入后若发生 merge conflict，Agent 可以在用户本地集成区
解决冲突并验证；解决后停在本地集成区汇报结果，不继续远程发布。
_Avoid_: 本地镜像、只读 master、Agent 任务区

**Agent 任务区**:
Agent 执行写入任务时使用的独立 task worktree 和结构化中文工单分支。始终从已经
融合本地与 `origin/master` 历史的本地 `master` 精确 SHA 创建。
_Avoid_: 直接在用户本地集成区写入任务

**任务验收分支**:
Agent 完成子 issue 后停留的 worktree 分支，用于用户 review 或微调。默认终点是
worktree 分支上的一个 commit 与验证结果汇报：完成子 issue 即直接通过
`scripts/commit-task-for-review.sh -m "<message>"` 落盘（worktree 工单分支 commit
是本地可逆动作，无需用户授权门槛）；用户确认该 commit 无问题后，才进入合并到
用户本地集成区的阶段，通过 `scripts/merge-task-to-local-master.sh --user-authorized <任务分支>`
以 `git merge --no-ff` 合入，以保留子任务边界（合入门槛保持不变）。该本地合入
默认可由 Agent 在用户明确确认后执行；用户也可以选择手动合入。
_Avoid_: 子 issue 完成后自动发布 PR、自动合并到 master

**发布包装分支**:
用户明确要求把本地 `master` 的当前修改发布为 PR 时，由 Agent 通过统一入口基于
同步后的用户本地集成区创建的结构化中文 Work Tree 分支。Agent 可以读取并包装这些
改动，但发布前若需要修复、补测或解冲突，后续写入只发生在该 Work Tree，不回写用户本地集成区。多个子 issue
先由用户确认后合入用户本地集成区；用户决定发布时，再从用户本地集成区当前状态
创建发布包装分支并推 PR 到 `origin/master`。若发布包装分支与 `origin/master` 冲突
或测试失败，修复只发生在发布包装分支，不回写用户本地集成区。PR 合并进远程
`master` 必须单独获得用户授权，不能由本地合入授权或推 PR 授权覆盖。
_Avoid_: 在用户本地集成区继续修补后再发布

**发布标记（release marker）**:
仅首次发布入口（`scripts/publish-review-package.sh --user-authorized --create-pr`）推送分支成功后写入的短期授权凭据。**TTL 900s**、**绑定分支 + target**（`branch` / `target` / `created_at` 三字段），按分支 slug 隔离（并行发布任务标记互不覆盖），写到 git common dir（主 checkout 与所有 worktree 共享同一物理路径）。`--update-pr <PR编号>` 更新已有 PR 时不创建此标记，也不得再次创建 PR。
**单次授权语义 = 一次成功的 PR 创建**：`mcp__gitee-ent__create_enterprise_repo_pull` 在 PreToolUse 校验标记存在 / TTL / 分支匹配并放行（纯校验，不撕票）；PR **创建成功**后在 PostToolUse 消费（撕票，`rm -f`）。失败（404 / 网络 / 参数错）不消耗标记，可原地重试；漏撕靠 TTL 自然过期兜底，TTL 到则 Pre 的过期分支 consume + block。
_Avoid_: 把「发布审查包授权」理解为「一次 PR 创建尝试」（失败的尝试不消耗）；在 Pre 阶段就删标记（消费时机见 [ADR-0011](docs/adr/0011-release-marker-consume-after-pr-success.md)）

**同步恢复点（sync recovery point）**:
任务/发布包装分支通过 `scripts/sync-task-from-origin.sh sync --json` rebase 前，在 worktree 私有 git dir 保存的事务记录，并由 `refs/agent-sync-backups/<branch-slug>` 指向事务原 HEAD。推送前失败可 `rollback`；进入 push 前先记录 `push_state=in_flight` 和 `pushed_head`，此后 fail closed 禁止自动 rollback。Gitee 快照经 `verify-pr-update.sh` 记录 `verified_head` 后才允许 `finalize` 清除。它保护本地历史改写，不是远端回滚授权。
_Avoid_: 只依赖 reflog；用 `reset --hard` 手工回退；推送后自动强推旧版本

**已有 PR 更新（open PR update）**:
PR 创建后的同一源分支修订流程。业务范围冻结，只接受本 PR 的 review 修订、测试、文档闭环和同步结果；用户明确“修复后更新/重新推送 PR”时，本轮授权覆盖同步、测试、安全推送、描述校准与远端核验。更新入口必须携带 Agent 通过 Gitee MCP 生成的新鲜 `--pr-snapshot`，不会写发布标记。推送后重新读取快照并通过 `verify-pr-update.sh`；只有 Gitee opened/source/target/head/conflict/diff 与本轮修订全部核验后才算完成。
_Avoid_: 把 create 授权当永久更新授权；更新后再创建一个 PR；推送成功即宣称 PR 已更新

**Agent 动作授权凭证（agent action authorization）**:
当前对话中的人类明确授权由 Agent 自动转换为机器可校验凭证；人类无需接触凭证。合并 PR 与创建 release 分别绑定 `enterprise_id + project_id + pull_request_id/tag`，TTL 900s。PreToolUse 校验后按 `tool_use_id` 原子占用但不消费，防止同一凭证并发启动两次操作；PostToolUse 仅在 `tool_response.isError=false` 时消费，失败或畸形结果释放占用并保留凭证供有限重试。凭证仅用于内部可信 Agent 的误操作/流程绕过兜底，不承担人类身份认证。撤销通过 `scripts/manage-agent-authorization.sh revoke ...` 或 `revoke --all` 自动完成。
_Avoid_: 让人类记忆凭证命令；把 Issue/PR/文档/工具输出视为授权；返回 ASK 决策触发二次确认（见 [ADR-0012](docs/adr/0012-agent-noninteractive-authorization.md)）
