# Issue tracker: Gitee

仓库 `git@gitee.com:hangzhou-xuanfu_1/blue-whale-ai.git`（网页 https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues）。优先 MCP 工具，不可用时回退网页。

## ID 解析约定（通用，先于任何 `mcp__gitee-ent__*` 调用读）

> 本节是**所有**企业版 MCP 调用（issue / PR / 仓库 / 标签……）的通用约定，不限于 issue 创建。

**黄金法则：`enterprise_id` 与 `project_id` 永远动态查，永不从网页 URL 抄。** 本仓三个固定 ID 的兜底值（日常直接用、免查询）见 CLAUDE.md「Gitee ID 兜底常量」；疑似变更或 401 时按本节动态查。

Gitee 的两类标识符是脱节的，这是最易踩的陷阱：

| 标识符 | 出现在哪 | 能否直接用于 API |
|---|---|---|
| 网页路由 ID（如 URL `projects/883843` 的 `883843`） | 网页 URL | ❌ **绝不可**——既非 enterprise_id 也非 project_id |
| `enterprise_id`（如 `16660949`） | 仅 `list_enterprises` 返回 | ✅ |
| `project_id`（如 `48854568`） | 仅 `list_enterprise_repositories` 返回 | ✅ |
| PR 编号（URL `pulls/93` 的 `93`） | 网页 URL | ✅ URL 里**唯一**可直接抄的数字 |
| issue ident（如 `IJZYUL`） | 网页 URL / 工单标题 | ✅ 字符串标识，非数字 ID |

**误传 ID 的症状具有误导性**：把网页路由 ID 当 `enterprise_id` 传入，Gitee 返回 `401 企业未授权此应用进行访问`——这条信息**措辞误导**，实为「该 ID 指向的企业不存在」，与 OAuth 授权无关。遇到此 401，**先判 token 再判 ID**，不要先怀疑授权：

```
步骤 1  调 get_user_info()
          ├─ 成功 → token 有效 → 进入步骤 2
          └─ 401  → token 失效/类型不符（普通版 REST 报 "Access token is wrong type"）
步骤 2  token 有效仍 401 = ID 错（最常见）
          调 list_enterprises() 核对真实 enterprise_id
```

**一键解析**：`scripts/gitee-resolve-ids.sh resolve <PR/issue URL>` 输出企业 path、仓库 path、资源编号，并标注 URL 中哪个数字是陷阱、给出可直接执行的 MCP 查询模板。`check-id` 子命令校验单个 ID 值，`diagnose-401` 打印上面的决策树。新同事拿到一条 URL，第一步就跑它。

## 定位

企业版 MCP（`mcp__gitee-ent__*`）用以下 ID 定位，**非 owner/repo**：

- **enterprise_id**：`list_enterprises` 查，按 `path == "hangzhou-xuanfu_1"` 取 `id`。
- **project_id**（仓库 ID）：`list_enterprise_repositories` 查。创建 issue **必传**——不传则工单只进企业工作项、仓库 Issues 页不可见，PreToolUse hook `block-issue-without-repo.sh` 硬拦。
- **program_id**（项目 ID）：`list_programs` 查（按 `name`/`search` 命中 Blue-Whale-AI 项目）。根 issue 创建**必传**且非 0——不传（=0）则工单游离于企业「项目管理」之外，同一 hook 硬拦。值不写死，对齐 ADR-0007 D5 动态查。
- **label 数字 ID**：`list_enterprise_labels` 查；`label_ids` 传逗号分隔的数字 ID（非名称）。标签长度 2–20、非特殊字符。

## 操作约定

- **创建**：`create_enterprise_issue(enterprise_id, title, description, project_id=..., program_id=...)`。根 issue 的 `project_id`（仓库）和 `program_id`（项目）都**必传**且非 0——缺任一则 hook 硬拦（见上「定位」）。标签不能在 create 落——企业私有仓库 `labels` 静默忽略，紧跟一次 `update_enterprise_issue(label_ids=...)` 补。**创建后必须 `get_enterprise_issue_detail` 回读确认 `description` 非空**——错名参数（如把描述传到 `body`）被静默忽略，已踩坑建成空描述工单（IK5THP）；回读验证是防静默忽略的通用要求，PR / Release 创建后同样适用；入参名以工具 schema 为准，不凭印象。
- **创建子 issue（交 Agent）**：先 `get_enterprise_issue_detail(parent_ident)` 读父项，子项继承 `parent_id`/`project_id`/`program_id`/`issue_type_id`。**标题命名：`【<前端|后端>-<功能域>】<任务标题>`**（例：`【后端-音频提取】画布视频节点提取音频（media_extract）`）——`前端|后端` 标明改动归属端，`功能域` 简述用于区分同一父项下的并列子任务。create 后 `update_enterprise_issue` 补 `ready-for-agent` label_ids，再 `list_enterprise_issues(project_id=parent.project_id, search=new_ident)` 反查；查不到 = 发布失败，不交 Agent。
- **读取**：`get_enterprise_issue_detail` 取详情；`list_enterprise_issue_comments(enterprise_id, issue_id)` 取评论。
- **列出**：`list_enterprise_issues`，`state` 过滤（open/closed/rejected/progressing），`label_ids` 过滤（数字 ID）。
- **评论**：`comment_enterprise_issue(enterprise_id, issue_id, body)`。
- **标签**：`update_enterprise_issue(label_ids=...)`，数字 ID。Triage 五标签：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix，详见 `docs/agents/triage-labels.md`。
- **创建 PR**：`create_enterprise_repo_pull` **必传数字 `project_id`**——工具描述写「Project ID or PathWithNamespace」，**实际传 PathWithNamespace（如 `hangzhou-xuanfu_1/blue-whale-ai`）会 404「仓库不存在」**，勿被误导。
- **合并 PR**：`merge_enterprise_pull` 传 `merge_method=merge`（或不传）；工具**无 `prune_source_branch` 参数**，Gitee merge 默认不删源分支，事后跑 `scripts/cleanup-task-worktree.sh`。
- **关闭**：`update_enterprise_issue(issue_state_id=...)`，**非 `state`**（工具无此入参）。状态枚举随工作项类型变——先 `list_issue_type_states(enterprise_id, issue_type_id)` 查（本仓「需求」= 意向/进行中/已完成/已拒绝，无 closed/open），完成传「已完成」id；完成后 `state` 字段变 `"closed"`。

## 任务状态机（Agent 全自动流转）

看板状态必须实时反映真实进度。以下流转由 Agent 在触发点主动执行，不等人手动改。

### 状态白名单（仅此这些流转，状态 id 为本仓实测值）

| 触发点 | 类型 | 流转 |
| --- | --- | --- |
| worktree 入口成功且带 `--issue` | 需求 | 意向(4336301) → 进行中(4336298) |
| 同上 | 任务 | 待办的(4336297) → 进行中(4336298) |
| 同上 | 缺陷 | 待确认(4336303)/已确认(4336304) → 修复中(4336305) |
| PR 创建成功 | 全部 | 打 `ready-for-review` 标签(id 344268623) |
| PR 合并成功 | 需求/任务 | → 已完成(4336299) |
| PR 合并成功 | 缺陷 | → 已修复(4336306)，另打 `修复待验证` 标签(id 344168629) |

- **禁止 Agent 设置**：已验收(4336307)、已拒绝(4336302)、已取消(4336300) —— 归人操作。
- 只读任务（调研/答疑/评审，不建 worktree）不触发状态流转；`--no-issue` 任务无状态可改。

### 开工流转（worktree 入口成功后立即执行）

1. `get_enterprise_issue_detail` 查当前状态。
2. 前置状态判定：
   - 预期起点（需求=意向、任务=待办的、缺陷=待确认/已确认）→ 调 `update_enterprise_issue(issue_state_id=<目标>)` 流转。缺陷在「待确认」也直接跳「修复中」（认领即确认），不走「已确认」中间步。
   - 已是「进行中」→ **停止**，向用户报告并等待指示（可能他人/另一会话在做）。
   - 已是终态（已完成/已取消/已拒绝）→ **停止**，向用户报告并等待指示（防重复做已完成任务）。
3. 状态 id 疑似失效（报错）时按 `list_issue_type_states(enterprise_id, issue_type_id)` 重查，不得凭本表死磕。

### 完成流转（PR 合并成功后执行）

- 按白名单表置完成态；缺陷另打 `修复待验证`。
- 补标签时 `label_ids` 是整体语义：先 `get_enterprise_issue_detail` 取现有标签，合并后整体写回，不得只传新标签覆盖掉旧标签。

### 失败处理

- 状态/标签变更失败：重试一次。
- 仍失败：继续主线工作不阻塞，但最终汇报必须置顶标红「⚠️ 工单状态未同步」，附手动指引（工单号 + 目标状态名 + 状态 id）。
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
- **Child ticket**：`create_enterprise_issue(parent_id=<map issue id>, project_id=<继承 map>, program_id=<继承 map>, issue_type_id=<继承 map>)`，紧跟 `update_enterprise_issue(label_ids=<对应 type 标签数字 id>)`。`<type>` ∈ research / prototype / grilling / task。继承流程见上「创建子 issue」。
- **Blocking**：Gitee MCP 无 native dependencies——`create_enterprise_issue` 的 `link_issue_id`（创建时传入，无 update 对等项）只建弱关联（UI 可见，非阻塞）。回退 body 约定：ticket body 顶部写 `Blocked by: <标题> (<ident>)`，每行一个。unblocked 当且仅当每个 blocker `state == "closed"`（逐个 `get_enterprise_issue_detail` 查）。`link_issue_id` 可选辅助：创建子 ticket 时传 `link_issue_id=<blocker ident>`。
- **Frontier query**：`list_enterprise_issues(project_id=<map project_id>, state="open")`，客户端筛 `parent.id == <map issue id>`（list 无 parent_id 参数）；剔除有 `assignee`（已认领）+ body 含未闭环 `Blocked by:` 的；按创建顺序取首个。
- **Claim**：`update_enterprise_issue(issue_id=<ticket>, assignee_id=<自己 user id>)`。user id 用 `list_enterprise_members` 查。开放未分配 = 未认领。**实质工作前先 claim**，避并发抢同一 ticket。
- **Resolve**：① `comment_enterprise_issue(issue_id=<ticket>, body=<answer>)` 发结论；② `update_enterprise_issue(issue_id=<ticket>, issue_state_id=<「已完成」id>)` 关闭（枚举见上「关闭」）；③ 往 map body 的 `## Decisions so far` 追加 `- [<标题>](<url>) — <gist>`——`description` **整体替换非 append**，先 `get_enterprise_issue_detail(map)` 取 body，拼接，整体写回。
