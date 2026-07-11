# Issue tracker: Gitee

本仓库的 issue 和 PRD 存放在 Gitee 仓库的 Issues 中。
远程地址：`git@gitee.com:hangzhou_xuanfu_1/blue-whale-ai.git`
（网页：https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues）

Gitee 不像 GitHub/GitLab 有成熟的 `gh`/`glab` 官方 CLI，因此本工作流以**自由文本**形式描述。操作 issue 时优先使用：

1. **Gitee MCP 工具**（如本会话中可用）：`mcp__gitee-ent__create_enterprise_issue`、`mcp__gitee-ent__list_enterprise_issues`、`mcp__gitee-ent__get_enterprise_issue_detail`、`mcp__gitee-ent__update_enterprise_issue`、`mcp__gitee-ent__comment_enterprise_issue`、`mcp__gitee-ent__list_enterprise_issue_comments`。
2. **Gitee 网页**（MCP 工具不可用时的回退）：通过上述网页地址手动创建/查看/评论。

## 历史：曾用普通版 MCP（已废弃）

> 早期本环境只有普通版 `mcp__gitee__*`，操作差异曾记于此。**现已统一企业版 `mcp__gitee-ent__*`**（与官方 [mcp-gitee-ent](https://gitee.com/oschina/mcp-gitee-ent) 工具集一致），下文「约定」全按企业版写。普通版操作细节已删除，需要时查 git 历史（2026-07-11 清理）。

> 注：仓库 owner 拼写 `hangzhou-xuanfu_1`（hangzhou-连字符-xuanfu_下划线-1）。上方「远程地址」全下划线 `hangzhou_xuanfu_1` 是历史误写——`git push` 容忍重定向，但 **MCP API + 网页 URL 严格匹配**，全下划线 404。

## 约定（按操作）

- **创建 issue**：调用 `mcp__gitee-ent__create_enterprise_issue`（用 `enterprise_id` 定位本企业，传入 `title`/`description`；正文多行直接作为字符串传入 `description`）。**必须传 `project_id` 关联仓库**——blue-whale-ai 仓库的 ID 用 `mcp__gitee-ent__list_enterprise_repositories` 查。不传则工单只出现在企业工作项列表、仓库 Issues 页看不到（历史事件 IJZ5WA），PreToolUse hook `block-issue-without-repo.sh` 会硬拦。决策见 [ADR-0007](../adr/0007-issue-must-link-repo.md)。**打标签用 `label_ids`（逗号分隔的标签数字 ID，见下「加/移除标签」），不是 `labels`**——`create_enterprise_issue` 对企业私有仓库的 labels 会静默忽略，需紧跟一次 `update_enterprise_issue` 补 `label_ids`（见 [[gitee-collab-facts]] 第 4 条历史）。
- **创建可交给 Agent 的子 issue**：先用 `mcp__gitee-ent__get_enterprise_issue_detail(parent_ident)` 读取父项，再创建子项并继承父项字段：`parent_id=parent.id`、`project_id=parent.project_id`、`program_id=parent.program_id`、`issue_type_id=parent.issue_type.id`。创建后紧跟 `update_enterprise_issue` 补 `ready-for-agent` 的 `label_ids`，再用 `mcp__gitee-ent__list_enterprise_issues(project_id=parent.project_id, search=new_ident)` 反查；查不到则视为发布失败，不交给 Agent。决策见 [ADR-0008](../adr/0008-sub-issues-must-inherit-repo.md)。
- **读取 issue**：`mcp__gitee-ent__get_enterprise_issue_detail` 取详情；`mcp__gitee-ent__list_enterprise_issue_comments`（`enterprise_id`+`issue_id`）取评论。
- **列出 issue**：`mcp__gitee-ent__list_enterprise_issues`，用 `state`（open/closed/rejected/progressing）过滤；标签过滤用 `label_ids`（数字 ID）。
- **评论**：`mcp__gitee-ent__comment_enterprise_issue`（`enterprise_id`+`issue_id`+`body`）。
- **加/移除标签**：`mcp__gitee-ent__update_enterprise_issue`（`label_ids` 为逗号分隔的**标签数字 ID**；ID 用 `mcp__gitee-ent__list_enterprise_labels` 查。Gitee 标签要求长度 2–20、非特殊字符）。
- **关闭**：`mcp__gitee-ent__update_enterprise_issue`（**`issue_state_id`**，不是 `state`——`update_enterprise_issue` 无 `state` 入参）。合法状态枚举按 issue 所属「工作项类型」不同而不同：先 `mcp__gitee-ent__list_issue_type_states(enterprise_id, issue_type_id)` 查（本仓「需求」类型 = 意向/进行中/已完成/已拒绝，**无 closed/open**），完成 = 传「已完成」对应的 id；`issue_type_id` 从 `get_enterprise_issue_detail` 返回的 `issue_type.id` 取。设完成后 issue 的 `state` 字段会变成 `"closed"`。

企业版 MCP 工具用 `enterprise_id`（本企业 ID，用 `mcp__gitee-ent__list_enterprises` 查，按 `path == "hangzhou_xuanfu_1"` 匹配取 `id`）+ `issue_id` 定位，**非 owner/repo**；各工具确切参数以 MCP schema 为准。远程地址从 `git remote -v` 读。

## 子 issue 迁移 Runbook

适用：子工作项已出现在企业工作台父项下，但仓库 Issues 页或 `list_enterprise_issues(project_id, search=ident)` 查不到。

1. 读取父项详情，确认 `id`、`project_id`、`program_id`、`issue_type.id`。
2. 对每个子项先尝试 `update_enterprise_issue` 补齐 `parent_id=父项 id`、`project_id=父项 project_id`、`program_id=父项 program_id`。
3. 每个子项更新后立刻用 `list_enterprise_issues(project_id=父项 project_id, search=子项 ident)` 验证仓库可见。
4. 如果 Gitee 不允许后改归属，则重新创建仓库可见子 issue，复制标题/正文/父子关系/标签；旧子项评论“已迁移到新仓库 Issue”，再关闭旧项。

已知待迁移样例：`IJZ74J` / `IJZ74K` / `IJZ74L` / `IJZ74M` / `IJZ74N`，父项 `IJZ5WA`。迁移动作会写真实 Gitee 数据，执行前必须单独确认。

## Pull requests as a triage surface

**PRs as a request surface: no.**（Gitee 仓库当前不把外部 PR 作为功能请求入口。）

## 当技能说"publish to the issue tracker"

创建一个 Gitee issue（用上述 MCP 工具或网页）。

## 当技能说"fetch the relevant ticket"

用 `mcp__gitee-ent__get_enterprise_issue_detail` + `mcp__gitee-ent__list_enterprise_issue_comments` 读取该 issue 及其评论。
