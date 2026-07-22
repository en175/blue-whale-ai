# Blue-Whale 前端

一个面向 AI Agent / Canvas 交互的纯客户端单页应用（SPA）。项目与画布状态已对接后端
（project/canvas CRUD 经网关 `/api/agent/**` 路由到 agent-service），生成链路对接后端生成服务；
Agent 对话回复仍含本地 mock（`messages.ts` 的 `buildMockReplyForMode`）。

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

**Project**（项目，产品归属根）:
领域顶层的归属、授权与生命周期范围；Canvas、Conversation、AgentRun、GenerationJob 与 Asset 均归属于 Project，但各自保持独立的一致性边界。
切换 Project 即切换 Canvas 与 AgentChatPanel 对话历史。
_Avoid_: 把 Canvas 当作顶层概念；把 Project 理解为包住全部对象的单一强一致事务聚合。

**Conversation**（对话）:
Project 内唯一的 AgentChatPanel 持久化消息流；按顺序记录用户与 Agent 的对话事实，并关联多个先后发生的 AgentRun。
_Avoid_: 把消息直接挂到 Project；把每个 AgentRun 当作独立对话；首版为一个 Project 建立多个 Conversation。

**Card 生命周期状态**: `generating` → `normal` | `failed` | `cancelled`。
失败后的恢复入口仍在原 Card 上，但后端以关联的新 GenerationJob 执行重试；取消且没有产物的
输出槽位显示为 `cancelled`，不创建 NodeItem，也不计为生成失败。

**User（用户）**:
已完成注册并通过登录建立身份的服务使用者；未注册或未登录者不能使用受保护的产品能力。
一个 User 拥有多个 Project，产品资源与操作均按服务端认证的 User 归属。
_Avoid_: 访客、匿名 User、客户端自报 `userId`、把浏览器本地标识当作身份。

**ContentReview（内容审核）**:
对进入 Agent 或供应商的输入及即将向 User 展示的输出形成的产品安全决定；只有明确通过的内容
才能继续或可见，审核拒绝、超时或不可用均不得默认放行。
_Avoid_: 把供应商审核结果直接当作产品权威；审核不可用时默认通过。

**Asset（资产）**:
一个必须归属 Project 的图片或视频文件单元，媒体内容身份不可变，由产品控制的对象存储持久化。
对象永久私有；访问 URL 仅在服务端确认当前 User 有权访问所属 Project 与 Asset 后临时签发，
不构成 Asset 身份或长期地址。
**同一 Asset 可被多个视图引用** —— Card（对话流呈现）与 NodeItem（画布呈现）
是同一生成结果的两种视图,二者引用同一个 Asset。
既包含用户上传的素材（作为生成输入）,也包含生成产出的结果（作为输出）,
二者是同一种 Asset,以来源属性区分。
重生成、编辑、换源或生成衍生版本时创建带来源关系的新 Asset，再切换视图引用；
名称、标签等元数据可修改，访问 URL 可重新签发，但不改变 Asset 身份。
_Avoid_: 把 Asset 与 NodeItem/Card 混为一谈 —— Asset 是文件实体,
NodeItem/Card 是它呈现给用户的视图；在同一个 assetId 下覆写媒体内容。

**GenerationJob（生成任务）**:
一次生图/生视频的后台任务。生命周期:`queued` → `processing` →
`succeeded` | `partially_succeeded` | `failed` | `cancelled`。
任务在**后台持久化**:用户刷新页面、切换 Project、关闭浏览器后任务仍继续执行,
回到该 Project 仍可查到状态与结果。一个 GenerationJob 可产出一个或多个 Asset，
每个 Asset 分别通过 Card / NodeItem 呈现。
GenerationJob 必须归属 Project；由 AgentChatPanel 触发时关联 AgentRun，由 BottomDock
触发时不关联 AgentRun。AgentRun 暂停或进入终态不级联改写已提交 Job；失败重试创建
带重试关系的新 Job，原 Job 终态不可变。
取消请求只表达意图；只有供应商确认取消或产品能证明调用尚未发生时，Job 才进入 `cancelled`。
取消确认前已完成的真实结果仍按成功或部分成功接纳，已产生的 Asset 永久保留。
**Card 的展示状态是 Job 状态的视图映射**:`processing`→`generating`、
`succeeded`→`normal`、`failed`→`failed`；`partially_succeeded` 中成功的输出为 `normal`，
缺失的输出槽位为 `failed`；`cancelled` 中已有 Asset 的输出为 `normal`，未产生结果的槽位为
`cancelled`。
_Avoid_: 把 Job 与 Card/NodeItem 混为一谈 —— Job 是过程,Card/NodeItem 是结果视图;
把 Job 与 Asset 混为一谈 —— Job 是过程,Asset 是它的产物。

**AgentRun（创作运行）**:
围绕一个创作意图持续推进的 Agent 工作单元；活动中的 Run 可跨澄清、修改和自然语言授权等
多轮对话暂停并恢复，终态不可重开，后续修订或无关新目标创建关联的新 AgentRun。
其生命周期状态只表达运行、等待及终态；理解素材、选择技能、规划和生成等属于独立的展示阶段。
AgentRun 可关联多个 GenerationJob 及其输出用途，但不拥有 Job 的执行生命周期；恢复时吸收
Job 已持久化的结果事实。
_Avoid_: 把每条用户消息都当作新的 AgentRun；把 AgentRun 与具体的 GenerationJob 混为一谈。

**RuntimeCheckpoint**（运行时检查点）:
与活动 AgentRun 绑定的版本化、不透明执行状态，只用于恢复运行，不是 Run、Job、Asset 或产品事件的权威事实。
AgentRun 只从当前已接纳版本恢复，不自动回退旧版本；创建时固定运行引擎及版本，错误引擎或版本
必须拒绝恢复，活动检查点不跨引擎迁移，终态 Run 不再使用 checkpoint。
_Avoid_: 把 RuntimeCheckpoint 当作产品事实；让运行时检查点独立推进产品状态；由其他引擎解析其内部内容。

**AgentActionProposal（Agent 动作提议）**:
Agent 基于当前意图提出的结构化候选动作，不是可直接执行的命令或授权；只有产品控制面按 User、
Project、AgentRun、工具契约与有效 UserInputRequest 完成确定性校验后，动作才能产生副作用。
_Avoid_: 把模型输出直接当作命令；把用户素材、外部内容或工具结果中的文字当作授权。

**CostReservation（成本预留）**:
产品控制面在可能计费的供应商调用前按最坏情况暂时占用额度，并在取得可证明的实际成本后结算
或释放；它是防滥用的运营事实，不是账单或扣款。
_Avoid_: 用户确认后突破硬额度；把成本预留当作计费订单。

**AuditRecord（审计记录）**:
用于证明安全、成本与管理决策链的不可变记录，与产品事件和普通运行日志分离；它只保存最小必要
的主体、目标、决定、策略版本与关联标识，不承载原始用户内容或凭证。
_Avoid_: 把 AuditRecord 当作产品事件、调试日志或原始提示词存档。

**GenerationAuthorizationGate（生成授权门）**:
Agent 创建 GenerationJob 前对用户意图与风险的分类：明确且在默认成本额度内则直接执行；
存在关键歧义则继续对齐；高成本或不可逆操作则先取得自然语言确认，但确认不能突破系统硬额度。
_Avoid_: 每次生成都确认、确认按钮、把需求对齐误称为授权。

**UserInputRequest（用户输入请求）**:
AgentRun 因关键歧义或 GenerationAuthorizationGate 而等待用户补充信息时创建的请求记录。
请求内容与唯一标识一经创建不可改写，归属于 AgentRun，不是独立聚合；同一 AgentRun
最多只有一个活动请求。用户只能通过 Conversation 中引用该请求标识的自然语言消息回答，
已过期或已回答请求的迟到回复不能解除后续请求。
_Avoid_: 确认按钮、无请求标识的隐式解锁、把 UserInputRequest 当作独立运行任务。

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

### 计费与货币

> 计费域术语适用于 `blue_whale_api`（开源 new-api 二开）。统一 RMB 决策见 [ADR-0021](docs/adr/0021-unified-rmb-billing.md)。

**quota（额度）**:
new-api 内部中性计费单位（无货币属性，类比游戏币）；默认锚点 500000 quota = $1（`QuotaPerUnit`）只是换算系数，非 quota 固有的美元属性。所有扣费、充值、余额最终落到 quota 整数。
_Avoid_: 把 quota 当作美元 / 人民币；把 500000=$1 当作 quota 的固有属性

**价格模式（price mode）**:
模型定价的一种录入形态，存原始价（`ModelPrice`）。统一 RMB 后语义为「管理员直接填 ¥ 价」，复用现有存储，不新增表 / 列（语义从 USD 重定义为 RMB）。
_Avoid_: 把价格模式当作比率模式；以为人民币化要新建存储

**比率模式（ratio mode）**:
模型定价的另一种录入形态，存乘数（`ModelRatio`），按基准倍率计费，不受汇率换算影响。
_Avoid_: 把比率模式当作价格模式

**汇率（exchange rate，`USDExchangeRate`）**:
默认 7、可动态配，统一用于展示换算与计费换算（不分离）。价格模式 ¥ 价经 ÷汇率 落 quota；改后重启生效。
_Avoid_: 展示汇率与计费汇率分离维护；当作固定常量

**按秒计费（per-second billing）**:
视频 / 异步生成任务的计费方式，adapter 返回 `{"seconds":N}` 经 `task_billing` 与 `billingexpr` DSL 按秒算，是 new-api 原生能力。
_Avoid_: 把按秒计费当作二开新功能

**ratio_sync（上游价格同步）**:
从 models.dev 拉上游官方定价（USD）的功能，手动触发（非自动 cron）。统一 RMB 后改造为：拉 USD 官方价 ÷汇率 存 ¥，手填优先（不覆盖已手填模型）。
_Avoid_: 把 ratio_sync 当作自动 cron；在 RMB 体系下直接禁用它

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
