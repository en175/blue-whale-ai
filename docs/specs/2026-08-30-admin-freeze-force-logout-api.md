# 管理员冻结用户强制登出——前端对接说明

## 时间

2026-08-30

## 背景 / 目标

管理员「冻结（禁用）」用户账号时，该用户所有登录会话被**立即登出**（不再依赖原有 ≤5 分钟状态复核）；以后该用户也登不进来（new-api 上游 status 拦截，蓝鲸侧无需处理）。

同时：用户**修改密码**成功后，该用户所有登录会话（含当前窗口）也会被立即吊销，重新登录需用新密码。

本文件是**后端交付后的前端对接说明**。web/ 前端代码本轮不改，由前端同事按本文档决定是否/如何展示。

## 接口变化

### 1. 管理员冻结用户

`POST /api/admin/users/:userId/manage`，`action=freeze`（冻结）成功时，响应 `data` 从 `null` 变为：

```json
{ "success": true, "data": { "revokedSessions": 2 } }
```

- `revokedSessions`：本次吊销的该用户登录会话数（int，≥0）。
- 其余 action（`unfreeze` / `adjustBalance`）响应不变，仍是 `{ "success": true, "data": null }`。
- 包络判定不变：前端 `http.ts` 以 `body.code === 200 || body.success === true` 判成功，不受影响。
- 冻结时若会话吊销失败（Redis 瞬时故障），冻结仍成功，`data.revokedSessions = 0`，失败原因写入管理审计（`admin_operation_logs` detail 含 `revokeError`）。

### 2. 用户修改密码（新增行为）

`PUT /api/me/password`，改密**成功**时响应 `data` 从 `null` 变为：

```json
{ "code": 200, "data": { "revokedSessions": 3 }, "msg": null }
```

- `revokedSessions`：改密后吊销的该用户全部登录会话数（int，≥0），**含当前改密窗口**。
- 改密失败（原密码错误等）响应不变，不吊销会话。
- 会话吊销为 best-effort：Redis 瞬时故障时仍返回成功，`revokedSessions = 0`。

## 被踢用户的前端表现（关键）

- 冻结/改密后该用户**全部** `bw_session` 会话被服务端立即删除（改密含当前窗口）。
- 用户下一次任何请求返回 **401**；`web/src/api/http.ts` 已有全局 401 处理（非豁免路径 `setSession(null)` 清本地会话）。
- `RequireAuth` / `RequireAdmin` 守卫订阅登录态变化，自动重定向回首页（首页有登录入口）。
- **无需新增实时推送**：用户处于活跃操作时会在下一次请求时立即被踢；空闲用户在下一次操作/刷新时被踢，符合无实时推送的决策。

## 建议前端可选优化（不强求）

1. 冻结弹窗（FreezeModal）加提示文案：「冻结将立即登出该用户所有登录会话」。
2. 冻结成功 toast 可展示 `revokedSessions`（如「已冻结，已登出 N 个会话」）。
3. 修改密码成功后的提示可注明「已登出所有登录会话，请用新密码重新登录」（前端可展示响应里的 `revokedSessions`）。

## 验证 / 关联

- 后端单测：`session.service.test.ts`（索引/吊销）、`users.controller.test.ts`（freeze 顺序、best-effort、unfreeze 不踢）、`me.controller.test.ts`（改密成功吊销、失败不吊销、best-effort）。
- 联调路径：管理员在 `/admin/users` 冻结某用户 → 该用户在另一浏览器/设备的下一次操作即被登出回首页；重新登录被拒（需该用户已被 new-api 禁用）。用户在设置里改密码 → 当前窗口下一次操作被登出，其他设备会话同时失效，重新登录需新密码。
