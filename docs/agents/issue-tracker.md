# Issue tracker: Gitee

仓库 `git@gitee.com:hangzhou_xuanfu_1/blue-whale-ai.git`（网页 https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues）。优先 MCP 工具，不可用时回退网页。

## 定位

企业版 MCP（`mcp__gitee-ent__*`）用以下 ID 定位，**非 owner/repo**：

- **enterprise_id**：`list_enterprises` 查，按 `path == "hangzhou_xuanfu_1"` 取 `id`。
- **project_id**（仓库 ID）：`list_enterprise_repositories` 查。创建 issue **必传**——不传则工单只进企业工作项、仓库 Issues 页不可见，PreToolUse hook `block-issue-without-repo.sh` 硬拦。
- **label 数字 ID**：`list_enterprise_labels` 查；`label_ids` 传逗号分隔的数字 ID（非名称）。标签长度 2–20、非特殊字符。

## 操作约定

- **创建**：`create_enterprise_issue(enterprise_id, title, description, project_id=...)`。标签不能在 create 落——企业私有仓库 `labels` 静默忽略，紧跟一次 `update_enterprise_issue(label_ids=...)` 补。
- **创建子 issue（交 Agent）**：先 `get_enterprise_issue_detail(parent_ident)` 读父项，子项继承 `parent_id`/`project_id`/`program_id`/`issue_type_id`。create 后 `update_enterprise_issue` 补 `ready-for-agent` label_ids，再 `list_enterprise_issues(project_id=parent.project_id, search=new_ident)` 反查；查不到 = 发布失败，不交 Agent。
- **读取**：`get_enterprise_issue_detail` 取详情；`list_enterprise_issue_comments(enterprise_id, issue_id)` 取评论。
- **列出**：`list_enterprise_issues`，`state` 过滤（open/closed/rejected/progressing），`label_ids` 过滤（数字 ID）。
- **评论**：`comment_enterprise_issue(enterprise_id, issue_id, body)`。
- **标签**：`update_enterprise_issue(label_ids=...)`，数字 ID。
- **关闭**：`update_enterprise_issue(issue_state_id=...)`，**非 `state`**（工具无此入参）。状态枚举随工作项类型变——先 `list_issue_type_states(enterprise_id, issue_type_id)` 查（本仓「需求」= 意向/进行中/已完成/已拒绝，无 closed/open），完成传「已完成」id；完成后 `state` 字段变 `"closed"`。

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
- **Map**：`create_enterprise_issue(title=<map 名>, project_id=<仓库 id>, program_id=<可选>)`，紧跟 `update_enterprise_issue(label_ids=<wayfinder-map 数字 id>)`（labels 静默忽略）。body 填 Destination / Notes / Decisions-so-far / Not yet specified / Out of scope（模板见 `/wayfinder` SKILL.md）。
- **Child ticket**：`create_enterprise_issue(parent_id=<map issue id>, project_id=<继承 map>, program_id=<继承 map>, issue_type_id=<继承 map>)`，紧跟 `update_enterprise_issue(label_ids=<对应 type 标签数字 id>)`。`<type>` ∈ research / prototype / grilling / task。继承流程见上「创建子 issue」。
- **Blocking**：Gitee MCP 无 native dependencies——`create_enterprise_issue` 的 `link_issue_id`（创建时传入，无 update 对等项）只建弱关联（UI 可见，非阻塞）。回退 body 约定：ticket body 顶部写 `Blocked by: <标题> (<ident>)`，每行一个。unblocked 当且仅当每个 blocker `state == "closed"`（逐个 `get_enterprise_issue_detail` 查）。`link_issue_id` 可选辅助：创建子 ticket 时传 `link_issue_id=<blocker ident>`。
- **Frontier query**：`list_enterprise_issues(project_id=<map project_id>, state="open")`，客户端筛 `parent.id == <map issue id>`（list 无 parent_id 参数）；剔除有 `assignee`（已认领）+ body 含未闭环 `Blocked by:` 的；按创建顺序取首个。
- **Claim**：`update_enterprise_issue(issue_id=<ticket>, assignee_id=<自己 user id>)`。user id 用 `list_enterprise_members` 查。开放未分配 = 未认领。**实质工作前先 claim**，避并发抢同一 ticket。
- **Resolve**：① `comment_enterprise_issue(issue_id=<ticket>, body=<answer>)` 发结论；② `update_enterprise_issue(issue_id=<ticket>, issue_state_id=<「已完成」id>)` 关闭（枚举见上「关闭」）；③ 往 map body 的 `## Decisions so far` 追加 `- [<标题>](<url>) — <gist>`——`description` **整体替换非 append**，先 `get_enterprise_issue_detail(map)` 取 body，拼接，整体写回。
