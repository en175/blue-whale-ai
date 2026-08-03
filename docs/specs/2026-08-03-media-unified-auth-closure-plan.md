# 媒体统一鉴权收口实施计划（IK50GC / IK50GD）

**日期：** 2026-08-03
**依据：** `docs/specs/2026-08-03-ik50gb-c-java-retirement-media-auth-design.md` §4、Gitee 工单 IK50GC / IK50GD
**前置（已满足）：** 阶段一（无 Java 验收）与阶段二（物理删除 Java）已合入本地 master。

## 0. 现状调查结论

- 浏览器不可直达 new-api `/v1/*`（`NEW_API_BASE_URL` 仅服务端），BlueWhale 媒体面全部是 `app/api` 同源路由，已被 `protected-route-coverage.test.ts` 强制走 `withAuthenticatedUser`。
- 媒体输入资源授权（`input_asset_ids` 按 userId+projectId 校验）与凭证 AES-256-GCM 密封已有实现基础，需按接口清单补契约测试。
- 已知缺口两个：`admin/topup-tiers` 4 个路由无鉴权；SMS/send-code 死代码仍在（`send-code` 路由 + `handle-send-code` + `api-client` + `auth.ts` + `lib/auth/sms.ts`）。

## 1. Task A：管理端鉴权缺口修复

- `app/api/admin/topup-tiers/**`（route、[id]、sort、preview）接入统一鉴权 + 管理员身份判定（new-api role）。
- 从 `protected-route-coverage.test.ts` EXEMPT 清单移除，改为受守卫覆盖。
- TDD：先写"未认证 401 / 非管理员 403"失败测试。

## 2. Task B：媒体接口逐项契约测试（IK50GC 验收对齐）

按设计文档 §4.4 清单逐项契约测试（Authorization、所有权拒绝、quota 归属、错误映射、凭证脱敏）：

1. `POST /api/projects/:id/generation-jobs`（image）
2. `POST /api/projects/:id/generation-jobs`（video，含图生图/图生视频输入 Asset 授权：跨用户/跨项目拒绝、`unsupported_input` 不计费）
3. `POST .../generation-jobs/:jobId/retry` 与 `/cancel`（非 owner 拒绝）
4. `GET /api/jobs?ids=` 与 `GET /api/jobs/:id`（跨用户不可见）
5. 凭证边界：任务查询/快照/日志/错误面不含明文 Key 与密文；轮换失效任务显式失败

## 3. Task C：SMS/refresh 死代码清理（IK50GD 验收标准 1）

- 删除 `app/api/auth/send-code/route.ts`、`lib/auth/handle-send-code.ts`、`lib/auth/sms.ts` 及 `api-client.ts` / `auth.ts` 中的调用与类型。
- 同步更新 capabilities 输出与前端登录表单分支、受保护路由守卫 EXEMPT。
- TDD：先写"send-code 路由不存在 / capabilities 不暴露短信能力"失败测试。

## 4. Task D：浏览器黑盒回归（IK50GD 验收标准 2）

- 复用 `blue_whale_web/e2e/` 存量：注册自动登录、刷新恢复、账户/quota 展示、logout；断言无直连 new-api 请求。

## 5. 验证

`pnpm typecheck`、`pnpm test`、no-Java 守卫、TS baseline 验收 6/6、受保护路由覆盖测试全绿。

## 6. 真实联调（IK50GD 验收标准 3）

本地真实链路已在阶段一 smoke 覆盖（6/6）；测试站 live probe 需用户另行提供 `BW_TEST_BASE_URL`、测试账号与 `BW_ALLOW_BILLED_MEDIA_PROBE=1` 计费授权，独立执行，不阻塞本计划合入。

## 7. 提交形态

任务分支 `feature/媒体统一鉴权收口`（--issue IK50GC）；按「一子任务一提交」粒度，A/B/C/D 若超粒度则拆串行子工单。工单状态随 worktree 入口/合入自动流转。
