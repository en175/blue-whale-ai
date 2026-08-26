# Frontend Bugfix Workflow

This workflow applies only to a Gitee Issue-driven frontend defect repair when `frontend-delivery` was explicitly invoked. It supplements the repository-root `CLAUDE.md`; the repository Git/worktree, Issue state-machine, and testing rules remain mandatory.

## 0. Preconditions and write boundary

1. The request must include a Gitee Issue URL or identifier. Without it, stop immediately. Do not search code, create a worktree, install dependencies, or modify files.
2. Once provided, read only `get_enterprise_issue_detail` first. Its description must contain reproducible steps, actual result, expected result, affected route, user identity/prerequisite data, and acceptance criteria.
3. If any required field is absent, stop. Do not replace the Issue description with chat context, code inference, or comments. Reply exactly:

   `已终止前端 Bugfix 流程：请提供 Issue 链接或编号，并在 Issue 描述中补充可逐步执行的复现步骤、实际结果、预期结果、影响路由、用户身份/前置数据和验收条件。`

4. Never use `--no-issue`. If the Issue is already in progress, terminal, or fails the repository state-machine precondition, stop according to the root Issue rules and wait for a human instruction.
5. Once qualified, use the repository `start-task-worktree.sh --issue ...` entry point, status transitions, commit, and PR verification flow.
6. Product files, frontend dependencies, tests, fixtures, scripts, documentation, and temporary evidence may only be written below `web/**`. Confirm the target path before every write. Other repository paths may be read but not formatted, generated, staged, or modified.
7. If the fix needs a backend, shared contract, root tool, root rule, or PR-template change, stop and request a separate Issue. Do not hide a cross-boundary defect with a frontend workaround.

## 1. Reproduce before fixing

1. Reproduce the Issue steps in the smallest safe environment. Before starting local services or accessing a test environment, follow the repository service and test-site database rules.
2. Record environment, steps, actual result, and evidence. If the defect cannot be reproduced, report the blocker; a passing fixture does not replace real reproduction.
3. Choose the regression lock by defect type. Use Vitest for pure functions, state transitions, API clients, or request payloads; use Playwright for routes, login state, component interaction, or cross-component flows; use before/after screenshots plus browser smoke for style or layout-only defects.
4. Behavior, interface, or state defects require a corresponding regression lock. A Playwright-covered page flow does not also require an artificial jsdom test.

## 2. Local verification contract

Run commands from `web/`. Run `npm ci` before first use or after dependency changes. Missing dependencies mean unverified, never passed.

1. `npm run verify:bugfix` runs lint, the complete Vitest suite, and `build:release` in sequence. Stop delivery on any failure.
2. `npm run smoke:bugfix -- --scenario home-to-canvas` is independent Playwright browser verification; do not fold it into `npm test`.
3. If Chromium is missing, install it locally with `PLAYWRIGHT_BROWSERS_PATH=0 npm exec playwright install chromium`. If installation or browser execution fails, report browser verification as unverified.
4. The smoke runner builds with `build:release` and serves only release `dist/`; a development server is not an acceptable substitute.
5. Smoke tests intercept every `/api/**` request using a declared fixture keyed by HTTP method plus complete path including query. An undeclared API request fails without reaching the network. Fixtures explicitly allow response statuses. Undeclared 4xx/5xx responses, static-resource 4xx/5xx responses, `pageerror`, and unapproved `console.error` messages fail the scenario.
6. The `home-to-canvas` scenario preloads a signed-in browser session and verifies navigation from home to `/canvas`, the fixture project name, and a visible initial canvas area. Do not change production code solely to make a workflow smoke scenario locatable; use existing user-facing semantics first and existing DOM structure only when needed.
7. Every smoke run writes screenshots, console and network summaries, and command result into `web/.bugfix-evidence/<HEAD>/`. The directory is ignored and never committed.

## 3. Repository closure and delivery report

1. After frontend checks pass, run the repository `verify-change-scope` completion flow. Before creating or updating a PR, run its PR-stage verification flow too.
2. Call the work complete only when both frontend checks and repository verification pass. Either side missing or failing means incomplete.
3. Report the Issue identifier, reproduction result, acceptance-criteria mapping, changes and regression lock, actual commands with HEAD and results, release-build result, browser scenario and evidence paths, console-error count, unexpected-network-request count, and any unverified items, failures, or risks.
4. The report may be pasted into the existing PR template. Do not alter the template, CI, or release policy.
5. When regression checks find another problem, repair it only if the current diff directly caused it. Record pre-existing or unrelated failures with reproduction evidence and recommend a new Issue. If causality is unclear, stop and request a human decision rather than merging it into this Bugfix.
