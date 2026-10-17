# Issue tracker: Gitee

Issues and PRDs for this repo live in the repo's Gitee Issues. Read the remote from `git remote -v` (e.g. `git@gitee.com:<org>/<repo>.git`; web issues at `https://gitee.com/<org>/<repo>/issues`).

All issue and PR reads and writes use the repository-configured **Gitee Enterprise MCP tools** (`mcp__gitee-ent__*`). Read the repository's channel rules before calling them. If MCP is unavailable, report the blocked operations and continue only independent local work. Browser automation, REST, curl, and scripted API calls are not alternate channels.

Preserve the repository's existing ID, ownership, creation-verification, and lifecycle policies when updating this configuration. Resolve their authoritative documents through `CLAUDE.md` or `AGENTS.md`; keep repository-specific sections in this tracker document. This seed describes tool usage and does not replace those policies.

The names below are the canonical operations; verify exact arg names against each tool's live MCP schema.

初始化时保留仓库已有状态权威及根路由，Blue-Whale 使用 `docs/agents/gitee-workflow-agent.md`。操作手册负责 MCP，状态表与事件条件只在状态权威维护；工程依赖由集成规则定义。缺少权威时报告缺口，不能从粗状态或旧模板推断流转。

## Conventions

- **Create an issue**: follow [Issue creation](#issue-creation).
- **Read an issue**: `get_enterprise_issue_detail` for the issue; `list_enterprise_issue_comments` (`enterprise_id` + `issue_id`) for comments.
- **List issues**: `list_enterprise_issues`, filter by `state` (`open` / `closed` / `rejected` / `progressing`); filter by label via `label_ids` (numeric ids).
- **Comment on an issue**: `comment_enterprise_issue` (`enterprise_id` + `issue_id` + `body`).
- **Apply / remove labels**: `update_enterprise_issue` accepts `label_ids` as a comma-separated string of numeric IDs from `list_enterprise_labels`. Read existing labels and merge the requested changes before writing the full set.
- **状态操作**：先读仓库状态权威，再用实际类型与细状态核对条件，查询 `list_issue_type_states` 复核有效 ID。提交、工程验证、创建或合并 PR 保持业务状态，记录工程进度；开 PR 合并保留 ready-for-review 标签。状态更新不携带 description，按最少字段写入并回读；缺少细状态字段时用 issue_state_ids 精确筛选 ident、数值身份与归属。

For timeouts or missing responses, treat the result as unknown and query through MCP before any dependent write. A create call is not a verification tool. If fields or repository visibility are wrong, verify and correct the existing issue; if the result remains uncertain, stop dependent writes and report it. Apply retry limits from the repository's channel rules.

Enterprise MCP tools locate an issue by `enterprise_id` (look it up with `list_enterprises`, matching your org's path) + `issue_id`, **not** by `owner/repo`.

### Issue creation

1. Resolve ownership. Use `get_user_info` for the current token user. If the user names an owner, resolve that person with `list_enterprise_members` and include the creator among the collaborators. Ask if the owner is ambiguous. Otherwise, assign the creator. Preserve explicitly named collaborators according to repository policy.
2. Create with `create_enterprise_issue(enterprise_id, title, description, project_id, program_id, assignee_id)`. Use numeric IDs and non-zero repository and program IDs. Put multi-line content in `description`. Retain the returned issue ident or ID for the remaining steps.
3. Apply the requested labels with a separate `update_enterprise_issue(label_ids=...)`. Follow the label merge rule in Conventions.
4. Verify with `get_enterprise_issue_detail`: description is non-empty, and repository, program, owner, and collaborators match the request. For a child, also verify its task type and numeric parent ID. Confirm repository visibility with `list_enterprise_issues(project_id=..., search=<new ident>)`. Correct mismatches on the existing issue and repeat these checks.

产品规格新父单为需求型，子单为任务型；既有单沿用已核对的正确类型。规划发布与拆单保留实际初始阶段，不借免业务测试完成产品父单。父测试决策写整体行为、环境、负责人、默认随父验收和生产复验要求，子验收标准关联父行为并声明工程条件及验收归属。

Completion requires correct detail fields and visibility in the requested repository. Until both checks pass, report creation as unverified. Handle unknown results through the MCP query procedure in Conventions before any dependent write.

## Sub-issue inheritance

Read the parent with `get_enterprise_issue_detail`. Inherit `parent_id = parent.id`, `project_id`, and `program_id`, and select the repository-configured **task** type; Blue-Whale uses `1292680`. Apply the repository's child-title convention. Follow [Issue creation](#issue-creation) with these fields and the `ready-for-agent` label. Its final step verifies the child type and parent along with the common creation checks. Handoff requires all checks to pass.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Gitee repos do not currently treat external PRs as feature-request entry points. Set to `yes` and describe the MR-equivalent flow if yours does; `/triage` reads this flag.)_

Gitee uses "pull request" terminology (its Chinese UI may write 合并请求). When this flag is `yes`, external PRs run through the same labels and states as issues, using the `*_enterprise_pull` / `*_pull` MCP equivalents — `create_enterprise_repo_pull`, `get_enterprise_pull_detail`, `list_enterprise_pulls`, `comment_enterprise_pull`. Note `create_enterprise_repo_pull` also requires the **numeric `project_id`** (the path string 404s here too).

## When a skill says "publish to the issue tracker"

Follow [Issue creation](#issue-creation) through its completion checks.

## When a skill says "fetch the relevant ticket"

Read the issue and its comments with `get_enterprise_issue_detail` + `list_enterprise_issue_comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single Gitee issue with **child** issues as tickets. `/wayfinder` defines the semantics; this section only fixes their physical implementation on Gitee (enterprise MCP).

- **Label naming (Gitee forbids colons)**: `/wayfinder`'s text writes `wayfinder:map` / `wayfinder:<type>` (GitHub's colon convention). **Gitee labels do not allow colons** — use hyphens instead: the map label is `wayfinder-map`; a type label is `wayfinder-` + `<type>` → `wayfinder-research` / `wayfinder-prototype` / `wayfinder-grilling` / `wayfinder-task`. Create all five in Gitee's label management first.
- **Map**: follow [Issue creation](#issue-creation) with the `wayfinder-map` label. The body uses Destination / Notes / Decisions-so-far / Not yet specified / Out of scope from `/wayfinder`.
- **Child ticket**: use the task-type and inheritance procedure above. Add the numeric label ID for `wayfinder-research`, `wayfinder-prototype`, `wayfinder-grilling`, or `wayfinder-task`.
- **Blocking**：MCP 没有原生阻塞端点时，在前置工单章节写编号、标题、链接与解锁要求，兼容旧 Blocked by。link_issue_id 仅是弱关联。同包工程前置、必须先独立入 release 的外部前置、验收或环境前置按仓库集成规则核验，不以粗状态 closed 统一解锁。
- **Frontier query**: list the relevant repository issues with pagination, then filter by the parent's numeric `parent_id`; a parent-identifier text search does not enumerate children. Apply the repository's claim and blocking rules, then choose in creation order. Preserve existing repository criteria when seeding this section.
- **Claim**: resolve the current token user through `get_user_info`, then use the repository's ownership and state-transition procedure. Preserve collaborators according to that policy and claim before starting real work.
- **Resolve**：通过 MCP 发布结论和工程验证、交付指针，保持业务状态。依据状态权威判断部署、验收与收口，免业务测试也需满足本票交付条件。先读 map 正文再追加决策，单独整体写回 description 并核验；工程交付不授权 PR 发布、合并或父单验收。
