# ADR-0066: Node 路由鉴权——默认全保护，显式放行（公开路由清单）

**日期：** 2026-08-04
**状态：** 已接受
**工单：** IK6GTT / IK6GTV（IK6GM6 触发）
**关联：** ADR-0062（new-api 账户中心）、IK50GB（统一产品认证）

## 背景

IK50GB 统一产品认证后，Node 网关所有产品路由默认要求 `Authorization: Bearer sk-xxx`，由 `protected-route-coverage.test.ts` 强制检查（除白名单外不得绕过认证 seam）。但存在两个问题：

1. **放行机制不透明**：白名单（EXEMPT）硬编码在测试文件里，运行时无对应清单；"新接口如何放行、什么算公开"无成文标准，新成员只能翻测试代码猜测。
2. **误伤真实业务**：IK6GM6 发现首页模板区（营销视频/微短片/视频复刻/社媒视频/图片设计）UI 上对游客公开渲染，但 `/api/agent/templates/*` 接口被统一认证强制登录，游客访问返回 401，登录后错误残留需刷新才恢复。模板卡片为纯公开内容，被"默认全保护"误伤。

## 决策

### D1. 默认全保护原则不变

- 所有新 API 路由默认必须使用 `withAuthenticatedUser`（普通产品接口）或 `withAdminUser`（管理端接口）。
- 路由覆盖测试强制此约束：非公开清单内的 route.ts 若未使用鉴权包装器，测试失败。
- 浏览器提交的 `user_id` / `userId` / `owner` / `X-User-Id` 一律不参与身份或授权（沿用 IK50GB）。

### D2. 公开路由集中清单（单一配置入口）

- 新增 `blue_whale_web/lib/auth/public-routes.ts`，集中声明全部公开路由（相对 `app/api/` 的 route.ts 路径）。
- 路由覆盖测试引用 `isPublicRoute()` 判定豁免，不再各自维护 EXEMPT。
- 每条公开路由必须附带注释说明放行理由；无理由登记视为违规。
- 新增/修改公开路由 = 只改清单一处（+ route 实现）。

### D3. 可选鉴权（游客可访问，登录携带身份）

- 公开路由如需"无 token 放行、有 token 解析身份"，使用 `withOptionalUser`：
  - 无 token / 无效 token（401/403）→ 按游客处理，handler 收到 `null`；
  - 有效 token → 解析身份传给 handler；
  - 上游不可用（502/503）→ 如实抛出，不静默降级。

### D4. 管理端不降级

- `withAdminUser` 语义不变：fresh 实时校验，非管理员 403，管理接口不得以"公开"或"可选"方式放行。

## 连锁影响

- 模板区接口从"强制登录"改为 `withOptionalUser`：游客 200、登录用户 200 且携带身份，为后续个性化模板预留。
- 路由覆盖测试改为引用共享清单，放行条目来源单一，审查 PR 时核对 `public-routes.ts` 即可。
- 历史 EXEMPT 条目（auth/me/usage/recharge/operation-logs）全部迁移至清单，行为不变。

## 被否方案

- **运行时中间件统一鉴权**：将所有路由改为声明式清单（如 `next.config` 路由规则）。拒绝理由：Next.js Route Handlers 无统一中间件语义，逐路由包装器 + 测试强制的现状已足够，重构收益低于成本，且易引入新绕过面。
- **允许公开路由不登记**（仅改 route 不加清单）：拒绝理由：无登记则无法审计放行面，IK6GM6 类误伤会重现。
