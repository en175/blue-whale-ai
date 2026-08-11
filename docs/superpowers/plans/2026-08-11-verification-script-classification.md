# Verification Script Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace automatic full verification for Hook and unknown scripts with explicit categories and fail-fast `UNCLASSIFIED_PATH` errors.

**Architecture:** `scripts/verification-policy.mjs` remains the single classifier. Explicit control-plane, operations, and product-impact registries determine validation; only product-impact paths and `--risk high` produce full acceptance.

**Tech Stack:** Node.js 24.18.0, `node:test`, repository shell/Python test entrypoints, Markdown.

## Global Constraints

- Every executable path under `scripts/` must match one explicit category.
- Hook and Git/PR/worktree control-plane paths never trigger product full acceptance by path alone.
- Product build, runtime, database, deployment, and acceptance paths retain PR-stage full acceptance.
- Unknown executable paths fail with `UNCLASSIFIED_PATH` before commands run.
- Explicit `--risk high` still requires full acceptance.

---

### Task 1: Explicit classifier registry

**Files:**
- Modify: `scripts/verification-policy.mjs`
- Test: `tests/verification-policy.test.mjs`

**Interfaces:**
- Consumes: `classifyChanges(files, { risk, stage })`
- Produces: scoped areas `governance`, `control-plane`, `operations`; throws `UNCLASSIFIED_PATH: <paths>` for unknown executable files.

- [ ] **Step 1: Write failing tests**

Add assertions that `.claude/hooks/confirm-release-action.sh` is scoped `control-plane`, `scripts/tunnel-testsite-db.sh` is scoped `operations`, `scripts/run-typescript-baseline-acceptance.sh` remains PR-stage full, and this throws:

```js
assert.throws(
  () => classifyChanges(["scripts/new-unknown-tool.sh"], { stage: "pr" }),
  /UNCLASSIFIED_PATH: scripts\/new-unknown-tool\.sh/,
);
```

- [ ] **Step 2: Run RED**

Run `PATH=/Users/moss/.nvm/versions/node/v24.18.0/bin:$PATH node --test tests/verification-policy.test.mjs`.

Expected: Hook and operations paths currently become full; the unknown script does not throw.

- [ ] **Step 3: Implement explicit registries**

Add focused patterns in `scripts/verification-policy.mjs`:

```js
const CONTROL_PLANE_FILE = /^(?:\.githooks\/|\.(?:claude|codex)\/hooks\/|\.zcode\/config\.json|scripts\/(?:check-hook-closed-loop|check-hook-contracts|cleanup-release-branch|cleanup-task-worktree|commit-spec-on-master|commit-task-for-review|gitee-resolve-ids|install-kimi-hooks|list-task-worktrees|manage-agent-authorization|merge-task-to-local-master|pr-update-evidence|probe-codex-write-hook|publish-review-package|publish-task-branch|query-hook-audit|setup-hooks|start-task-worktree|sync-codex-skill|sync-superpowers-skills|sync-task-from-origin|sync-write-rules-skill|sync_recovery|test-hooks|verification-policy|verify-change-scope|verify-pr-update)\.|scripts\/lib\/|scripts\/tests\/)/;
const OPERATIONS_FILE = /^scripts\/(?:check-schema-charset|check-target-environment-retirement|ensure-graphify-worktree|fix-ik7grv-replace-slot-backfill|run-ik50gb-c-testsite-probe|run-real-canary|tunnel-testsite-db)\./;
const PRODUCT_IMPACT_FILE = /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig(?:\.[^.]+)?\.json|Dockerfile[^/]*|deploy\/|packages\/contracts\/|packages\/persistence\/(?:prisma\/migrations|schema)\/|blue_whale_web\/(?:app\/api\/auth|lib\/auth|e2e-fullstack\/|playwright\.)|tests\/typescript-baseline\/|scripts\/(?:dev-blue-whale|dev-stack|init-typescript-baseline-db|run-typescript-baseline-acceptance|verify-typescript-baseline)\.)/;
const EXECUTABLE_FILE = /^(?:scripts\/|.*\.(?:sh|py|mjs|cjs|js))$/;
```

Before the PR fallback, reject unknown executables:

```js
const unknown = files.filter((file) => EXECUTABLE_FILE.test(file) && !classified(file));
if (unknown.length > 0) throw new Error(`UNCLASSIFIED_PATH: ${unknown.join(", ")}`);
```

- [ ] **Step 4: Run GREEN**

Run the Task 1 test command. Expected: all classification tests pass.

### Task 2: Targeted plans and CLI fail-fast

**Files:**
- Modify: `scripts/verification-policy.mjs`
- Test: `tests/verification-policy.test.mjs`

**Interfaces:**
- Consumes: areas from Task 1.
- Produces: targeted control-plane/operations plans and CLI exit code `2` for unknown executables.

- [ ] **Step 1: Write failing plan tests**

Expect control-plane plans to contain:

```js
["bash", "scripts/test-hooks.sh"]
["python3", "-m", "unittest", "scripts.tests.test_publish_review_package", "scripts.tests.test_start_task_worktree", "scripts.tests.test_sync_task_from_origin"]
```

Expect operations plans to contain:

```js
["python3", "-m", "unittest", "discover", "-s", "scripts/tests"]
```

Add a temporary Git fixture with `scripts/new-unknown-tool.sh`; assert `verify-change-scope.mjs plan --stage pr --json` exits `2`, stderr contains `UNCLASSIFIED_PATH`, and stdout does not contain `pnpm verify`.

- [ ] **Step 2: Run RED**

Run the Task 1 test command. Expected: area command and CLI assertions fail.

- [ ] **Step 3: Implement area commands**

Extend `appendAreaCommands` with the exact command arrays above. Reuse the CLI's existing top-level catch block; do not add another error protocol.

- [ ] **Step 4: Run GREEN**

Run the Task 1 test command. Expected: classifier, plan, receipt, and CLI tests pass.

### Task 3: Documentation and inventory

**Files:**
- Modify: `docs/agents/testing-strategy.md`
- Modify: `docs/superpowers/specs/2026-08-11-verification-script-classification-design.md` only if implementation contradicts it.

**Interfaces:**
- Consumes: final registry.
- Produces: one authoritative strategy description and a complete inventory in the final handoff.

- [ ] **Step 1: Update the strategy source**

Document this exact rule: executable paths must be explicitly classified; unknown scripts return `UNCLASSIFIED_PATH` without running full; control-plane paths run targeted governance tests; only product-impact paths and `--risk high` run full acceptance.

- [ ] **Step 2: Audit every current script**

Run `find scripts -maxdepth 1 -type f | sort`. Compare every path with the three registries. Expected: no tracked current script is unclassified.

- [ ] **Step 3: Run focused verification**

Run:

```bash
PATH=/Users/moss/.nvm/versions/node/v24.18.0/bin:$PATH node --test tests/verification-policy.test.mjs tests/agent-rules.test.mjs
bash scripts/test-hooks.sh
python3 -m unittest scripts.tests.test_publish_review_package scripts.tests.test_start_task_worktree scripts.tests.test_sync_task_from_origin
git diff --check
```

Expected: all commands exit `0`; Hook and control-plane PR plans contain no `pnpm verify`.

- [ ] **Step 4: Amend the task commit**

Run `scripts/commit-task-for-review.sh --amend -m "fix: 显式分类验证脚本影响面"`.

Expected: clean `chore/发布治理规则调整` worktree with one task commit.
