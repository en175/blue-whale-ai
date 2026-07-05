# Issue tracker: Gitee

本仓库的 issue 和 PRD 存放在 Gitee 仓库的 Issues 中。
远程地址：`git@gitee.com:hangzhou_xuanfu_1/blue-whale-ai.git`
（网页：https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues）

Gitee 不像 GitHub/GitLab 有成熟的 `gh`/`glab` 官方 CLI，因此本工作流以**自由文本**形式描述。操作 issue 时优先使用：

1. **Gitee MCP 工具**（如本会话中可用）：`mcp__gitee__create_issue`、`mcp__gitee__list_repo_issues`、`mcp__gitee__get_repo_issue_detail`、`mcp__gitee__update_issue`、`mcp__gitee__create_comment`、`mcp__list_comments`。
2. **Gitee 网页**（MCP 工具不可用时的回退）：通过上述网页地址手动创建/查看/评论。

## 约定（按操作）

- **创建 issue**：调用 `mcp__gitee__create_issue`（owner/repo 从 `git remote -v` 推断，示例 `hangzhou_xuanfu_1` / `blue-whale-ai`；传入 title/body/labels）。多行 body 直接作为字符串传入。
- **读取 issue**：`mcp__gitee__get_repo_issue_detail` 取详情；`mcp__list_comments`（`resource_type="issue"`）取评论。
- **列出 issue**：`mcp__gitee__list_repo_issues`，用 `state`/`labels` 等参数过滤。
- **评论**：`mcp__gitee__create_comment`（`resource_type="issue"`）。
- **加/移除标签**：`mcp__gitee__update_issue`（`labels` 参数为逗号分隔的标签名；Gitee 标签要求长度 2–20、非特殊字符）。
- **关闭**：`mcp__gitee__update_issue`（`state="closed"`）。

owner/repo 从 `git remote -v` 推断；上面示例用 `hangzhou_xuanfu_1` / `blue-whale-ai`。

## Pull requests as a triage surface

**PRs as a request surface: no.**（Gitee 仓库当前不把外部 PR 作为功能请求入口。）

## 当技能说"publish to the issue tracker"

创建一个 Gitee issue（用上述 MCP 工具或网页）。

## 当技能说"fetch the relevant ticket"

用 `mcp__gitee__get_repo_issue_detail` + `mcp__list_comments` 读取该 issue 及其评论。
