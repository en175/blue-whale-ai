# Frontend feature workflow

Use this reference only when the user explicitly requests the feat workflow. It supplements `frontend-delivery` and the repository-root `CLAUDE.md`.

## Non-negotiable rules

- A Gitee Issue is optional context, not an entry condition. A direct requirement may enter clarification when it clearly communicates the user goal and main journey.
- Do not create a worktree, write code, install dependencies, or start services before the user explicitly confirms the “frontend executable requirement”.
- After confirmation, create the plan and implement by default. Pause only for a material choice or high-risk change.
- Deliver only `web/**`. If work needs backend, shared contracts, root tools, root rules, or PR-template changes, stop and request a separately scoped Issue; never conceal a cross-boundary need with a frontend workaround.
- Manual `dev:test` regression is a delivery gate. Without an explicit human pass, do not claim completion or create/update a PR or merge.
- Never invent login accounts, permissions, test data, API behavior, or acceptance results. Mark unknown details and ask only questions that would change the implementation.

## 0. Intake

Record facts in this order:

1. PRD or direct requirement supplied by the user;
2. optional Gitee Issue, read under repository Issue rules;
3. read-only code investigation used to resolve ambiguity.

Without an Issue, do not ask for one or force a template. The requirement must at least explain the user goal, entry or main journey, and expected result. When a missing detail leaves two or more safe but materially different frontend behaviors, ask focused questions and wait.

## 1. Gate A — frontend executable requirement

Before writing product code, produce the following Markdown. Mark every statement **confirmed**, **inferred**, or **open**; explain the source of each inference.

```md
# <Feature name>｜Frontend executable requirement

## Goal and scope
- User/business goal:
- Included:
- Explicitly excluded:
- Source: <PRD | Issue #... | direct requirement; Issue optional>

## User journey
1. Entry:
2. Main action and page feedback:
3. Successful outcome or destination:

## UI and interaction rules
- Page, route, and entry:
- Fields, display rules, and defaults:
- Actions, validation, confirmation, and feedback:
- Loading, empty, forbidden, error, and success states:

## Dependencies and constraints
- API, data, and permissions:
- Analytics, compatibility, performance, or design constraints:
- Known test data or prerequisites:

## Acceptance checklist
- [ ] <human-observable result>

## Decisions needed from you
- <only scope, behavior, contract, or acceptance decisions; write “none” when empty>
```

End by asking the user to confirm or revise the requirement. Before an explicit confirmation, only clarify or investigate read-only; silence, continued discussion, or “take a look” is not confirmation.

## 2. Confirmed requirement → worktree and plan

After confirmation:

1. Run the repository `start-task-worktree.sh --type feature` with `--issue <id>` when the supplied Issue passes its state-machine precondition; otherwise use `--no-issue`. Write only in the resulting task worktree and branch.
2. New server-state reads/writes, pages, or polling must also follow [request.md](request.md) and its TanStack Query rules.
3. Produce a complete implementation plan from read-only code investigation. It must map every Gate A acceptance item and include exact files and responsibilities; UI, data, state, and error handling; API, permissions, routes, analytics, and compatibility; automated tests, commands, and human regression paths; risks, assumptions, and exclusions.
4. Show the plan and implementation readiness conclusion in the conversation. For ordinary page work, proceed without creating a second approval gate.

Pause and present options, impacts, and a recommendation when the investigation requires an API/shared-contract change, routing or permission-model change, broad public-component refactor, new dependency, data deletion/migration, security/privacy change, or unclear acceptance. If the requirement must materially change, return to Gate A.

## 3. Implement and verify

Implement the confirmed requirement and plan only under `web/**`.

1. Add automatable coverage for important business rules, state transitions, request payloads, or component interactions. Leave visual, login, and cross-page paths to manual regression.
2. During development, run directly relevant tests, type checks, and lint. Fix failures or report them accurately; never skip them.
3. After implementation, run the repository-selected verification required by `docs/agents/testing-strategy.md`. Report actual commands, HEAD, and results only.
4. After automated checks pass, run only `npm run dev:test` from `web/` and wait for Vite’s Local URL. It uses test-environment APIs; do not start a local backend, database, or test-database tunnel.
5. Keep the service running and send this regression package:

```md
## Manual regression
- URL: <Vite Local URL + target route>
- Environment: `dev:test` (test-environment APIs; no local backend)
- Prerequisites: <only supplied accounts, permissions, or data; say unknown when absent>
- Suggested checks:
  1. <acceptance path>
  2. <key error, empty, or permission boundary>
- Known limitations or gaps: <“none” when empty>

Reply “pass”, or “fail” with steps and observed behavior.
```

Browser automation does not replace this step. A failed service start or unavailable URL is unverified and must be repaired before human regression.

## 4. Regression loop and closure

- On a human “fail”, map the report to the requirement and plan; when sufficient, fix it, run focused validation, stop the old server, restart `dev:test`, and send an updated regression package. Return to Gate A if the report changes scope or admits multiple reasonable behaviors.
- On an explicit human “pass”, finish local commits, closure verification, and the delivery report under repository Git/testing rules. Push, PR creation/update, merge, and release still require explicit user authorization.
- The final report must state the requirement source (including no Issue), actual scope/exclusions, acceptance results, change summary, automated evidence, `dev:test` URL, human regression result, risks/unverified items, and whether a local commit exists. Without a human pass, report “awaiting manual regression”, not completion.

## Invocation example

```text
使用 feat 工作流：
在项目列表页增加“只看我创建的”筛选。入口在筛选区；默认关闭；开启后列表只显示当前用户创建的项目；加载、空态和接口失败需要有明确反馈。本次不改后端接口，也没有工单。
```
