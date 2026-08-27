# Frontend Bugfix Workflow

This workflow applies only to a Gitee Issue-driven frontend defect repair when `frontend-delivery` was explicitly invoked. It supplements the repository-root `CLAUDE.md`; the repository Git/worktree, Issue state-machine, and testing rules remain mandatory.

## 0. Preconditions and write boundary

1. The request must include a Gitee Issue URL or identifier. Without it, stop immediately. Do not search code, create a worktree, install dependencies, or modify files.
2. Once provided, read only `get_enterprise_issue_detail` first. Its description must contain reproducible steps, actual result, expected result, affected route, and acceptance criteria. Login identity and prerequisite data are not required fields.
3. If a required field is absent, stop. Do not replace the Issue description with chat context, code inference, or comments. Reply exactly:

   `已终止前端 Bugfix 流程：请提供 Issue 链接或编号，并在 Issue 描述中补充可逐步执行的复现步骤、实际结果、预期结果、影响路由和验收条件。`

4. Never use `--no-issue`. If the Issue is already in progress, terminal, or fails the repository state-machine precondition, stop according to the root Issue rules and wait for a human instruction.
5. Once qualified, use the repository `start-task-worktree.sh --issue ...` entry point, status transitions, commit, and PR verification flow.
6. Product files, frontend dependencies, tests, fixtures, scripts, documentation, and temporary evidence may only be written below `web/**`. Confirm the target path before every write. Other repository paths may be read but not formatted, generated, staged, or modified.
7. If the fix needs a backend, shared contract, root tool, root rule, or PR-template change, stop and request a separate Issue. Do not hide a cross-boundary defect with a frontend workaround.
8. Runtime: only `npm run dev:test` in `web/`. Do not start backend (`backend/`, NestJS, port 3100, `start-local-services`), local DB, or the test-site DB tunnel. APIs go through `web/.env.test` to the test site.

## 1. Scope the fix without browser automation

1. Use the Issue steps, observed result, expected result, route, and acceptance criteria to scope the repair. Do not operate the user's desktop or invoke Computer Use, Playwright, browser automation, screenshots, or browser smoke checks.
2. Add or update a focused Vitest regression test when the defect can be covered without a browser (for example, a pure function, state transition, API client, or request payload). For visual, route, login, or cross-component defects that need a browser, leave browser regression to the human manual test.
3. Do not request login credentials, assume an identity, create seed data, or block because the Issue omits identity or prerequisite data. If the Issue voluntarily supplies this context, include it only as optional guidance for the human tester; do not use it for automated testing.

## 2. Local verification contract

Run commands from `web/`. Run `npm ci` before first use or after dependency changes. Missing dependencies mean unverified, never passed.

1. `npm run verify:bugfix` runs lint, the complete Vitest suite, and `build:release` in sequence. Stop delivery on any failure.
2. Do not run `npm run smoke:bugfix`, install Chromium, invoke Playwright, or collect browser screenshots/evidence. These all use automated browser execution and are intentionally outside this workflow.

## 3. Human regression

Only `npm run dev:test` from `web/`. Do not start backend. Do not use `dev` / `release` / preview / smoke `dist/`. Fixture smoke does not skip this step.

After `verify:bugfix` passes:

1. Stop any other Vite for this `web/`, then start `npm run dev:test` and wait for the Local URL. Failed start = unverified.
2. Send the clickable Local URL plus the Issue affected route, then stop. Port-only or “服务已启动” does not count.

   ```
   人工回归
   页面：<Local URL + 影响路由>
   环境：`dev:test`（测试站接口；未起本地 backend）
   请按 Issue 步骤回归，回复「通过」或「不通过」及现象。
   ```

3. Human pass → section 4. Fail → keep fixing. Silence ≠ pass. Do not claim complete, commit-as-done, or open a PR before the reply.

## 4. Repository closure and delivery report

1. After the human confirms pass, run the repository `verify-change-scope` completion flow. Before creating or updating a PR, run its PR-stage verification flow too.
2. Call the work complete only when frontend checks, human `dev:test` confirmation, and repository verification all pass. Any side missing or failing means incomplete.
3. Report the Issue identifier, scope result, acceptance-criteria mapping, changes and regression lock, actual commands with HEAD and results, release-build result, the `dev:test` Local URL, the human regression result, and any unverified items, failures, or risks. State that browser regression was performed manually by the human, not by automated browser tooling.
4. The report may be pasted into the existing PR template. Do not alter the template, CI, or release policy.
5. When regression checks find another problem, repair it only if the current diff directly caused it. Record pre-existing or unrelated failures with reproduction evidence and recommend a new Issue. If causality is unclear, stop and request a human decision rather than merging it into this Bugfix.
