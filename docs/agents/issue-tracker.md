# Issue tracker: Gitee

Issues and PRDs for this repo live in Gitee, in the repository
`hangzhou-xuanfu_1/blue-whale-ai`.

## How skills interact with it

Read/write issues via the **Gitee MCP** tools (mcp__gitee__*), not the `gh` CLI.

- Create an issue → `mcp__gitee__create_issue` (owner=hangzhou-xuanfu_1, repo=blue-whale-ai)
- List/fetch issues → `mcp__gitee__list_repo_issues` / `mcp__gitee__get_repo_issue_detail`
- Apply triage labels → `mcp__gitee__update_issue` (labels param, comma-separated)
- Comment → `mcp__gitee__create_comment`

## External PRs as a triage surface

No. Only issues are triaged. (Gitee external PRs are not pulled into the triage queue.)

## Label note

Gitee label constraints: 2–20 chars, no special characters. All five default
triage labels satisfy this and have been pre-created.
