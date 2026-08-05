# 管理后台鉴权与数据打通契约（Admin API Contract）

**时间：** 2026-08-05
**工单：** IK6JXI（后端·管理API与契约）/ IK6JXJ（前端·入口守卫与页面打通）
**决策依据：** [route-auth-guideline](./2026-08-04-route-auth-guideline.md)（IK6GTT）、`withAdminUser`（fresh 实时校验）、new-api `AdminAuth()`（role >= 10）
**适用范围：** `blue_whale_web/app/api/admin/**` 全部管理接口 + `app/admin/**` 页面

> 一句话：**管理端全部走 `withAdminUser`，数据直连 new-api 管理接口，字段以本文契约为唯一准绳。** 两个工单并行开发、零文件冲突，契约先行。

## 1. 背景与目标

`/admin` 目前页面层无真实鉴权（layout 只查 localStorage 有无 token），用户管理/订单/仪表板无后端接口（前端全 mock）。本契约定义：

1. 管理员身份的判定与前端可见性（`/api/me` 加 `is_admin`）；
2. 管理数据接口的请求/响应字段（web 层对外契约，camelCase）；
3. new-api 内部映射（后端工单按此转发）；
4. 前端页面适配点与文件边界。

## 2. 鉴权与通用信封

| 项 | 约定 |
| --- | --- |
| 鉴权 | 所有 `/api/admin/*` 一律 `withAdminUser(request, handler)`（fresh 实时校验，非管理员 403） |
| 403 响应 | `{ code: 403, msg: "需要管理员权限", data: null }`（withAdminUser 现成行为） |
| 成功信封 | `{ success: true, data: <T>, warning?: string }`（对齐现有 admin 接口与 `adminRequest`） |
| 失败信封 | `{ success: false, error: string }` + 合适 HTTP 状态 |
| 透传 | web 层复用请求中的 `Authorization: Bearer sk-xxx` 调 new-api 管理接口（管理员 token 天然通过 `AdminAuth()`） |
| 身份 | 登录用户 token 即 new-api token；`/api/token/identity` 返回 `role`（1 普通 / 10 管理员 / 100 root），`role >= 10` 即管理员 |

## 3. 数据模型（web 层对外，camelCase）

### 3.1 AdminUser（用户管理）

| 字段 | 类型 | new-api 映射 | 说明 |
| --- | --- | --- | --- |
| `userId` | number | `User.id` | |
| `nickname` | string | `display_name` 优先，空则 `username` | |
| `phone` | string | `""` 或 `email` | new-api 无手机号；后端可回填 email，前端展示兼容 |
| `balance` | number | `User.quota` | 剩余积分 |
| `totalRecharge` | number | `quota + used_quota` | 累计到账（口径：近似值，契约锁定） |
| `totalSpend` | number | `used_quota` | 累计消费 |
| `role` | number | `User.role` | 1/10/100 原样透传 |
| `status` | `"active" \| "disabled"` | `status === 1 ? "active" : "disabled"` | |
| `createdAt` | string ISO | `created_at`（秒级 int64） | |
| `updatedAt` | string ISO | 同 `createdAt` | new-api 无独立更新时间，锁定同值 |

### 3.2 AdminOrder（订单管理）

| 字段 | 类型 | new-api 映射 | 说明 |
| --- | --- | --- | --- |
| `tradeNo` | string | `TopUp.trade_no` | |
| `userId` | number | `TopUp.user_id` | |
| `nickname` | string | 后端按 `user_id` 补充 | 实现时选批量方式；无法获取则 `""` |
| `phone` | string | `""` | |
| `tierName` | string | 后端生成 `` `${amount} 积分` `` | new-api TopUp 无档位名，锁定生成规则 |
| `amount` | number | `TopUp.amount` | 积分数量 |
| `price` | number | `TopUp.money` | 金额（元） |
| `points` | number | 同 `amount` | |
| `bonus` | number | `0` | new-api 无返利字段，锁定 0 |
| `status` | `"pending" \| "success" \| "expired" \| "failed"` | `TopUp.status` 原样透传 | **注意：是 `success` 不是 `paid`** |
| `paymentMethod` | string | `TopUp.payment_method` | |
| `platformRefNo` | string \| null | `TopUp.payment_provider` | |
| `ip` | string | `""` | new-api 无 IP，锁定空串 |
| `createdAt` | string ISO | `create_time` | |
| `paidAt` | string ISO \| null | `complete_time` 为 0 时 null | |
| `arrivedAt` | string ISO \| null | 同 `paidAt` | |

### 3.3 DashboardStats（仪表板）

```ts
{
  totalUsers: number;          // new-api GET /api/user（page=1,page_size=1）的 total
  todayRecharge: number;       // 今日充值积分：当日 topups 聚合（后端按 GetAllTopUps 分页扫当日）
  todayRechargeCount: number;  // 今日充值笔数：同上聚合计数
  todaySpend: number;          // 今日消费：GET /api/log/stat?type=2&start_timestamp=今日零点&end_timestamp=now → quota
  pendingOrders: number;       // 待处理订单：GetAllTopUps status=pending 聚合计数
  recentRecharges: AdminOrder[];  // 最近充值（topups 倒序前 5）
  recentConsumes: ConsumeRecord[]; // 最近消费（logs 倒序前 5，见 3.4）
}
```

> new-api log type 常量：`1=Topup`、`2=Consume`、`3=Manage`、`6=Refund`。今日消费统计用 `type=2`。

### 3.4 ConsumeRecord（最近消费，仪表板用）

```ts
{ userId: number; model: string; points: number; createdAt: string; }
```

映射 new-api `GET /api/log`（管理员侧）前 5 条：`user_id` / `model_name` / `prompt_tokens+completion_tokens` 折算或 `quota` / `created_at`。折算规则由后端实现时在代码注释中锁定（契约不强绑定折算公式）。

## 4. 接口契约（web 层对外）

### 4.1 GET /api/me（已有接口，增加字段）

响应 `data` 增加：`is_admin: boolean`（`identity.role >= 10`）。其余字段不变。**前端入口判断唯一数据源。**

### 4.2 GET /api/admin/users

```
Query: keyword?: string   // 用户名/ID 模糊
       status?: "active" | "disabled"
       role?: number
       page?: number      // 默认 1
       pageSize?: number  // 默认 20，上限 100
响应: { success: true, data: { list: AdminUser[], total: number } }
```

内部映射：new-api `GET /api/user/search?keyword=&status=&role=&p=&page_size=`（status 需转 1/0；无筛选条件时走 `GET /api/user` 分页）。余额区间筛选**前端本地过滤**（数据量大后再下沉，本轮不做后端支持）。

### 4.3 POST /api/admin/users/:userId/manage

```
Body: { action: "freeze" | "unfreeze" | "adjustBalance", value?: number, reason: string }
响应: { success: true, data: null }
```

| action | new-api 映射 | 说明 |
| --- | --- | --- |
| `freeze` | `POST /api/user/manage { id, action: "disable" }` | reason 记操作日志 |
| `unfreeze` | `POST /api/user/manage { id, action: "enable" }` | reason 记操作日志 |
| `adjustBalance` | `POST /api/user/manage { id, action: "add_quota", value: abs(value), mode: value>=0 ? "add" : "subtract" }` | value=0 拒绝（400） |

### 4.4 GET /api/admin/orders

```
Query: keyword?: string   // trade_no 模糊
       status?: "pending" | "success" | "expired" | "failed"
       page?: number      // 默认 1
       pageSize?: number  // 默认 20，上限 100
响应: { success: true, data: { list: AdminOrder[], total: number } }
```

内部映射：new-api `GET /api/user/topup?keyword=&p=&page_size=`；status 筛选后端在 web 层过滤（new-api 无 status 参数）。订单详情复用列表数据（前端本地取详情，不新增接口）。

### 4.5 POST /api/admin/orders/:tradeNo/complete

```
Body: { reason: string }
响应: { success: true, data: null }
```

内部映射：new-api `POST /api/user/topup/complete { trade_no }`。reason 记操作日志。

### 4.6 GET /api/admin/dashboard

```
响应: { success: true, data: DashboardStats }
```

## 5. 操作日志（服务端写）

所有写操作（4.3 / 4.5）成功后，web 层服务端写入 `admin_operation_logs`（复用 `createOperationLogDeps`）：

| 字段 | 值 |
| --- | --- |
| `category` | `"user"`（用户管理）/ `"order"`（订单管理） |
| `action` | `user.freeze` / `user.unfreeze` / `user.adjust_balance` / `order.complete` |
| `target` | 用户名或 `trade_no` |
| `targetUserId` | 用户 ID 或 null（订单操作无） |
| `detail` | JSON `{ reason, value? }` |
| `operator` / `operatorId` | 当前管理员 username / userId（来自 withAdminUser 的 user） |
| `ipAddress` | 请求 IP（可空） |

失败不阻断主流程（best-effort，对齐 topup-tiers 现有写法）。

## 6. 前端适配点（IK6JXJ 按此执行）

1. `AuthContext` User 加 `isAdmin: boolean`，登录/刷新从 `/api/me` 读 `is_admin`；
2. `UserMenu`：`isAdmin` 为 true 时显示「系统设置」入口，点击 `router.push("/admin")`；普通用户不显示；
3. `admin/layout.tsx`：挂载时调 `GET /api/admin/session`（现成 withAdminUser 接口）确认管理员，非管理员 `router.replace("/")`；
4. `users/page.tsx`：数据源切 `/api/admin/users`；`ROLE_LABELS` 扩为 `{1: "普通用户", 10: "管理员", 100: "root"}`；`status` 枚举沿用 `active/disabled`；冻结/解冻/调余额调用 4.3；
5. `orders/page.tsx`：数据源切 `/api/admin/orders`；状态枚举改为 `{pending, success, expired, failed}`，标签：待支付/已到账/已过期/支付失败（**移除 `paid`/`refunded`**）；补单调用 4.5；导出保留本地实现；
6. `page.tsx`（仪表板）：数据源切 `/api/admin/dashboard`；
7. 删除 `app/admin/users/_mock.ts`、`app/admin/orders/_mock.ts`、`app/admin/pricing/_mock.ts`、`app/admin/tiers/_mock.ts` 及页面内对 mock 的导入（tiers/pricing 已有真实接口 `/api/admin/topup-tiers*`，数据源已真实，仅清 mock 引用）；
8. 操作日志页已真实（`/api/admin/operation-logs`），不改。

## 7. 文件边界（零冲突）

| 归属 | 文件区 |
| --- | --- |
| IK6JXI（后端） | `blue_whale_web/app/api/admin/**`（新增 users/orders/dashboard）、`blue_whale_web/app/api/me/route.ts`、`packages/core/src/new-api-client.ts`（扩展 admin 方法）、`blue_whale_web/lib/auth/public-routes.ts`（移除 `admin/operation-logs` 过时登记） |
| IK6JXJ（前端） | `blue_whale_web/app/admin/*`（layout + 页面 + `_lib`）、`blue_whale_web/components/auth/**`（AuthContext / UserMenu / types） |
| 公共（本契约） | `docs/specs/`（散文例外区） |

## 8. 合入顺序与验收

- **顺序**：IK6JXI 先合（接口与契约落地），IK6JXJ 后合（前端切换）。两工单可并行开发。
- **后端验收**：管理员 token curl 各接口返回真实数据、普通 token 403；冻结/解冻/补单后 new-api 生效且操作日志可查；`/api/me` 返回 `is_admin`。
- **前端验收**：管理员右上角出现「系统设置」可进 `/admin`；普通用户无入口且手输 `/admin` 被重定向；三页面真实数据；写操作生效并有日志；`pnpm --filter blue_whale test` + `tsc --noEmit` 通过。

## 9. 关联

- 工单：IK6JXI / IK6JXJ
- 依据：`docs/specs/2026-08-04-route-auth-guideline.md`、`docs/adr/0066`、`docs/adr/0062`
