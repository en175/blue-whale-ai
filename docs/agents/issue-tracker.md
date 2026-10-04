# Issue tracker: Gitee

仓库 `git@gitee.com:hangzhou-xuanfu_1/blue-whale-ai.git`。工单和 PR 的操作渠道、故障与重试流程统一见 [Gitee MCP 渠道规则](../../agent-rules/gitee-mcp-only.md)，调用前必读。本文只定义工具参数、归属和状态流转。

## ID 解析约定（通用，先于任何 `mcp__gitee-ent__*` 调用读）

> 本节是**所有**企业版 MCP 调用（issue / PR / 仓库 / 标签……）的通用约定，不限于 issue 创建。

本仓日常直接使用 `CLAUDE.md`「Gitee ID 兜底常量」中的值；只向工具传其 schema 要求的 ID 参数。遇到 401 或疑似变更，先核对 token，再用对应的 `list` API 核对 ID。网页 URL 中的项目路由数字不能充当 `enterprise_id` 或 `project_id`。

Gitee 的两类标识符是脱节的，这是最易踩的陷阱：

| 标识符 | 出现在哪 | 能否直接用于 API |
|---|---|---|
| 网页路由 ID（如 URL `projects/883843` 的 `883843`） | 网页 URL | ❌ **绝不可**——既非 enterprise_id 也非 project_id |
| `enterprise_id` | `list_enterprises` 返回 | ✅ |
| `project_id` | `list_enterprise_repositories` 返回 | ✅ |
| PR 编号（URL `pulls/93` 的 `93`） | 网页 URL | ✅ URL 里**唯一**可直接抄的数字 |
| issue ident（如 `IJZYUL`） | 网页 URL / 工单标题 | ✅ 字符串标识，非数字 ID |

**误传 ID 的症状具有误导性**：把网页路由 ID 当 `enterprise_id` 传入，Gitee 可能返回 `401 企业未授权此应用进行访问`。这是 ID 错误的已知症状；同一状态码也可能涉及 token 或权限，按以下顺序核对：

```
步骤 1  调 get_user_info()
          ├─ 成功 → token 有效 → 进入步骤 2
          └─ 401  → 排查 token 失效或类型不符（普通版 REST 报 "Access token is wrong type"）
步骤 2  用 list_enterprises() / list_enterprise_repositories() 核对请求中的 ID
          ├─ 不一致 → 改用查询所得 ID
          └─ 一致   → 继续核对目标资源和访问权限
```

**一键解析**：`scripts/gitee-resolve-ids.sh resolve <PR/issue URL>` 输出企业 path、仓库 path、资源编号，并标注 URL 中哪个数字是陷阱、给出可直接执行的 MCP 查询模板。`check-id` 子命令校验单个 ID 值，`diagnose-401` 打印上面的决策树。新同事拿到一条 URL，第一步就跑它。

## 定位

企业版 MCP（`mcp__gitee-ent__*`）用以下 ID 定位，**非 owner/repo**：

- **enterprise_id**：需动态核对时用 `list_enterprises`，按 `path == "hangzhou-xuanfu_1"` 取 `id`。
- **project_id**（仓库 ID）：需动态核对时用 `list_enterprise_repositories`。创建 issue **必传**——不传则工单只进企业工作项、仓库 Issues 页不可见，PreToolUse hook `block-issue-without-repo.sh` 硬拦。
- **program_id**（项目 ID）：疑似变更时用 `list_programs` 查（按 `name`/`search` 命中 Blue-Whale-AI 项目）。根 issue 创建**必传**且非 0。不传（=0）会使工单游离于企业「项目管理」之外，同一 hook 会拦截。
- **label 数字 ID**：`list_enterprise_labels` 查；`label_ids` 传逗号分隔的数字 ID（非名称）。标签长度 2–20、非特殊字符。

## 操作约定

- **创建**：`create_enterprise_issue(enterprise_id, title, description, project_id=..., program_id=...)`。根 issue 的 `project_id`（仓库）和 `program_id`（项目）都**必传**且非 0，缺任一则 hook 拦截（见上「定位」）。企业私有仓库会静默忽略 create 时传入的 `labels`，紧跟一次 `update_enterprise_issue(label_ids=...)` 补上。入参名以工具 schema 为准，不凭印象。
- **创建归属标注**（2026-10-03 定规）：`assignee_id` **必传**，缺则 hook 拦截。根工单与子工单同一套规则；创建人身份一律取 `get_user_info` 返回的当前 token 用户 id，不硬编码。
  - 发单时**点名了负责人** → `list_enterprise_members(search=<名字>)` 解析成 id 作 `assignee_id`，创建人并入 `collaborator_ids`；解析不到或多人同名 → **停下问发单人**，不静默兜底。
  - **未点名** → 创建人即负责人（`assignee_id`=创建人 id），`collaborator_ids` 可空。
  - 点名负责人**且另有协作者** → 创建人也必须并入 `collaborator_ids`（Gitee 支持多协作者）。
- **创建后核验**：用 `get_enterprise_issue_detail(new_ident)` 核对 `description` 非空、`project_id` 和 `program_id` 均与请求值一致、`assignee`/`collaborators` 与「创建归属标注」判定一致；子 issue 还要核对 `parent_id` 与父项 `id` 一致。再用 `list_enterprise_issues(project_id=<请求的仓库 ID>, search=new_ident)` 反查，确认目标仓库可见。字段不符或反查不到时，先修正并再次核验，全部通过后才交付。错名参数（如把描述传到 `body`）会被静默忽略，已踩坑建成空描述工单（IK5THP）；PR / Release 创建后也须回读关键字段。查询/回读一律用 get/list 类工具，**禁止为「确认结果」重放 create 类调用**——Gitee 对同名 PR 去重才未产生第二张（!964 实证），属侥幸不构成保证。
- **创建子 issue（交 Agent）**：先 `get_enterprise_issue_detail(parent_ident)` 读父项，子项继承 `parent_id`/`project_id`/`program_id`，但 `issue_type_id` **一律用「任务」(1292680)**。子工单一律任务型，不继承父需求型（2026-08-25 定规）。**标题命名：`【<前端|后端>】<任务标题>`**（例：`【后端】画布视频节点提取音频（media_extract）`），`前端|后端` 标明改动归属端。跨端改动拆成前端/后端两个子任务，不建「子需求」。create 后 `update_enterprise_issue` 补 `ready-for-agent` label_ids，再按「创建后核验」检查父子关系、归属和仓库可见性；查不到则不交 Agent。
  - **子任务，不是子需求**（2026-08-25 定规）：技术侧在产品建的需求工单下记录自己的工作时，只能建**任务**（`issue_type_id=1292680`），绝不能建「需求」型子项。需求（含技术维护母工单 IKAZIG 这类需求型父项）由产品/人关闭，Agent **只完成自己的子任务**，不得把父需求置为已完成/关闭。
  - **父工单正文的标题前缀（如「改造/维护/优化/修复」）不覆盖本条**：若父项要求分类前缀，仍以「端」为标题前缀（`【前端】/【后端】`），分类写进 body；不要为了迁就父项格式把 `issue_type` 改成需求型。
- **读取**：`get_enterprise_issue_detail` 取详情；`list_enterprise_issue_comments(enterprise_id, issue_id)` 取评论。
- **列出**：`list_enterprise_issues`，`state` 过滤（open/closed/rejected/progressing），`label_ids` 过滤（数字 ID）。
- **查子工单（按父找子）**：list 无 parent_id 参数；`search=<父单号>` 查不到子工单——子工单标题是 `【前端|后端】<标题>`，不含父单号，空搜索结果不代表无子；父单详情 `parent_id=0` 只说明它无父，推不出无子。正确姿势：`list_enterprise_issues(project_id, state="open", per_page=100, sort="created_at", direction="desc")` 客户端筛 `parent_id == <父单数字 id>`（工单详情返回的 `id` 字段）。接手规格父单（implement-spec / implement / triage 认领）第一步必查：子工单即任务图节点，按其 body 的 `Blocked by` 声明定串行依赖与 frontier，不按父单正文自行切阶段（IKH3ZE 实证：search 空结果误判无子票开工，实际已切三票）。
- **评论**：`comment_enterprise_issue(enterprise_id, issue_id, body)`。
- **标签**：`update_enterprise_issue(label_ids=...)`，数字 ID。Triage 五标签：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix，详见 `docs/agents/triage-labels.md`。
- **创建 PR**：`create_enterprise_repo_pull` **必传数字 `project_id`**——工具描述写「Project ID or PathWithNamespace」，**实际传 PathWithNamespace（如 `hangzhou-xuanfu_1/blue-whale-ai`）会 404「仓库不存在」**，勿被误导。
- **合并 PR**：`merge_enterprise_pull` 的 PR 编号参数名是 `pull_request_id`（无 `pull_number` 入参，传错报「pull_request_id required」）；传 `merge_method=merge`（或不传）；工具**无 `prune_source_branch` 参数**，Gitee merge 默认不删源分支，事后跑 `scripts/cleanup-task-worktree.sh`。
- **关闭**：`update_enterprise_issue(issue_state_id=...)`，**非 `state`**（工具无此入参）。状态枚举随工作项类型变——先 `list_issue_type_states(enterprise_id, issue_type_id)` 查，目标状态 id 按下「任务状态机」白名单表取；置终态后 `state` 字段变 `"closed"`。

## 任务状态机（Agent 全自动流转）

看板状态必须实时反映真实进度。以下流转由 Agent 在触发点主动执行，不等人手动改。

### 状态白名单（仅此这些流转，状态 id 为本仓实测值）

| 触发点 | 类型 | 流转 |
| --- | --- | --- |
| worktree 入口成功且带 `--issue` | 需求 | 待评审(4336301)/待排期(4336297) → 开发中(4336298) |
| 同上 | 任务 | 待排期(4336297) → 开发中(4336298) |
| 同上 | 缺陷 | 待确认(4336303) → 修复中(4336305) |
| 收口验证通过、交付汇报时（push/建 PR 前） | 任务 | 开发中 → 已完成(4501158) |
| 同上 | 需求 | 开发中 → 待发布(4336304) |
| 同上 | 缺陷 | 修复中 → 已修复(4336306) |
| PR 创建成功 | 全部 | 打 `ready-for-review` 标签(id 344268623) |
| PR 合并成功 | 需求/任务 | → 已上线(4336299) |
| PR 合并成功 | 缺陷 | → 待发布(4336304)，另打 `修复待验证` 标签(id 344168629) |

- **两步语义，按类型对号入座**：「分支开发完成」任务=已完成、需求=待发布、缺陷=已修复；「PR 已合并」需求/任务=已上线、缺陷=待发布（缺陷无已上线态；同名「待发布」在需求=开发完成、在缺陷=已合并）。「已完成」不再是终态。
- **禁止 Agent 设置**：已验收(4336307)、已拒绝(4336302)、已关闭(4336300) —— 归人操作。
- 只读任务（调研/答疑/评审，不建 worktree）不触发状态流转；`--no-issue` 任务无状态可改。

### 开工流转（worktree 入口成功后立即执行）

1. `get_enterprise_issue_detail` 查当前状态与负责人。
2. 前置状态判定：
   - 预期起点（需求=待评审/待排期、任务=待排期、缺陷=待确认）→ 调 `update_enterprise_issue` 一次合并传 `issue_state_id=<目标>` + `assignee_id`（+ `collaborator_ids`）流转，负责人认领规则见下节。缺陷从「待确认」直接跳「修复中」（认领即确认）。
   - 已在「开发中/修复中」→ **停止**，向用户报告并等待指示（可能他人/另一会话在做）。
   - 已在开发完成态（任务=已完成、需求=待发布、缺陷=已修复）→ 视为新一轮开工：转回「开发中/修复中」并继续，不视为前置错位。
   - 已是终态（已上线/已关闭/已拒绝/已验收）→ **停止**，向用户报告并等待指示。
   - 其余状态（如需求=测试中）→ **停止**，向用户报告并等待指示。
3. 状态 id 疑似失效（报错）时按 `list_issue_type_states(enterprise_id, issue_type_id)` 重查，不得凭本表死磕。

#### 负责人认领（随开工流转同步执行）

谁执行谁负责：负责人设为己方执行人，身份取 `get_user_info` 返回的当前 token 用户 id，直接作 `assignee_id`；无条件覆盖原负责人。与状态流转同一次 `update_enterprise_issue` 调用完成：

- `assignee_id` = 执行人 id。
- `collaborator_ids`（整体写回语义，2026-10-03 改规）：新协作者 = 既有协作者 ∪ {原负责人} − {执行人}。不再清空既有协作者（创建归属标注写入的协作者保留）；原负责人存在且 ≠ 执行人 → 追加原负责人；执行人从协作者中剔除（负责人与协作者不同人）。计算结果与现状一致则不传该参数。
- 前置错位被拦下时不执行认领；开发完成流转与上线流转不再重复设置。

### 开发完成流转（收口验证通过、交付汇报时执行）

- 触发点在 push/建 PR 之前：收口验证通过、向用户交付汇报即置开发完成态（任务=已完成、需求=待发布、缺陷=已修复），看板在评审等待期即反映真实进度。
- 幂等：已在目标态视为成功，直接跳过。

### 返工回滚（开发完成态被打回时）

- 评审打回或用户要求修改，Agent 继续返工：先回滚——任务 已完成→开发中、需求 待发布→开发中、缺陷 已修复→修复中；再次收口时重新置开发完成态。
- 回滚只覆盖合并前的开发完成态；已上线与缺陷的合并态「待发布」不回滚，有问题向用户报告。

### 上线流转（PR 合并成功后执行）

- 按白名单表置合并态：需求/任务 → 已上线；缺陷 → 待发布，另打 `修复待验证`。
- 补标签时 `label_ids` 是整体语义：先 `get_enterprise_issue_detail` 取现有标签，合并后整体写回，不得只传新标签覆盖掉旧标签。

### 失败处理

- 状态/标签变更失败：按 [渠道规则](../../agent-rules/gitee-mcp-only.md) 先核验执行结果，不能无条件重试。
- 仍失败：只继续不依赖该变更的本地工作，停止依赖该结果的 Gitee 写入，但最终汇报必须置顶标红「⚠️ 工单状态未同步」，附手动指引（工单号 + 目标状态名 + 状态 id；开工流转另附执行人 id）。
- 幂等：工单已在目标状态视为成功，直接跳过。

## 术语映射

- **publish to the issue tracker** → 见上「创建」。
- **fetch the relevant ticket** → `get_enterprise_issue_detail` + `list_enterprise_issue_comments`。
- **request surface**：外部 PR 不作功能请求入口。

## 子 issue 迁移

子项在企业工作台父项下可见，但仓库 Issues 页 / `list_enterprise_issues(project_id, search=ident)` 查不到时：

1. 读父项详情，确认 `id`/`project_id`/`program_id`/`issue_type.id`。
2. 每个子项 `update_enterprise_issue` 补 `parent_id`/`project_id`/`program_id`。
3. 每子项更新后即 `list_enterprise_issues(project_id=父项 project_id, search=子项 ident)` 验证仓库可见。
4. Gitee 若不许后改归属：重建仓库可见子 issue（复制标题/正文/父子/标签），旧项评论“已迁移”并关闭。

## Wayfinding operations

供 `/wayfinder` 用。**map** = 单个 Gitee issue，**child** = map 的子 issue。语义见 `/wayfinder` SKILL.md，本节只定义 Gitee 物理实现。

- **标签命名（Gitee 不支持冒号）**：`/wayfinder` 文本写 `wayfinder:map` / `wayfinder:<type>`（GitHub 习惯），Gitee 实测不支持冒号，本仓用连字符——map 标签 `wayfinder-map`；type 标签 `wayfinder-<type>` ∈ `wayfinder-research` / `wayfinder-prototype` / `wayfinder-grilling` / `wayfinder-task`。先在 Gitee「标签管理」建齐 5 个。
- **Map**：`create_enterprise_issue(title=<map 名>, project_id=<仓库 id>, program_id=<项目 id>)`，紧跟 `update_enterprise_issue(label_ids=<wayfinder-map 数字 id>)`（labels 静默忽略）。body 填 Destination / Notes / Decisions-so-far / Not yet specified / Out of scope（模板见 `/wayfinder` SKILL.md）。
- **Child ticket**：`create_enterprise_issue(parent_id=<map issue id>, project_id=<继承 map>, program_id=<继承 map>, issue_type_id=<任务 1292680>)`，紧跟 `update_enterprise_issue(label_ids=<对应 type 标签数字 id>)`。`<type>` ∈ research / prototype / grilling / task。继承流程见上「创建子 issue」。
- **Blocking**：Gitee MCP 无 native dependencies——`create_enterprise_issue` 的 `link_issue_id`（创建时传入，无 update 对等项）只建弱关联（UI 可见，非阻塞）。回退 body 约定：ticket body 顶部写 `Blocked by: <标题> (<ident>)`，每行一个。unblocked 当且仅当每个 blocker `state == "closed"`（逐个 `get_enterprise_issue_detail` 查）。`link_issue_id` 可选辅助：创建子 ticket 时传 `link_issue_id=<blocker ident>`。
- **Frontier query**：按父查子（查询姿势见「操作约定·查子工单」），剔除有 `assignee`（已认领）+ body 含未闭环 `Blocked by:` 的；按创建顺序取首个。
- **Claim**：`update_enterprise_issue(issue_id=<ticket>, assignee_id=<自己 user id>)`。user id 用 `list_enterprise_members` 查。开放未分配 = 未认领。**实质工作前先 claim**，避并发抢同一 ticket。
- **Resolve**：① `comment_enterprise_issue(issue_id=<ticket>, body=<answer>)` 发结论；② `update_enterprise_issue(issue_id=<ticket>, issue_state_id=4501158)` 置「已完成」（child 皆任务型；枚举见上「关闭」）；③ 往 map body 的 `## Decisions so far` 追加 `- [<标题>](<url>) — <gist>`——`description` **整体替换非 append**，先 `get_enterprise_issue_detail(map)` 取 body，拼接，整体写回。
