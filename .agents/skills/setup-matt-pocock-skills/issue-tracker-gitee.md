# Issue tracker: Gitee

Issues and PRDs for this repo live in the repo's Gitee Issues. Read the remote from `git remote -v` (e.g. `git@gitee.com:<org>/<repo>.git`; web issues at `https://gitee.com/<org>/<repo>/issues`).

All issue and PR reads and writes use the repository-configured **Gitee Enterprise MCP tools** (`mcp__gitee-ent__*`). Read the repository's channel rules before calling them. If MCP is unavailable, report the blocked operations and continue only independent local work. Browser automation, REST, curl, and scripted API calls are not alternate channels.

Preserve the repository's existing ID, ownership, creation-verification, and lifecycle policies when updating this configuration. Resolve their authoritative documents through `CLAUDE.md` or `AGENTS.md`; keep repository-specific sections in this tracker document. This seed describes tool usage and does not replace those policies.

The names below are the canonical operations; verify exact arg names against each tool's live MCP schema.

## Conventions

- **Create an issue**: `create_enterprise_issue(enterprise_id, title, description, project_id, program_id, assignee_id)` uses numeric IDs; pass non-zero repository and program IDs. Resolve the current token user with `get_user_info`. If the user names an owner, resolve that person with `list_enterprise_members` and keep the creator among the collaborators; ask when the owner is ambiguous. Otherwise, assign the creator. Preserve explicitly named collaborators according to repository policy. Multi-line bodies go in `description`. Add labels with a separate `update_enterprise_issue(label_ids=...)` using numeric label IDs. Read back the description, repository, program, owner, and collaborators, then confirm repository visibility with `list_enterprise_issues(project_id=..., search=<new ident>)` before reporting success.
- **Read an issue**: `get_enterprise_issue_detail` for the issue; `list_enterprise_issue_comments` (`enterprise_id` + `issue_id`) for comments.
- **List issues**: `list_enterprise_issues`, filter by `state` (`open` / `closed` / `rejected` / `progressing`); filter by label via `label_ids` (numeric ids).
- **Comment on an issue**: `comment_enterprise_issue` (`enterprise_id` + `issue_id` + `body`).
- **Apply / remove labels**: `update_enterprise_issue` accepts `label_ids` as a comma-separated string of numeric IDs from `list_enterprise_labels`. Read existing labels and merge the requested changes before writing the full set.
- **Resolve or close**: use `update_enterprise_issue(issue_state_id=...)`, following the repository's state machine and the issue's type. Query `list_issue_type_states` if state IDs need verification. Development completion, PR merge, and terminal closure can be separate states; do not assume "已完成" means `state == "closed"`, or close a parent requirement when completing an Agent-owned child task.

For timeouts or missing responses, treat the result as unknown and query through MCP before any dependent write. A create call is not a verification tool. If fields or repository visibility are wrong, verify and correct the existing issue; if the result remains uncertain, stop dependent writes and report it. Apply retry limits from the repository's channel rules.

Enterprise MCP tools locate an issue by `enterprise_id` (look it up with `list_enterprises`, matching your org's path) + `issue_id`, **not** by `owner/repo`.

## Sub-issue inheritance

Read the parent with `get_enterprise_issue_detail`. Inherit `parent_id = parent.id`, `project_id`, and `program_id`, but create a **task**, not the parent's requirement type. Use the repository-configured task type ID; Blue-Whale uses `1292680`. Apply the repository's child-title and ownership conventions, including required `assignee_id` and collaborators. Add `ready-for-agent` with `label_ids`. Read back the child to verify its type, parent, description, repository, program, owner, and collaborators, then confirm repository visibility with `list_enterprise_issues(project_id=..., search=<child ident>)`. Correct and re-verify mismatches before handoff; do not create another issue merely because a lookup failed.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Gitee repos do not currently treat external PRs as feature-request entry points. Set to `yes` and describe the MR-equivalent flow if yours does; `/triage` reads this flag.)_

Gitee uses "pull request" terminology (its Chinese UI may write 合并请求). When this flag is `yes`, external PRs run through the same labels and states as issues, using the `*_enterprise_pull` / `*_pull` MCP equivalents — `create_enterprise_repo_pull`, `get_enterprise_pull_detail`, `list_enterprise_pulls`, `comment_enterprise_pull`. Note `create_enterprise_repo_pull` also requires the **numeric `project_id`** (the path string 404s here too).

## When a skill says "publish to the issue tracker"

Create a Gitee issue through the configured enterprise MCP tools, then complete the readback and repository-visibility checks above.

## When a skill says "fetch the relevant ticket"

Read the issue and its comments with `get_enterprise_issue_detail` + `list_enterprise_issue_comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single Gitee issue with **child** issues as tickets. `/wayfinder` defines the semantics; this section only fixes their physical implementation on Gitee (enterprise MCP).

- **Label naming (Gitee forbids colons)**: `/wayfinder`'s text writes `wayfinder:map` / `wayfinder:<type>` (GitHub's colon convention). **Gitee labels do not allow colons** — use hyphens instead: the map label is `wayfinder-map`; a type label is `wayfinder-` + `<type>` → `wayfinder-research` / `wayfinder-prototype` / `wayfinder-grilling` / `wayfinder-task`. Create all five in Gitee's label management first.
- **Map**: create one issue with non-zero repository and program IDs and the required owner. Add the `wayfinder-map` label and complete creation verification. The body uses Destination / Notes / Decisions-so-far / Not yet specified / Out of scope from `/wayfinder`.
- **Child ticket**: use the task-type and inheritance procedure above. Add the numeric label ID for `wayfinder-research`, `wayfinder-prototype`, `wayfinder-grilling`, or `wayfinder-task`.
- **Blocking**: where MCP has no native blocking endpoint, write `Blocked by: <ticket title> (<ident>)` for each blocker. A creation-time `link_issue_id` is only a weak related link. Check each blocker through MCP against the repository's configured completion criterion before calling a ticket unblocked.
- **Frontier query**: list the relevant repository issues with pagination, then filter by the parent's numeric `parent_id`; a parent-identifier text search does not enumerate children. Apply the repository's claim and blocking rules, then choose in creation order. Preserve existing repository criteria when seeding this section.
- **Claim**: resolve the current token user through `get_user_info`, then use the repository's ownership and state-transition procedure. Preserve collaborators according to that policy and claim before starting real work.
- **Resolve**: post the answer through MCP and apply the repository's development-completion state. Read the map body before appending the decision, then write the whole `description` back. Verify the result through MCP. Development completion does not by itself authorize a PR, PR merge, or parent-requirement closure.
