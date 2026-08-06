# 新接口鉴权开发规范（Route Auth Guideline）

**工单：** IK6GTV / IK6GTT
**决策依据：** [ADR-0066](../adr/0066-route-auth-default-protect-explicit-open.md)、[ADR-0062](../adr/0062-new-api-account-center-and-quota-billing.md)
**适用范围：** `blue_whale_web/app/api/**/route.ts` 全部 API 路由

> 一句话：**默认全保护，显式放行，放行必须登记。**

## 1. 默认规则：新接口必须鉴权

新增任何 API 路由，默认必须使用鉴权包装器（`lib/auth/product-route-auth.ts`）：

| 接口类型 | 包装器 | 说明 |
| --- | --- | --- |
| 普通产品接口 | `withAuthenticatedUser(request, handler)` | ordinary 策略，60s 身份缓存 |
| 管理端接口 | `withAdminUser(request, handler)` | fresh 策略实时校验；非管理员 403 |
| 公开接口 | `withOptionalUser(request, handler)`（或裸返回） | 见第 2 节，必须在公开清单登记 |

**强制检查**：`lib/auth/protected-route-coverage.test.ts` 会遍历全部 route.ts，非公开清单内的路由若未使用 `withAuthenticatedUser` / `withAdminUser` 包装，测试直接失败。忘写鉴权 = CI 红。

## 2. 公开接口：必须登记公开路由清单

只有面向游客（未登录可访问）的接口才允许放行。**放行必须登记**：

- 清单文件：`blue_whale_web/lib/auth/public-routes.ts` 的 `PUBLIC_ROUTES`
- 登记格式：路由相对 `app/api/` 的路径（如 `agent/templates/tags/route.ts`）+ 注释说明放行理由
- **无理由登记视为违规**，评审时重点核对

放行方式二选一：

1. **裸返回**（纯公开、无身份需求）：route 内不调用任何鉴权包装器；
2. **可选鉴权**（游客可用 + 登录携带身份）：`withOptionalUser(request, handler)`，handler 收到 `user | null`。

`withOptionalUser` 语义：

- 无 token / 无效 token（401/403）→ 按游客放行，`user = null`；
- 有效 token → 解析身份传入 handler；
- 上游账户服务不可用（502/503）→ 抛出，不静默降级（公开 ≠ 掩盖故障）。

## 3. 凭证规则（不可协商）

- 只认 `Authorization: Bearer sk-xxx`，其余一律 401；
- 浏览器提交的 `user_id` / `userId` / `owner` / `X-User-Id` **不参与身份或授权**（伪造无效）；
- token 只在请求生命周期内存在，不进日志、错误、缓存；
- 认证失败统一信封：401「登录凭证无效」/ 403「账户已停用」/ 502「账户服务响应异常」/ 503「账户服务暂不可用」。

## 4. 管理端红线

- `withAdminUser` 只认 `role >= 10`（new-api 角色：1 普通 / 10 管理员 / 100 root）；
- 管理端接口**不得**以公开或可选鉴权方式放行；
- 管理端不做身份缓存（fresh 策略），每次实时校验。

## 5. 新增接口清单（Checklist）

1. 确定接口类型：普通 / 管理端 / 公开；
2. 普通 → `withAuthenticatedUser`；管理端 → `withAdminUser`；公开 → 登记 `public-routes.ts` + `withOptionalUser`（或裸返回）；
3. 补路由测试：匿名 401/403 语义、公开接口游客 200、伪造身份字段不生效；
4. 跑 `pnpm --filter blue_whale test`（含路由覆盖测试）+ `tsc --noEmit`；
5. PR 评审：核对 `public-routes.ts` 新增条目的放行理由。

## 6. 示例

```ts
// 普通接口（默认）
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
export async function GET(request: Request) {
  return withAuthenticatedUser(request, async (user) =>
    Response.json({ userId: user.userId }),
  );
}

// 公开接口（可选鉴权）
import { withOptionalUser } from "@/lib/auth/product-route-auth";
// public-routes.ts 登记："example/public/route.ts —— 公开内容，游客可见"
export async function GET(request: Request) {
  return withOptionalUser(request, (user) =>
    Response.json({ guest: user === null, userId: user?.userId ?? null }),
  );
}
```

## 7. 相关文件

| 文件 | 作用 |
| --- | --- |
| `lib/auth/product-route-auth.ts` | `withAuthenticatedUser` / `withAdminUser` / `withOptionalUser` |
| `lib/auth/authenticated-user.ts` | 身份解析、缓存、错误语义 |
| `lib/auth/public-routes.ts` | 公开路由集中清单（放行唯一入口） |
| `lib/auth/protected-route-coverage.test.ts` | 路由覆盖强制测试（引用公开清单） |
