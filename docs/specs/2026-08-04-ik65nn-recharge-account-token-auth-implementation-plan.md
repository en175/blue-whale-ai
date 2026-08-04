# IK65NN Recharge Account Token Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 BlueWhale 充值链路使用真实用户 `sk-xxx`，并从该 Token 解析订单 User ID，退役 root 代理下单。

**Architecture:** 在 Go 中新增账户级 Token 校验与 `AccountTokenOrUserAuth`，把账户身份认证从严格 relay 调用资格中分离。Next.js BFF 继续先建立 Authenticated User Context，再把同一请求 Token 透传给 Go 原生充值控制器。

**Tech Stack:** Go 1.22、Gin、GORM、TypeScript、Next.js Route Handlers、Vitest、pnpm。

## Global Constraints

- BlueWhale 终端用户链路只使用 new-api `sk-xxx`。
- Token 耗尽不阻止充值；Token 禁用、到期或 User 禁用必须阻止充值。
- 模型、图片和视频的严格 `TokenAuth` 行为不得降低。
- 充值链路不得发送 `New-Api-User`，订单 User ID 只来自 Go 验证的 Token 属主。
- root 凭证仅保留给真正的 Root 管理接口。
- 按 TDD 顺序先观察测试失败，再写最小实现。

---

### Task 1: Go 账户 Token 身份核心

**Files:**
- Modify: `blue_whale_api/model/token.go`
- Modify: `blue_whale_api/middleware/auth.go`
- Create: `blue_whale_api/middleware/account_token_auth_test.go`

**Interfaces:**
- Produces: `model.ValidateAccountToken(key string) (*Token, error)`
- Produces: `middleware.AccountTokenAuth() gin.HandlerFunc`
- Produces: `middleware.AccountTokenOrUserAuth() gin.HandlerFunc`

- [ ] **Step 1: 写账户 Token 中间件失败测试**

覆盖 enabled/exhausted 成功，disabled/expired/不存在失败，以及 User 禁用失败；测试断言成功时
Context `id` 等于 `token.UserId`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `cd blue_whale_api && go test ./middleware -run 'TestAccountToken' -count=1`

Expected: FAIL，原因是账户 Token API 尚不存在。

- [ ] **Step 3: 实现最小账户 Token 校验**

`ValidateAccountToken` 使用 `GetTokenByKey`，允许 `TokenStatusExhausted`，拒绝
`TokenStatusDisabled`、`TokenStatusExpired` 和实际到期时间；中间件检查 User cache 状态并注入
`id/token_id/token_key`。session 分支验证 User 状态后继续，Token 分支调用 `AccountTokenAuth`。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `cd blue_whale_api && go test ./middleware -run 'TestAccountToken' -count=1`

Expected: PASS。

### Task 2: Go 身份与充值路由接入

**Files:**
- Modify: `blue_whale_api/controller/user.go`
- Modify: `blue_whale_api/controller/user_contract_test.go`
- Modify: `blue_whale_api/router/api-router.go`
- Create: `blue_whale_api/router/account_topup_auth_test.go`

**Interfaces:**
- Consumes: `ValidateAccountToken` 与 `AccountTokenOrUserAuth`
- Produces: `/api/token/identity` 和三个充值端点统一账户凭证语义

- [ ] **Step 1: 写 identity 耗尽 Token 和充值路由 Token 属主失败测试**

identity 测试把默认 Token 状态改为 exhausted 后仍应返回原 User ID；路由测试用两个 User 的 Token
验证订单/查单 Context 不能串 User，并验证禁用 Token 返回 `401`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `cd blue_whale_api && go test ./controller ./router -run 'Test(TokenIdentityAllowsExhausted|AccountTopUpAuth)' -count=1`

Expected: FAIL，identity 仍调用严格校验，充值路由仍只使用 UserAuth。

- [ ] **Step 3: 接入账户 Token 鉴权**

identity 改用账户 Token resolver；从 `selfRoute` 移出 `/topup/self`、`/amount` 和
`/bluewhalepay/pay`，挂到 `AccountTokenOrUserAuth` 保护的账户充值 route group，保留原 URL 和
`CriticalRateLimit`。

- [ ] **Step 4: 运行 Go 相关测试**

Run: `cd blue_whale_api && go test ./model ./middleware ./controller ./router -count=1`

Expected: PASS。

### Task 3: Typed client 删除伪造 User 头

**Files:**
- Modify: `packages/core/src/new-api-client.ts`
- Modify: `packages/core/src/new-api-client.test.ts`

**Interfaces:**
- Produces: `requestTopUpAmount(token, amount)`
- Produces: `createBlueWhalePayTopUp(token, amount, wayCode?)`
- Produces: `getTopUpByTradeNo(token, tradeNo)`

- [ ] **Step 1: 修改测试，要求充值请求无 `New-Api-User`**

三个请求分别断言 `Authorization: Bearer sk-user`，且 `headers.get("New-Api-User")` 为 `null`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm vitest run packages/core/src/new-api-client.test.ts`

Expected: FAIL，现有调用仍接受并发送 User ID。

- [ ] **Step 3: 删除 userId 参数和 header helper**

只保留 Bearer Token；同步类型和注释，不改变业务响应解析。

- [ ] **Step 4: 运行 core 测试并确认 GREEN**

Run: `pnpm vitest run packages/core/src/new-api-client.test.ts`

Expected: PASS。

### Task 4: Next.js 充值 BFF 透传用户 Token

**Files:**
- Modify: `blue_whale_web/lib/recharge/go-topup.ts`
- Modify: `blue_whale_web/lib/recharge/go-topup.test.ts`
- Modify: `blue_whale_web/app/api/recharge/order/route.ts`
- Modify: `blue_whale_web/app/api/recharge/order/route.test.ts`
- Modify: `blue_whale_web/app/api/recharge/order/[tradeNo]/status/route.ts`
- Modify: `blue_whale_web/app/api/recharge/order/[tradeNo]/status/route.test.ts`

**Interfaces:**
- Produces: `loadGoTopUpConfig(): { baseUrl: string } | null`
- Consumes: 当前请求中经 `withAuthenticatedUser` 验证的 Bearer `sk-xxx`

- [ ] **Step 1: 写失败测试**

配置测试仅要求 `NEW_API_BASE_URL`；路由测试断言 typed client 收到请求 Token 且不收到 root User
参数；伪造/缺失 Token 继续由 `withAuthenticatedUser` 拒绝。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter blue_whale test --run lib/recharge/go-topup.test.ts app/api/recharge/order/route.test.ts 'app/api/recharge/order/[tradeNo]/status/route.test.ts'`

Expected: FAIL，现有实现仍读取 root env 并传 root 参数。

- [ ] **Step 3: 实现 BFF Token 透传**

重命名配置 loader，认证成功后从严格 Bearer header 取 Token，调用 typed client 的新签名；更新错误
文案和注释。不得记录 Token。

- [ ] **Step 4: 运行路由测试并确认 GREEN**

Run: `pnpm --filter blue_whale test --run lib/recharge/go-topup.test.ts app/api/recharge/order/route.test.ts 'app/api/recharge/order/[tradeNo]/status/route.test.ts'`

Expected: PASS。

### Task 5: 文档、回归和提交

**Files:**
- Modify: `docs/adr/0062-new-api-account-center-and-quota-billing.md`
- Modify: `docs/credits-system-integration-flow.md`

**Interfaces:**
- Produces: 与实现一致的单凭证、双授权层架构说明

- [ ] **Step 1: 更新架构文档**

记录账户级 Token 与 relay Token 的策略差异、充值 root 退役范围，以及 RootAuth 管理同步仍保留。

- [ ] **Step 2: 运行格式化与范围验证**

Run: `cd blue_whale_api && gofmt -w model/token.go middleware/auth.go middleware/account_token_auth_test.go controller/user.go controller/user_contract_test.go router/api-router.go router/account_topup_auth_test.go`

Run: `cd blue_whale_api && go test ./model ./middleware ./controller ./router -count=1`

Run: `pnpm vitest run packages/core/src/new-api-client.test.ts`

Run: `pnpm --filter blue_whale test --run lib/recharge/go-topup.test.ts app/api/recharge/order/route.test.ts 'app/api/recharge/order/[tradeNo]/status/route.test.ts'`

Run: `pnpm typecheck`

Expected: 全部 exit 0。

- [ ] **Step 3: 完整回归**

Run: `cd blue_whale_api && go test ./... -count=1`

Run: `pnpm test`

Expected: 全部 exit 0。

- [ ] **Step 4: 审查和提交**

按 `requesting-code-review` 进行独立审查，关闭 Critical/Important 后运行最终验证，再执行：

Run: `scripts/commit-task-for-review.sh -m "fix: 统一充值账户令牌鉴权"`

Expected: 工单分支生成本地 review commit；不 push、不创建 PR、不合并 master。
