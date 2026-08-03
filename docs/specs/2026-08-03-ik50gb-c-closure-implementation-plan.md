# IK50GB-C Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the BlueWhale account, product, image, and video paths work against a real local new-api process without starting any Java service.

**Architecture:** Extend the existing TypeScript baseline acceptance stack with a real new-api container and a provider stub, then drive same-origin BlueWhale APIs through one sanitized smoke runner. Local acceptance owns disposable MySQL/Redis volumes; a separate opt-in test-site probe uses only HTTP APIs and never runs schema or destructive database operations.

**Tech Stack:** Docker Compose, Next.js Route Handlers, TypeScript/Node test runner, Go new-api, MySQL 8.4, Redis 7, Vitest.

## Global Constraints

- This plan covers IK50GB-C only. Physical Java deletion and the subsequent media-auth hardening each require a separate implementation plan and review checkpoint.
- Java Gateway, User Service, Product Service, and every other `blue_whale_server` process must remain stopped throughout acceptance.
- Default acceptance uses disposable local MySQL and Redis; it must never point migration, seed, volume deletion, or cleanup commands at the test-site database or Redis.
- Test-site verification is opt-in and HTTP-only. Credentials are requested only when the local acceptance is green.
- Secrets belong in an ignored local env file or process environment and must be sanitized from logs and evidence.
- Every behavior starts with a focused failing test, followed by the minimum implementation and a focused green run.

---

### Task 1: Lock The No-Java Acceptance Topology

**Files:**
- Modify: `tests/typescript-baseline/fullstack.test.mjs`
- Modify: `deploy/typescript-baseline/docker-compose.acceptance.yml`

**Interfaces:**
- Consumes: Docker Compose service configuration.
- Produces: a topology contract containing `mysql`, `redis`, `new-api`, `provider-stub`, `web`, `agent-worker`, and `generation-worker`, with no Java services or Java build contexts.

- [ ] **Step 1: Write the failing topology assertions**

Add an exact service-set assertion:

```js
assert.deepEqual(compose("config", "--services").split("\n").sort(), [
  "agent-worker",
  "generation-worker",
  "mysql",
  "new-api",
  "provider-stub",
  "redis",
  "web",
]);

const serialized = JSON.stringify(
  JSON.parse(compose("config", "--format", "json")),
);
for (const forbidden of [
  "blue_whale_server",
  "blue-whale-gateway",
  "blue-whale-user",
  "blue-whale-product",
  "GATEWAY_URL",
]) {
  assert.equal(serialized.includes(forbidden), false, forbidden);
}
```

- [ ] **Step 2: Run the topology test and verify RED**

Run:

```bash
BW_TS_COMPOSE_PROJECT=bw-ik50gb-c-plan docker compose \
  -p bw-ik50gb-c-plan \
  -f deploy/typescript-baseline/docker-compose.acceptance.yml config >/dev/null
BW_TS_COMPOSE_PROJECT=bw-ik50gb-c-plan \
  node --test --test-name-pattern="验收拓扑" tests/typescript-baseline/fullstack.test.mjs
```

Expected: FAIL because `new-api` and `provider-stub` do not exist.

- [ ] **Step 3: Add the two services and wire server-only URLs**

Add a dedicated new-api MySQL database in the existing disposable MySQL service and configure:

```yaml
new-api:
  build:
    context: ../../blue_whale_api
    dockerfile: Dockerfile
  environment:
    PORT: "3000"
    SQL_DSN: root:blue_whale@tcp(mysql:3306)/new_api?charset=utf8mb4&parseTime=True&loc=Local
    REDIS_CONN_STRING: redis://redis:6379/1
    SESSION_SECRET: acceptance-new-api-session-secret
    GENERATE_DEFAULT_TOKEN: "true"
  depends_on:
    mysql:
      condition: service_healthy
    redis:
      condition: service_healthy

provider-stub:
  image: node:22-alpine
  command: ["node", "/app/tests/typescript-baseline/provider-stub.mjs"]
```

Set `NEW_API_BASE_URL: http://new-api:3000` on Web and both generation execution paths. Do not add any `NEXT_PUBLIC_*` new-api address.

- [ ] **Step 4: Run Compose validation and the topology test**

Run:

```bash
docker compose -f deploy/typescript-baseline/docker-compose.acceptance.yml config --quiet
node --check tests/typescript-baseline/fullstack.test.mjs
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

Run:

```bash
scripts/commit-task-for-review.sh -m "test: 锁定无Java验收拓扑"
```

Expected: one local task-branch commit; no push or PR.

### Task 2: Add A Deterministic Media Provider Stub

**Files:**
- Create: `tests/typescript-baseline/provider-stub.mjs`
- Create: `tests/typescript-baseline/provider-stub.test.mjs`
- Modify: `deploy/typescript-baseline/docker-compose.acceptance.yml`

**Interfaces:**
- Consumes: OpenAI-compatible image and video requests forwarded by new-api.
- Produces: deterministic image responses, asynchronous video task responses, and an in-memory request ledger that never stores Authorization values.

- [ ] **Step 1: Write failing provider contract tests**

The test must assert these paths and terminal shapes:

```js
assert.equal(image.status, 200);
assert.match((await image.json()).data[0].url, /generated-image/);
assert.equal(videoSubmit.status, 200);
assert.equal((await videoPoll.json()).status, "succeeded");
assert.equal(JSON.stringify(await ledger.json()).includes("Bearer "), false);
```

- [ ] **Step 2: Run the provider test and verify RED**

Run:

```bash
node --test tests/typescript-baseline/provider-stub.test.mjs
```

Expected: FAIL because `provider-stub.mjs` does not exist.

- [ ] **Step 3: Implement the minimal stub**

Expose:

```text
POST /v1/images/generations
POST /v1/images/edits
POST /v1/video/generations
GET  /v1/video/generations/:taskId
GET  /__acceptance/requests
```

Record only method, pathname, model, and whether an Authorization header was present:

```js
requests.push({
  method: request.method,
  pathname: url.pathname,
  model: body.model ?? null,
  authorized: Boolean(request.headers.authorization),
});
```

Never record the header value or multipart bytes.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
node --test tests/typescript-baseline/provider-stub.test.mjs
```

Expected: PASS for image generation, image edit, video submit/poll, and credential redaction.

- [ ] **Step 5: Commit**

Run:

```bash
scripts/commit-task-for-review.sh -m "test: 增加媒体供应商验收替身"
```

Expected: the task branch advances by one reviewable commit.

### Task 3: Drive The Real Account And Product Smoke

**Files:**
- Create: `tests/typescript-baseline/ik50gb-c-smoke.test.mjs`
- Modify: `scripts/run-typescript-baseline-acceptance.sh`
- Modify: `deploy/typescript-baseline/docker-compose.acceptance.yml`

**Interfaces:**
- Consumes: BlueWhale same-origin HTTP endpoints and a real local new-api account/token database.
- Produces: sanitized evidence for register, login, me, quota, project, conversation, image, and video flows.

- [ ] **Step 1: Write the failing smoke skeleton**

Create a unique account without printing credentials:

```js
const suffix = `${Date.now()}-${process.pid}`;
const username = `ik50gb_${suffix}`;
const password = `Acceptance-${suffix}!`;

const registration = await postJson("/api/auth/register", {
  username,
  password,
  confirmPassword: password,
});
assert.equal(registration.response.status, 200);
assert.match(registration.body.data.access_token, /^sk-/);
```

Continue using the returned token only in request headers. Assert:

```text
POST /api/auth/register                       200
POST /api/auth/login                          200
GET  /api/me                                  200
GET  /api/usage/token                         200
POST /api/projects                            200
POST /api/projects/:id/conversation/messages 2xx
POST /api/projects/:id/generation-jobs        2xx for image
POST /api/projects/:id/generation-jobs        2xx for video
GET  /api/jobs?ids=...                        both terminal
```

The test output may include endpoint, status, user ID, project ID, job ID, and quota delta. It must not include username, password, Token, cookies, or ciphertext.

- [ ] **Step 2: Run the full acceptance and verify RED**

Run:

```bash
scripts/run-typescript-baseline-acceptance.sh
```

Expected: FAIL at the first account request because new-api initialization/routing is not yet fully wired.

- [ ] **Step 3: Complete service initialization and route wiring**

Update Compose initialization so MySQL creates both databases:

```sql
CREATE DATABASE IF NOT EXISTS new_api
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Pass identical `GENERATION_CREDENTIAL_SECRET` to Web and generation workers. Configure new-api’s acceptance channel to target `provider-stub` using a deterministic initialization fixture or public admin API; do not mutate tables from the Node smoke test.

- [ ] **Step 4: Add readiness and execute smoke after health checks**

Update the runner service list:

```bash
for service in new-api provider-stub agent-worker generation-worker web; do
  # require Docker health=healthy before Node tests
done
```

Then run:

```bash
node --test \
  "$ROOT/tests/typescript-baseline/fullstack.test.mjs" \
  "$ROOT/tests/typescript-baseline/ik50gb-c-smoke.test.mjs"
```

- [ ] **Step 5: Run the complete local acceptance**

Run:

```bash
scripts/run-typescript-baseline-acceptance.sh
```

Expected: PASS, with both generation jobs terminal and no Java container in `docker compose ps`.

- [ ] **Step 6: Commit**

Run:

```bash
scripts/commit-task-for-review.sh -m "test: 跑通无Java账户产品生成链路"
```

Expected: the smoke and its topology are committed without credentials.

### Task 4: Add Repository-Wide Java Disconnection Guards

**Files:**
- Modify: `blue_whale_web/lib/auth/protected-route-coverage.test.ts`
- Create: `tests/typescript-baseline/no-java-runtime.test.mjs`
- Modify: `docs/specs/2026-07-29-authenticated-user-context-design.md`
- Modify: `docs/adr/0062-new-api-account-center-and-quota-billing.md`

**Interfaces:**
- Consumes: production TypeScript, current Docker/Compose assets, and active scripts.
- Produces: a narrowly scoped deny-list that excludes historical ADR/research text while blocking executable Java runtime dependencies.

- [ ] **Step 1: Write the failing runtime scan**

Scan production/config paths:

```js
const roots = [
  "blue_whale_web",
  "apps",
  "packages",
  "deploy/typescript-baseline",
  "Dockerfile.typescript-baseline",
  "scripts/run-typescript-baseline-acceptance.sh",
];
const forbidden = [
  "process.env.GATEWAY_URL",
  "blue-whale-gateway",
  "blue-whale-user",
  "blue-whale-product",
  "blue_whale_server",
];
```

Exclude tests that intentionally assert forbidden strings and historical documents. Report exact file and symbol, never file contents containing secrets.

- [ ] **Step 2: Run the guard and verify RED**

Run:

```bash
node --test tests/typescript-baseline/no-java-runtime.test.mjs
```

Expected: FAIL on remaining executable acceptance/deployment references that belong to IK50GB-C scope.

- [ ] **Step 3: Remove in-scope references and update status**

Remove only runtime dependencies required by the no-Java acceptance. Mark IK50GB-C “runtime disconnection and real local acceptance complete”; explicitly leave physical source/deployment deletion for the next reviewed plan.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
pnpm --filter blue_whale test -- lib/auth/protected-route-coverage.test.ts
node --test tests/typescript-baseline/no-java-runtime.test.mjs
scripts/run-typescript-baseline-acceptance.sh
pnpm typecheck
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit**

Run:

```bash
scripts/commit-task-for-review.sh -m "test: 阻止Java运行时依赖回流"
```

Expected: guard and status documentation are committed.

### Task 5: Run The Opt-In Test-Site Probe

**Files:**
- Create: `scripts/run-ik50gb-c-testsite-probe.sh`
- Create: `scripts/tests/test_run_ik50gb_c_testsite_probe.py`
- Create: `docs/verification/ik50gb-c-testsite-evidence-template.md`

**Interfaces:**
- Consumes: `BW_TEST_BASE_URL`, a dedicated test username/password or disposable registration capability, and optional provider-enabled test account.
- Produces: HTTP-only, sanitized evidence; it never receives database or Redis administrator credentials.

- [ ] **Step 1: Write failing shell contract tests**

Assert the script:

```text
fails closed when BW_TEST_BASE_URL is absent
rejects non-HTTPS URLs unless host is localhost
does not invoke mysql, redis-cli, docker compose down, migration, seed, or DELETE
redacts sk-xxx, passwords, Authorization, Cookie, and Set-Cookie
requires BW_ALLOW_BILLED_MEDIA_PROBE=1 before image/video requests
```

- [ ] **Step 2: Run the contract tests and verify RED**

Run:

```bash
python3 -m unittest scripts.tests.test_run_ik50gb_c_testsite_probe
```

Expected: FAIL because the probe script is absent.

- [ ] **Step 3: Implement the read/write-safe HTTP probe**

The default probe runs register/login/me/quota and creates only uniquely prefixed disposable product data. Billed image/video calls require:

```bash
: "${BW_ALLOW_BILLED_MEDIA_PROBE:?set to 1 after explicit authorization}"
[ "$BW_ALLOW_BILLED_MEDIA_PROBE" = "1" ]
```

Pipe all output through the repository sanitizer. Do not persist environment values in evidence.

- [ ] **Step 4: Run local contract verification**

Run:

```bash
python3 -m unittest scripts.tests.test_run_ik50gb_c_testsite_probe
bash -n scripts/run-ik50gb-c-testsite-probe.sh
```

Expected: PASS without any external connection.

- [ ] **Step 5: Request the minimum test-site inputs**

Only after Tasks 1–4 are green, request:

```text
BW_TEST_BASE_URL
dedicated disposable test username/password, or permission to register one
confirmation that the account has image/video models and disposable quota
explicit permission BW_ALLOW_BILLED_MEDIA_PROBE=1
```

Do not request MySQL or Redis passwords for this probe. Database/Redis access is needed only for a separately approved operational diagnosis, and should then be read-only with least privilege.

- [ ] **Step 6: Run the authorized probe and save sanitized evidence**

Run with credentials injected interactively or through an ignored local env file:

```bash
scripts/run-ik50gb-c-testsite-probe.sh \
  | python3 scripts/lib/sanitize_acceptance_logs.py
```

Expected: sanitized endpoint/status/job/quota-delta evidence, with no credential material.

- [ ] **Step 7: Run final verification and commit**

Run:

```bash
git diff --check
pnpm typecheck
pnpm --filter blue_whale test
scripts/run-typescript-baseline-acceptance.sh
python3 -m unittest scripts.tests.test_run_ik50gb_c_testsite_probe
scripts/commit-task-for-review.sh -m "test: 完成IK50GB-C真实验收"
```

Expected: all verification passes and the local task branch contains no secrets.
