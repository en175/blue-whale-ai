# IK50GB-A Authenticated User Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Token-fingerprint and Java-JWT ownership with one tested `sk-xxx` → stable new-api User ID authentication module across every existing Next.js product route.

**Architecture:** A deep `getAuthenticatedUser()` module owns Bearer parsing, new-api identity resolution, status validation, SHA-256 digesting, a 60-second bounded LRU cache, in-flight miss deduplication and stable error classification. Product Route Handlers call a thin `withAuthenticatedUser()` adapter and receive only `{ userId, status: "enabled" }`; browser User IDs, Java JWT and Token fingerprints disappear.

**Tech Stack:** TypeScript 5.9, Next.js Route Handlers, Vitest 2.1, Node `crypto`, existing `AccountClient`/`createNewApiClient`.

## Global Constraints

- Accept only `Authorization: Bearer sk-xxx`; old Java JWT and every other Bearer value return `401`.
- Product owner is the stable integer new-api User ID represented as a decimal string.
- Cache key is the full Token SHA-256 digest; raw Token is never cached or logged.
- Cache value is only `{ userId, status: "enabled", expiresAt }`.
- TTL is exactly `60_000ms`, does not slide on hit, and `now >= expiresAt` is expired.
- Cache capacity is exactly 1,024 entries with deterministic LRU eviction.
- `401/403` evict the matching digest; `502/503` on miss or expiry fail closed and never use stale data.
- `GET /api/me`, account-security and administrator operations stay fresh; IK50GB-A changes only existing product routes.
- Do not add a Node→Java adapter, Java JWT fallback, `X-User-Id` fallback or compatibility flag.
- Follow RED → verify RED → GREEN → verify GREEN for every behavior change.

---

## File Structure

- Create `blue_whale_web/lib/auth/identity-cache.ts`: bounded non-sliding TTL/LRU cache with no HTTP knowledge.
- Create `blue_whale_web/lib/auth/identity-cache.test.ts`: deterministic clock, expiry and eviction tests.
- Create `blue_whale_web/lib/auth/authenticated-user.ts`: public authentication interface, production singleton and test factory.
- Create `blue_whale_web/lib/auth/authenticated-user.test.ts`: Bearer, resolver, status, error and in-flight behavior.
- Create `blue_whale_web/lib/auth/product-route-auth.ts`: maps typed authentication failures to the existing `{code,msg,data}` envelope and invokes product handlers.
- Create `blue_whale_web/lib/auth/product-route-auth.test.ts`: response mapping and unknown-error propagation.
- Create `blue_whale_web/lib/auth/protected-route-coverage.test.ts`: static guard for all existing protected product routes.
- Delete `blue_whale_web/lib/auth/user-from-request.ts` and its test after all callers migrate.
- Modify `blue_whale_web/lib/api/client.ts` and test: remove anonymous UUID/`X-User-Id`.
- Modify 26 product Route Handler files listed below to use `withAuthenticatedUser()`.

---

### Task 1: Bounded Identity Cache

**Files:**
- Create: `blue_whale_web/lib/auth/identity-cache.test.ts`
- Create: `blue_whale_web/lib/auth/identity-cache.ts`

**Interfaces:**
- Consumes: injected `now(): number`
- Produces:
  - `type CachedIdentity = { userId: string; status: "enabled"; expiresAt: number }`
  - `createIdentityCache(options: { ttlMs: number; maxEntries: number; now: () => number })`
  - methods `get(key)`, `set(key, identity)`, `delete(key)`, `size()`

- [x] **Step 1: Write failing cache tests**

Cover exact behaviors:

```ts
it("expires at now >= expiresAt and does not slide on get", () => {
  let now = 1_000;
  const cache = createIdentityCache({
    ttlMs: 60_000,
    maxEntries: 2,
    now: () => now,
  });
  cache.set("digest-a", { userId: "7", status: "enabled" });
  now = 60_999;
  expect(cache.get("digest-a")?.userId).toBe("7");
  now = 61_000;
  expect(cache.get("digest-a")).toBeUndefined();
});

it("evicts the least recently used entry at capacity", () => {
  const cache = createIdentityCache({
    ttlMs: 60_000,
    maxEntries: 2,
    now: () => 1_000,
  });
  cache.set("a", { userId: "1", status: "enabled" });
  cache.set("b", { userId: "2", status: "enabled" });
  cache.get("a");
  cache.set("c", { userId: "3", status: "enabled" });
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")?.userId).toBe("1");
  expect(cache.get("c")?.userId).toBe("3");
});
```

Also assert delete and bounded size.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter blue_whale test -- lib/auth/identity-cache.test.ts
```

Expected: FAIL because `./identity-cache` does not exist.

- [x] **Step 3: Implement the minimum cache**

Use a `Map<string, CachedIdentity>` whose insertion order is LRU order. `get()` deletes expired entries; a valid
hit deletes and reinserts the same value without changing `expiresAt`. `set()` computes `expiresAt = now() + ttlMs`,
replaces an existing key, and deletes the oldest key while `size > maxEntries`.

- [x] **Step 4: Verify GREEN**

Run the Task 1 command. Expected: all cache tests PASS with no warnings.

- [x] **Step 5: Commit**

```bash
scripts/commit-task-for-review.sh -m "feat: 增加有界身份缓存"
```

---

### Task 2: Authenticated User Deep Module

**Files:**
- Create: `blue_whale_web/lib/auth/authenticated-user.test.ts`
- Create: `blue_whale_web/lib/auth/authenticated-user.ts`
- Modify: `blue_whale_web/lib/account/bff.ts`

**Interfaces:**
- Consumes: `AccountClient.resolveTokenIdentity(token)`
- Produces:
  - `type AuthenticatedUser = { userId: string; status: "enabled" }`
  - `type AuthenticationPolicy = "ordinary" | "fresh"`
  - `class AuthenticationError extends Error { status: 401 | 403 | 502 | 503 }`
  - `createAuthenticatedUserResolver(deps)`
  - production `getAuthenticatedUser(request, options?)`

- [x] **Step 1: Write failing authentication tests**

Use a fake resolver and controllable clock. Add one test per behavior:

```ts
it("rejects old Java JWT without calling new-api", async () => {
  const resolveTokenIdentity = vi.fn();
  const getUser = createAuthenticatedUserResolver({
    resolveTokenIdentity,
    now: () => 0,
    maxEntries: 1_024,
  });
  await expect(
    getUser(new Request("http://test", {
      headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.old.jwt" },
    })),
  ).rejects.toMatchObject({ status: 401 });
  expect(resolveTokenIdentity).not.toHaveBeenCalled();
});

it("uses stable new-api user id instead of token fingerprint", async () => {
  const resolveTokenIdentity = vi.fn().mockResolvedValue({
    userId: 42,
    username: "alice",
    email: null,
    status: 1,
  });
  const getUser = createAuthenticatedUserResolver({
    resolveTokenIdentity,
    now: () => 0,
    maxEntries: 1_024,
  });
  await expect(auth(getUser, "sk-one")).resolves.toEqual({
    userId: "42",
    status: "enabled",
  });
  await expect(auth(getUser, "sk-two")).resolves.toEqual({
    userId: "42",
    status: "enabled",
  });
});
```

Add tests for:

- missing/empty/non-`sk-` → `401`;
- ordinary hit calls upstream once and does not extend TTL;
- `fresh` bypasses a valid cache;
- upstream `401` → `401` and eviction;
- upstream `403` or successful non-enabled status → `403` and eviction;
- upstream malformed `502` and unavailable `503` retain their status;
- expired cache plus `503` fails closed;
- simultaneous misses for one digest share one resolver promise;
- an injected cache spy receives a 64-character hex digest as key and never receives the raw Token.

- [x] **Step 2: Verify RED**

```bash
pnpm --filter blue_whale test -- lib/auth/authenticated-user.test.ts
```

Expected: FAIL because `./authenticated-user` does not exist.

- [x] **Step 3: Implement the deep module**

Implementation requirements:

```ts
const TTL_MS = 60_000;
const MAX_ENTRIES = 1_024;
const ENABLED_STATUS = 1;

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

`createAuthenticatedUserResolver()` must:

1. parse strict Bearer `sk-xxx`;
2. hash before cache access;
3. return a valid ordinary cache hit;
4. deduplicate unresolved promises by digest;
5. call the injected resolver with the raw Token only on miss/fresh;
6. require positive integer `userId` and `status === 1`;
7. cache only ordinary successful results;
8. delete the digest for `401/403`;
9. translate unknown resolver errors to `502`;
10. delete the in-flight promise in `finally`.

Allow the test factory to inject the cache port so the digest-key assertion does not require a production debug API.
Production `getAuthenticatedUser()` lazily calls `createAccountClient()` and uses one module-level cache/in-flight map.
Do not instantiate the account client at module import time because missing environment configuration must map to `503`
at request time.

- [x] **Step 4: Verify GREEN**

Run Task 2 test, then:

```bash
pnpm --filter blue_whale test -- lib/auth/identity-cache.test.ts lib/auth/authenticated-user.test.ts
```

Expected: all tests PASS.

- [x] **Step 5: Commit**

```bash
scripts/commit-task-for-review.sh -m "feat: 建立认证用户上下文"
```

---

### Task 3: Product Route Authentication Adapter

**Files:**
- Create: `blue_whale_web/lib/auth/product-route-auth.test.ts`
- Create: `blue_whale_web/lib/auth/product-route-auth.ts`
- Modify: `blue_whale_web/lib/account/bff.ts`

**Interfaces:**
- Consumes: `getAuthenticatedUser(request)`
- Produces:

```ts
withAuthenticatedUser(
  request: Request,
  handler: (user: AuthenticatedUser) => Promise<Response> | Response,
): Promise<Response>
```

- [x] **Step 1: Write failing adapter tests**

Assert:

- successful auth calls the handler with `{userId:"42",status:"enabled"}`;
- authentication statuses map to existing `{code,status,msg,data:null}` JSON envelopes;
- unknown handler and programming errors are rethrown, not converted to `502`;
- the response never includes the credential or digest.

- [x] **Step 2: Verify RED**

```bash
pnpm --filter blue_whale test -- lib/auth/product-route-auth.test.ts
```

Expected: FAIL because the adapter does not exist.

- [x] **Step 3: Implement the adapter**

Catch only `AuthenticationError`. Reuse one shared status-to-message function with:

```ts
{
  401: "登录凭证无效",
  403: "账户已停用",
  502: "账户服务响应异常",
  503: "账户服务暂不可用",
}
```

Refactor `accountErrorResponse()` to delegate to this shared response builder without changing account-route behavior.

- [x] **Step 4: Verify GREEN**

Run Task 3 plus existing account route tests:

```bash
pnpm --filter blue_whale test -- lib/auth/product-route-auth.test.ts app/api/me/route.test.ts app/api/usage/token/route.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
scripts/commit-task-for-review.sh -m "feat: 统一产品路由认证边界"
```

---

### Task 4: Remove Browser `X-User-Id`

**Files:**
- Modify: `blue_whale_web/lib/api/client.test.ts`
- Modify: `blue_whale_web/lib/api/client.ts`
- Delete: `blue_whale_web/lib/api/userId.ts` only if `rg` confirms no remaining importer

**Interfaces:**
- Consumes: existing browser credential injection from `blue_whale_web/lib/api-client.ts`
- Produces: `apiFetch()` never creates or sends `X-User-Id`

- [x] **Step 1: Change the test first**

Replace assertions expecting a UUID header with:

```ts
expect(headers["X-User-Id"]).toBeUndefined();
```

Add a test proving an explicit caller header cannot set `X-User-Id`; sanitize it before fetch.

- [x] **Step 2: Verify RED**

```bash
pnpm --filter blue_whale test -- lib/api/client.test.ts
```

Expected: FAIL because the current client still injects `X-User-Id`.

- [x] **Step 3: Remove identity injection**

Delete the `getOrCreateUserId` import and call. Remove case-insensitive `X-User-Id` from supplied headers before fetch.
Run `rg -n "getOrCreateUserId|lib/api/userId" blue_whale_web`; delete `lib/api/userId.ts` only when no production importer remains.

- [x] **Step 4: Verify GREEN**

Run Task 4 test. Expected: PASS.

- [x] **Step 5: Commit**

```bash
scripts/commit-task-for-review.sh -m "refactor: 移除浏览器用户身份头"
```

---

### Task 5: Migrate Project, Canvas and Snapshot Routes

**Files:**
- Modify tests:
  - `blue_whale_web/app/api/projects/route.test.ts`
  - `blue_whale_web/app/api/projects/[id]/route.test.ts`
  - `blue_whale_web/app/api/projects/[id]/snapshot/route.test.ts`
  - existing Canvas route tests, or create them beside each Canvas route
- Modify routes:
  - `blue_whale_web/app/api/projects/route.ts`
  - `blue_whale_web/app/api/projects/[id]/route.ts`
  - `blue_whale_web/app/api/projects/[id]/snapshot/route.ts`
  - `blue_whale_web/app/api/canvases/route.ts`
  - `blue_whale_web/app/api/canvases/[projectId]/route.ts`

**Interfaces:**
- Consumes: `withAuthenticatedUser(request, handler)`
- Produces: all Project/Canvas/Snapshot handlers receive stable `user.userId`

- [x] **Step 1: Migrate route tests before production**

Mock `@/lib/auth/product-route-auth` instead of `user-from-request`. Make the mock invoke the handler with
`{userId:"9",status:"enabled"}`. Add one route-level error test returning `403` from the adapter.

- [x] **Step 2: Verify RED**

```bash
pnpm --filter blue_whale test -- app/api/projects app/api/canvases
```

Expected: FAIL because routes still import `getUserIdFromRequest`.

- [x] **Step 3: Migrate each handler**

For every exported HTTP method:

```ts
export async function GET(request: Request): Promise<Response> {
  return withAuthenticatedUser(request, ({ userId }) =>
    handleExistingRequest(request, userId),
  );
}
```

Inline the existing handler body inside the callback when no named handler exists. Preserve params, envelope, status,
repository calls and domain error behavior exactly. Delete every local `JWT_SECRET`.

- [x] **Step 4: Verify GREEN**

Run Task 5 command. Expected: all selected tests PASS.

- [x] **Step 5: Commit**

```bash
scripts/commit-task-for-review.sh -m "refactor: 统一项目与画布认证上下文"
```

---

### Task 6: Migrate Asset and Upload Routes

**Files:**
- Modify the 10 Asset/upload routes currently returned by:

```bash
rg -l "getUserIdFromRequest" blue_whale_web/app/api/agent/assets blue_whale_web/app/api/assets blue_whale_web/app/api/projects --glob 'route.ts'
```

- Modify/create colocated route tests for list, read, content, presign and complete representatives.

**Interfaces:**
- Consumes: `withAuthenticatedUser`
- Produces: Asset ownership and upload commands use stable new-api User ID only

- [x] **Step 1: Change representative tests first**

Update mocks in existing Asset/upload tests. Add a forged `X-User-Id: 999` request and assert the repository/handler
still receives authenticated User ID `"9"`.

- [x] **Step 2: Verify RED**

```bash
pnpm --filter blue_whale test -- app/api/assets app/api/agent/assets app/api/projects
```

Expected: the migrated expectations fail while routes still call the old helper.

- [x] **Step 3: Migrate all matching Asset routes**

Wrap each exported method with `withAuthenticatedUser`, pass `userId` to the unchanged handler/repository position,
and delete `JWT_SECRET`. Do not forward request `X-User-Id`.

- [x] **Step 4: Verify GREEN**

Run Task 6 command. Expected: PASS.

- [x] **Step 5: Commit**

```bash
scripts/commit-task-for-review.sh -m "refactor: 统一素材接口认证上下文"
```

---

### Task 7: Migrate Generation, Job, Skill and Template Routes

**Files:**
- Modify:
  - `blue_whale_web/app/api/generation/models/route.ts`
  - `blue_whale_web/app/api/jobs/route.ts`
  - `blue_whale_web/app/api/jobs/[id]/route.ts`
  - `blue_whale_web/app/api/projects/[id]/generation-jobs/route.ts`
  - `blue_whale_web/app/api/projects/[id]/generation-jobs/[jobId]/cancel/route.ts`
  - all `blue_whale_web/app/api/agent/skills/**/route.ts`
  - all `blue_whale_web/app/api/agent/templates/**/route.ts`
- Modify/create colocated tests for each domain.

**Interfaces:**
- Consumes: `withAuthenticatedUser`
- Produces: remaining existing Next.js product routes use stable new-api User ID

- [x] **Step 1: Change tests first**

Update existing mocks, then add representative assertions for:

- GenerationJob create receives authenticated User ID and still captures the submit-time credential independently;
- Job list ignores forged browser identity;
- Skill update and Template list receive authenticated User ID;
- authentication `503` is returned unchanged.

- [x] **Step 2: Verify RED**

```bash
pnpm --filter blue_whale test -- app/api/generation app/api/jobs app/api/projects app/api/agent/skills app/api/agent/templates
```

Expected: FAIL until routes migrate.

- [x] **Step 3: Migrate remaining routes**

Apply the same wrapper contract, preserving domain behavior. In GenerationJob create, authentication returns `userId`;
credential extraction remains a separate submit-time operation and must not be stored in Authenticated User Context.
Delete route-level `JWT_SECRET` used for authentication. Do not remove `GENERATION_CREDENTIAL_SECRET`.

- [x] **Step 4: Verify GREEN**

Run Task 7 command. Expected: PASS.

- [x] **Step 5: Commit**

```bash
scripts/commit-task-for-review.sh -m "refactor: 统一生成与Agent接口认证上下文"
```

---

### Task 8: Delete Old Helper and Add Coverage Guard

**Files:**
- Create: `blue_whale_web/lib/auth/protected-route-coverage.test.ts`
- Delete: `blue_whale_web/lib/auth/user-from-request.ts`
- Delete: `blue_whale_web/lib/auth/user-from-request.test.ts`
- Modify: any remaining tests importing the deleted helper

**Interfaces:**
- Consumes: repository file tree
- Produces: a guard preventing new product routes from bypassing `withAuthenticatedUser`

- [x] **Step 1: Write the failing structural test**

Walk `blue_whale_web/app/api/**/route.ts`. Maintain an explicit exemption set for account/public routes:

```ts
const EXEMPT = new Set([
  "auth/capabilities/route.ts",
  "auth/login/route.ts",
  "auth/logout/route.ts",
  "auth/register/route.ts",
  "auth/send-code/route.ts",
  "me/route.ts",
  "usage/token/route.ts",
]);
```

For every non-exempt current Node route assert its source imports `@/lib/auth/product-route-auth` and contains
`withAuthenticatedUser`. Separately scan production TypeScript under `blue_whale_web` and assert:

```ts
expect(source).not.toContain("getUserIdFromRequest");
expect(source).not.toContain("ownerIdFromNewApiToken");
```

- [x] **Step 2: Verify RED**

```bash
pnpm --filter blue_whale test -- lib/auth/protected-route-coverage.test.ts
```

Expected: FAIL if any route or old helper remains.

- [x] **Step 3: Remove remaining legacy code**

Use:

```bash
rg -n "getUserIdFromRequest|ownerIdFromNewApiToken" blue_whale_web --glob '*.{ts,tsx}'
```

Migrate any missed test/caller, then delete the old helper and its fingerprint test. Do not delete generic JWT/SMS
modules in `packages/core` in IK50GB-A; their broader account cleanup belongs to IK50GD.

- [x] **Step 4: Verify GREEN and full slice**

```bash
pnpm --filter blue_whale test -- lib/auth
pnpm --filter blue_whale test
pnpm typecheck
pnpm --filter blue_whale lint
pnpm --filter blue_whale build
```

Expected:

- all Vitest tests pass;
- TypeScript exits 0;
- ESLint exits 0 without new warnings;
- Next.js and worker build exit 0.

- [x] **Step 5: Static acceptance**

```bash
rg -n "getUserIdFromRequest|ownerIdFromNewApiToken" blue_whale_web --glob '*.{ts,tsx}'
rg -n "X-User-Id" blue_whale_web/lib blue_whale_web/app/api --glob '*.{ts,tsx}'
rg -n "JWT_SECRET" blue_whale_web/app/api --glob 'route.ts'
```

Expected:

- first command: no matches;
- second command: only explicit rejection/coverage tests or historical comments scheduled for IK50GD;
- third command: no authentication use; Generation credential code uses only `GENERATION_CREDENTIAL_SECRET`.

- [x] **Step 6: Commit**

```bash
scripts/commit-task-for-review.sh -m "test: 锁定产品接口认证覆盖"
```

---

## Execution Evidence

Executed on 2026-07-29 in
`feature/IK50GB-统一产品认证用户上下文`.

- Each task followed RED → GREEN and received an independent read-only review.
  Durable per-task evidence is recorded in `.superpowers/sdd/task-*-report.md`
  in the implementation worktree.
- Final Node package verification: 20 files and 52 tests passed.
- Final Web verification: 119 files passed, 1 skipped; 635 tests passed,
  1 skipped.
- Final TypeScript project check, changed-scope ESLint, Next production build,
  and generation-worker build exited 0.
- Full-repository ESLint was executed but remains red on the pre-existing
  baseline: 27 errors and 45 warnings in unchanged admin, Canvas, component,
  recharge, and legacy client files. All IK50GB-A changed files pass ESLint.
- Final review regressions were reproduced before repair: fresh/ordinary
  in-flight policy crossover, multi-method route guard bypass, and missing
  Generation credential configuration. Their targeted suites are now green.
- The repository requires one child issue = one commit, so the per-task
  “Commit” checkpoints were implemented as repeated review checkpoints and a
  final amend into one acceptance commit.

---

## Plan Boundary

This plan completes IK50GB-A only. After its commit is reviewed and merged to local master:

- write a separate IK50GB-B plan for GenerationInbox, Conversation, InputRequest, AgentRun and Project/Job SSE migration;
- write a separate IK50GB-C plan for deleting Java rewrites and proving the no-Java real-service smoke;
- do not mark IK50GB complete until A, B and C all pass.
