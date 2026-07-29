# BlueWhale 统一 new-api 账户中心与 BFF 适配规格

## Problem Statement

BlueWhale 与 new-api 当前存在两套用户语义：待退役的 Java `blue-whale-user` 维护手机号、短信和 JWT，
new-api 维护用户名、邮箱、密码、Token、quota、订阅与支付。BlueWhale 部分登录请求已经代理到
new-api，但产品所有者仍可能由 Token 指纹派生，旧手机号接口和 refresh 语义仍留在前端，注册、
稳定身份解析、能力发现和错误分类也没有形成完整合同。

这会造成双重身份、双重账户规则、Token 轮换后产品归属变化、浏览器直连上游的风险，以及不同前端
功能各自适配 new-api 的重复工作。上线前需要把账户事实统一到 new-api，同时保持 Project、Canvas、
Asset、Conversation 与 GenerationJob 等产品事实由 BlueWhale 唯一维护。

## Solution

new-api 成为唯一账户中心和 quota 权威。BlueWhale 保留自己的登录与账户 UI，但浏览器只访问同源
BFF；BFF 通过一个可注入的 new-api typed client 完成能力发现、注册、登录、稳定身份解析、账户
读取和 quota 查询。

浏览器首版将隐藏的默认 `sk-xxx` 保存于 `localStorage`，但不提交 `user_id`。BFF 根据凭证从
new-api 解析可信 User ID 与状态，并以最长 60 秒的服务端短缓存降低跨服务鉴权成本。BlueWhale
产品事实只引用稳定的 new-api User ID，绝不使用 Token 指纹、用户名或邮箱作为所有者身份。

受保护产品接口统一通过 Next.js 的 Authenticated User Context 取得身份。旧 Java JWT、浏览器
`X-User-Id`、Token 指纹 owner 和 Node→Java 认证代理均不提供兼容；仍由 Java 承载的活跃产品
接口必须迁到 TypeScript 后删除 rewrite，BlueWhale 核心链路最终完全不启动 Java。

new-api 注册事务默认创建一把隐藏的默认 API Key，并统一返回 User ID、用户名、可选邮箱和完整
Token。GenerationJob 保存提交时经 AES-256-GCM 加密的执行凭证，worker 不通过 User ID 回查或
导出密钥。生产环境只公开 BlueWhale，new-api 作为内部账户与 relay 服务，管理入口独立受控。

## User Stories

1. As a new User, I want to register from BlueWhale, so that I do not need to visit or understand new-api.
2. As a new User, I want registration to create my usable account and execution credential atomically, so that I never receive a half-created account.
3. As a new User, I want to be logged in immediately after successful registration, so that I do not enter the same credentials twice.
4. As a User, I want one login identifier field to accept either my username or email, so that login remains simple.
5. As a User, I want the registration form to request email verification only when new-api enables it, so that BlueWhale matches the real account policy.
6. As a User, I want disabled authentication methods hidden, so that I am not offered actions that cannot succeed.
7. As a User, I want BlueWhale to retain its own visual identity, so that new-api remains an implementation detail.
8. As a User, I want page refresh to retain my first-version login state, so that normal navigation does not sign me out.
9. As a User, I want logout to remove the credential from the current browser, so that the next visitor cannot use my account.
10. As a User, I want logout not to cancel already accepted generation work, so that background jobs can finish.
11. As a User, I want my Project, Canvas and Asset ownership to survive credential rotation, so that security maintenance never appears as data loss.
12. As a User, I want account failures distinguished from service outages, so that I know whether to log in again or retry later.
13. As a User, I want to see my new-api-backed quota in BlueWhale, so that displayed balance matches actual relay billing.
14. As a User, I want my credentials excluded from task queries, snapshots, logs and errors, so that diagnostics do not disclose secrets.
15. As a User, I want queued image and video jobs to continue after closing the browser, so that long-running work is reliable.
16. As a banned User, I want product access consistently rejected, so that account enforcement applies across BlueWhale.
17. As an administrator, I want ordinary logout separated from credential rotation, so that security actions are explicit and auditable.
18. As an administrator, I want new-api management access isolated from the public product, so that ordinary Users cannot discover operational interfaces.
19. As a frontend developer, I want stable BlueWhale account endpoints, so that UI work does not depend on new-api paths or response envelopes.
20. As a frontend developer, I want a capabilities endpoint containing only BlueWhale-supported features, so that I do not reproduce new-api configuration logic.
21. As a frontend developer, I want existing BlueWhale auth, me and usage route names retained, so that concurrent UI work avoids unnecessary route churn.
22. As a frontend developer, I want old SMS and refresh semantics removed, so that the UI cannot accidentally depend on the retired Java account model.
23. As a backend developer, I want one new-api account client interface, so that all BFF routes share validation, timeout and error normalization.
24. As a backend developer, I want BFF routes to remain thin adapters, so that account rules stay in new-api.
25. As a backend developer, I want the browser to submit only its credential, so that client-provided User IDs cannot become authorization inputs.
26. As a backend developer, I want Token identity resolved by new-api, so that BlueWhale never derives identity from a secret.
27. As a backend developer, I want a bounded identity cache keyed by Token digest, so that frequent Canvas requests do not require a remote lookup every time.
28. As a backend developer, I want cache entries to contain only User ID and status, so that the cache does not become a credential store.
29. As a backend developer, I want invalid or disabled credentials to evict cached identity immediately, so that explicit account changes take effect predictably.
30. As a backend developer, I want security and administrator operations to bypass the identity cache, so that sensitive decisions use current account state.
31. As a backend developer, I want expired identity cache entries rejected during an upstream outage, so that unavailable verification never becomes implicit access.
32. As a worker maintainer, I want each job to carry its encrypted submit-time credential, so that workers need no privileged secret-export endpoint.
33. As a worker maintainer, I want image and video execution to use the same credential mechanism, so that providers have one security model.
34. As a worker maintainer, I want credential rotation to make affected queued jobs fail explicitly, so that the system does not silently substitute authority.
35. As an operator, I want `GENERATE_DEFAULT_TOKEN` enabled by default before launch, so that every new BlueWhale account can use relay.
36. As an operator, I want login without a default Token to report a configuration error, so that pre-launch invariant violations are visible.
37. As an operator, I want `NEW_API_BASE_URL` to remain server-side, so that deployment topology is not exposed to browsers.
38. As an operator, I want temporary new-api outages mapped to `503`, so that monitoring and clients can distinguish availability failures.
39. As an operator, I want malformed upstream responses mapped to `502`, so that contract drift is visible.
40. As a tester, I want real new-api route tests for account creation and identity resolution, so that database and HTTP behavior are verified together.
41. As a tester, I want BFF contract tests through the account client seam, so that tests assert external behavior rather than `fetch` details.
42. As a tester, I want browser black-box tests for registration, persistence, quota and logout, so that the user-visible flow is protected.
43. As a tester, I want generation regressions proving credentials remain encrypted and hidden, so that authentication changes cannot leak secrets.
44. As a tester, I want at least one real local BlueWhale-to-new-api smoke flow, so that mocks are not the only evidence of integration.

## Implementation Decisions

- new-api owns all Account Facts: identity, credentials, profile, role, status, quota, subscription, recharge and payment.
- BlueWhale owns all Product Facts: Project, Canvas, Asset, Conversation and GenerationJob.
- Product ownership uses the stable integer new-api User ID. Token fingerprints, usernames, emails, browser IDs and unverified client IDs are forbidden as ownership keys.
- BlueWhale does not create a users table, credits ledger, password copy, quota copy or bidirectional user synchronization.
- The browser accesses only BlueWhale same-origin endpoints and never receives or constructs `NEW_API_BASE_URL`.
- The first-version credential remains a hidden `sk-xxx` in `localStorage`. Migration to an HttpOnly cookie is intentionally deferred without changing product endpoint semantics.
- The browser sends `Authorization: Bearer sk-xxx` and never sends a User ID for authorization.
- new-api adds one minimal read-only identity-resolution interface authenticated by `sk-xxx`; it returns the stable User ID and account status.
- BFF builds Authenticated User Context only from the identity-resolution result.
- The Authenticated User Context is exposed to routes through one `getAuthenticatedUser()` deep module; routes do not receive the credential, digest, cache or upstream status representation.
- Ordinary product requests may cache `{user_id, status}` for at most 60 seconds under a Token digest key.
- `GET /api/me`, security operations and administrator operations bypass the cache. Invalid, deleted or disabled credential results evict matching cache state.
- Valid cache entries may be used while new-api is temporarily unavailable. Expired entries are never used stale.
- Missing or invalid credentials map to `401`, disabled Users to `403`, malformed upstream behavior to `502`, and connection failure or timeout to `503`.
- new-api password login continues to accept username or email through one identifier field.
- BlueWhale capabilities are a projection of new-api `/api/status` limited to features BlueWhale has implemented.
- First-version public contracts are `GET /api/auth/capabilities`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me` and `GET /api/usage/token`.
- Old SMS send-code, phone rebinding and refresh-token semantics are removed from the first-version account flow.
- Registration creates the User and default API Key in one transaction and returns User ID, username, optional email and full `sk-xxx`.
- `GENERATE_DEFAULT_TOKEN` defaults to enabled. There is no legacy-user backfill or login self-healing because the product has no production Users.
- Registration failure rolls back the entire result. Login without a default Token returns an explicit configuration error.
- Registration and login are adapted to one BlueWhale success envelope. Successful registration immediately establishes first-version login state.
- Ordinary logout clears browser and in-memory account state but does not revoke the default API Key.
- The default API Key remains invisible in the ordinary BlueWhale account UI. API Key management UI is owned by separate parallel work.
- GenerationJob stores the submit-time API Key only as AES-256-GCM ciphertext.
- Image and video workers decrypt credentials only in memory immediately before relay use.
- Public job reads, snapshots, errors and logs exclude both plaintext credentials and ciphertext.
- Workers do not retrieve a User Key by User ID. Rotation invalidating an accepted job produces an explicit job failure and requires User retry.
- Production exposes BlueWhale publicly. new-api account and relay interfaces use internal networking; its management interface is separately restricted.
- The first implementation slice builds the account typed client, BFF routes, identity resolution and minimal login UI integration.
- API Key management, administrator user management and complex account configuration UI are developed separately.
- Phone login and rebinding, OAuth, Passkey and 2FA integration are deferred even when new-api already supports them.
- All protected product routes are registered and tested against the shared Authenticated User Context. New protected routes may not parse credentials or accept User IDs independently.
- Java JWT, Token-fingerprint ownership and browser `X-User-Id` are removed rather than retained behind compatibility switches.
- GenerationInbox, Conversation, Conversation-bound InputRequest replies, the persistent AgentRun Worker and Project SSE migrate to TypeScript before their Java rewrites are removed. Standalone InputRequest confirmation, AgentRun HTTP control and per-Job in-memory SSE retire instead of being copied.
- `/api/user/**` retires with the old account model. Webhooks use independent machine authentication, not User Context.
- IK50GB is complete only when the core browser, product and generation flow passes without starting Java Gateway, User Service or Product API.

## Testing Decisions

- Tests assert behavior at three high seams: the new-api account client interface, real new-api HTTP routes, and the BlueWhale browser black box.
- BFF route tests inject a fake account client rather than mocking low-level `fetch` independently in every route.
- new-api tests use the real router and a test database to verify registration atomicity, default Token creation, username/email login, stable identity resolution and status enforcement.
- Account client contract tests cover capabilities, registration, login, identity resolution, self, quota, timeout and malformed response normalization.
- BFF tests prove that client-supplied User IDs are ignored and never influence product ownership.
- Error tests verify stable `401`, `403`, `502` and `503` responses without upstream HTML, stack traces, internal URLs or secrets.
- Cache tests use a controllable clock and cover hit, miss, 60-second expiry, immediate eviction, sensitive-operation bypass and fail-closed expiry.
- Browser tests cover registration auto-login, browser-reload persistence, username/email login, account/quota display and logout.
- Browser tests assert that no request is sent directly to new-api.
- Generation tests extend the existing GenerationJob seam for both image and video credentials.
- Generation tests prove logout/browser closure does not cancel accepted jobs and prove rotated credentials produce explicit failure.
- Snapshot, list, error and logging regressions scan for both `sk-` plaintext and encrypted credential fields.
- Completion requires a local real-service smoke flow: register, login, me, quota and create a generation task against an actual new-api process.
- Completion also requires static and runtime evidence that protected routes contain no Java rewrite, Java JWT fallback, browser `X-User-Id` authorization or Token-fingerprint owner.

## Out of Scope

- HttpOnly cookie or server-side browser session migration.
- Existing production User migration, legacy Token backfill or login-time self-healing.
- Java `blue-whale-user` feature preservation.
- Phone/SMS login, phone rebinding and SMS password-change workflows.
- OAuth, Passkey and 2FA UI integration.
- API Key management UI.
- Administrator user-management UI.
- Complex new-api account-settings UI.
- A BlueWhale users table, credits ledger, quota synchronization or account data replication.
- Automatic retry of jobs whose credential was invalidated by administrator rotation.
- Public exposure or branding of the new-api console.

## Further Notes

- This spec refines and extends ADR-0062. It deliberately replaces ADR-0062's former “do not modify
  `blue_whale_api`” constraint with one narrow identity-resolution seam and a transactional registration response.
- Existing code already proxies login and quota to new-api and already encrypts video-job credentials. The work should
  deepen these existing seams instead of layering a second account abstraction beside them.
- The first-version `localStorage` choice is an explicit MVP compromise, not the target credential-storage design.
- There are no production Users, so pre-launch cleanup and contract replacement should be preferred over compatibility branches.
