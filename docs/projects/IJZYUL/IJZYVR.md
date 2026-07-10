# IJZYVR — [ARCH-7] feat: API 客户端骨架

> **工单**：[IJZYVR — API 客户端骨架](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IJZYVR)
> **父 issue**：[IJZYUL](./README.md)（子 issue #7）
> **状态**：⏳ 待提交（实现完成,等用户确认后用 `scripts/commit-task-for-review.sh` 入库）
> **分支**：`feature/IJZYVR-API客户端骨架`
> **完成日期**：—

## 范围

搭一个**纯客户端、不引运行时依赖**的 API 客户端骨架（IJZYUL #7），
对齐 `blue-whale-agent-workspace/BACKEND-API-PRD.md` §4-5 P0 接口契约。
骨架=**传输层 + DTO + endpoint 函数**,不接 SSE、不接业务消费点。

端到端路径：

1. `blue_whale_web/lib/api/userId.ts` —— 匿名 UUID v4 持久化（`bw-user-id` localStorage）
2. `blue_whale_web/lib/api/errors.ts` —— `ApiError` 类 + `isApiError` 守卫 + P0 错误码白名单
3. `blue_whale_web/lib/api/client.ts` —— `apiFetch<T>` 基础包装（`/api` 前缀 + `X-User-Id` header + 错误体归一化 + 204 处理）
4. `blue_whale_web/lib/api/dto.ts` —— snake_case DTO 类型（严格对齐 PRD §5.1-5.5）
5. `blue_whale_web/lib/api/endpoints.ts` —— typed endpoint 函数（§5.1 me / §5.2 assets / §5.3 catalog / §5.4 jobs / §5.5 projects）
6. `blue_whale_web/lib/api/index.ts` —— 对外入口（re-export；`apiFetch` 不导出,消费方只能走 endpoint）

## 验收逐条

> IJZYVR 工单验收意图（按父 issue IJZYUL README 拆分）："API 客户端骨架,不接业务消费点,不引运行时依赖,可被后续工单（BottomDock 接入 / Project 恢复 / Asset 上传替换 base64）直接 import"。

- [x] **AC#1**：覆盖 BACKEND-API-PRD §5.1-5.5 全部 P0 endpoint（11 个函数）：
  - `getMe` / `presignAsset` / `completeAsset` / `getAsset` / `getCatalog`
  - `startGeneration` / `getJob` / `listProjects` / `createProject` / `getProject` / `patchProject` / `deleteProject`
- [x] **AC#2**：`X-User-Id` header 由 `apiFetch` 自动注入,UUID v4 严格校验（`userId.ts` regex 拒绝 v1 格式）
- [x] **AC#3**：错误体 `{ error: { code, message, detail } }` 归一化为 `ApiError`（status + code + message + detail + name=`ApiError`）
- [x] **AC#4**：非 2xx 无 error 段（HTML / 裸 JSON）→ 兜底 `http_<status>` code,message 走 statusText
- [x] **AC#5**：snake_case DTO 字段命名 1:1 对齐 PRD §5（无字段名漂移,无 snake↔camel 转换 —— 消费方按需做）
- [x] **AC#6**：`time` 字段保持 ISO 8601 字符串（不做 Date 转换）
- [x] **AC#7**：204 No Content → 返回 `undefined` 且不尝试解析 body
- [x] **AC#8**：路径参数全部 `encodeURIComponent`（asset_id / project_id / job_id）
- [x] **AC#9**：`baseUrl` 可覆盖（测试 / 跨部署用,不引 env var,保持 skeleton 简单）
- [x] **AC#10**：`apiFetch` 不在 `index.ts` re-export,消费方只能走 endpoint 函数
- [x] **AC#11**：零运行时依赖（`package.json` 未动,无 zod/valibot/axios/ofetch）
- [x] **AC#12**：`JobStatus` 字面 = PRD §5.4（`queued | processing | succeeded | failed`）

## 显式不收（保持 skeleton 边界）

- **SSE 客户端**（`/api/jobs/{id}/stream` + `/api/projects/{id}/agent/turn`）—— 业务方按 PRD §5 + AGENT-CONVERSATION-PRD 实现
- **runtime 校验**（zod / valibot）—— 不引依赖,留 P2
- **snake ↔ camel 转换器** —— 消费方在 hook 层按需 map 到 `@/types/domain`
- **实际业务接入**（BottomDock 触发 generate、TopBar 拉 projects 列表、AgentChatPanel 接 agent turn）—— 后续各 feature issue
- **环境变量加载**（`process.env.NEXT_PUBLIC_API_BASE`）—— 留 baseUrl 覆盖口子即可,不引 dotenv
- **重试 / 退避 / 缓存 / 队列** —— P0 不承诺

## 改动文件（9 个,全部新增）

```
blue_whale_web/lib/api/client.ts         (114 行) —— apiFetch 包装
blue_whale_web/lib/api/client.test.ts    (165 行 / 11 tests)
blue_whale_web/lib/api/userId.ts         ( 64 行) —— 匿名 UUID 持久化
blue_whale_web/lib/api/userId.test.ts    ( 66 行 /  5 tests)
blue_whale_web/lib/api/errors.ts         ( 57 行) —— ApiError + 守卫
blue_whale_web/lib/api/errors.test.ts    ( 48 行 /  6 tests)
blue_whale_web/lib/api/dto.ts            (176 行) —— snake_case DTO
blue_whale_web/lib/api/endpoints.ts      (112 行) —— 11 个 typed endpoint
blue_whale_web/lib/api/index.ts          ( 14 行) —— 对外入口
```

合计：**816 行 / 22 个新单测**。

## 关键设计决策

**为何放 `lib/api/`（顶层 lib）**：与 `lib/jobs.ts`（IJZYVQ）平级,
不归 `app/canvas/_canvas/`。消费方可能是 BottomDock / AgentChatPanel / TopBar / Asset 上传,
都不该依赖画布内部。

**为何 DTO 走 snake_case,不做转换**：PRD §4 明确 snake_case;
骨架是**传输层**—— 转换是 hook 层的事,留在消费方按各自 feature 做,
避免在骨架里预设未发生的形状耦合。

**为何 `userId.ts` catch 后返回新生成 UUID（不是 `""`）**：
`apiFetch` 读 userId 决定是否附 header;若隐私模式下返回 `""` 就**不附**,
但此时业务方会以为有身份,后端 401 兜底又没意义;返回新生成值至少
"有 userId"信号稳定（虽然不持久）。`isValidUuid` 的入参则容忍非法值。

**为何不引 env var**：`baseUrl` 形参已足够测试 + 跨部署;真要切环境再加
`process.env.NEXT_PUBLIC_API_BASE ?? "/api"` 也只 1 行,留 P1 决策。

**为何 `apiFetch` 不在 index re-export**：消费方拿不到原始 fetch
就不会绕过 header/错误处理直接调,统一走 endpoint 函数。
（仍可从 `./lib/api/client` 直接 import,作为"逃逸口"留给特殊场景。）

## 测试结果

- `npx vitest run lib/api` **22/22 passed**（3 test files,新增 22 个）
- `npx vitest run` **101/101 passed**（22 test files,全量回归无破坏）
- `npx next build` ✓ Compiled successfully（3 routes prerender）
- `npx eslint lib/api` **0 errors / 0 warnings**
- `npx tsc --noEmit` —— 本工单文件 0 error;预存在 32 个 `@testing-library/jest-dom` 类型 aug 缺失错误均在 app/* / components/skill/* 测试文件（与本工单无关）

## `/review` 双轴复查

### Standards
- 0 hard violations
- 1 judgement call（已修）：`__resetUserIdForTest` 测试辅助删,改在测试 `beforeEach` 直接 `localStorage.removeItem("bw-user-id")` —— 与 `client.test.ts` 已有的 `localStorage.clear()` 范式对齐,减少模块表面 API
- Layer 一致（lib/api/ 顶层 lib,与 `lib/jobs.ts` 平级,不在 `_canvas/` 下）
- 范式与 `components/auth/authStorage.ts` 镜像（`typeof window` 守卫、try/catch、key 前缀 `bw-`）
- 注释风格与 `lib/jobs.ts` 对齐（JSDoc 顶部 + 边界段 + 中文 + 对齐 PRD §N）
- Surgical changes ✓（仅 `blue_whale_web/lib/api/`,无其它模块触碰）
- 无 console / 无 secret / 无 PII

### Spec
- 0 缺陷
- 全部 PRD §5.1-5.5 endpoint 覆盖
- `X-User-Id` + UUID v4 严格校验
- 错误体归一化 + 兜底 `http_<status>`
- snake_case DTO 1:1 对齐 §5
- 路径参数 URL 编码
- 204 / 非 2xx / 非 JSON 三种边界都有测试
- 0 scope creep（无 SSE 客户端 / 无运行时校验 / 无 snake↔camel 转换 / 无重试缓存队列）

**总评**：ship-ready,等用户确认提交。

## 提交约定

按 IJZYUL README §「新子 issue 流程」：实现 + 本 docs 一起入库。
执行（在 worktree 内）：

```bash
scripts/commit-task-for-review.sh --user-authorized \
  -m "feat(api): IJZYVR API 客户端骨架（client / userId / errors / dto / endpoints）"
```

合并到本地 `master`（用户集成区）：

```bash
cd d:/Project/blue-whale-ai
scripts/merge-task-to-local-master.sh --user-authorized "feature/IJZYVR-API客户端骨架"
```

合并后建议：

1. 父 issue IJZYUL README 更新：进度 6/8,IJZYVR 行加 ✅
2. 按 Gitee 工作流发布审查：`scripts/publish-review-package.sh --user-authorized`
3. 后续接入工单（不属本工单）：
   - IJZYUL 进度归档更新
   - 各业务 feature wire up（BottomDock → startGeneration / TopBar → listProjects / Asset 上传替换 base64）
   - SSE 客户端（agent turn / job stream）

## 状态时间线

| 时间             | 事件                                                                |
| ---------------- | ------------------------------------------------------------------- |
| 2026-07-10 17:30 | `/implement IJZYVR` 触发;worktree 建 + CBM fast 索引就绪            |
| 2026-07-10 17:32 | 9 个文件首批落地（userId / errors / client / dto / endpoints / index + 4 测试）|
| 2026-07-10 17:35 | `npm install` + `vitest run lib/api` 22/22 ✓                        |
| 2026-07-10 17:36 | 全量 `vitest run` 101/101 ✓;`next build` ✓;`tsc --noEmit` 本工单 0 error |
| 2026-07-10 17:40 | 修 4 个 `_url, _init` 未用参数 warning（refactor `stubFetch`）→ 0/0  |
| 2026-07-10 17:42 | `/review` 双轴 sub-agent 并行,5min 内出报告                        |
| 2026-07-10 17:43 | 应用 Standards 反馈：删 `__resetUserIdForTest` + inline removeItem  |
| 2026-07-10 17:43 | 22/22 / 0/0 重跑绿;写本 docs,待用户确认提交                         |

## 备注

- IJZYVQ (ARCH-5 顶层领域类型) 已合,本工单直接消费 `@/types/domain` 形状无需复制
- BottomDock / TopBar / Asset 上传等业务消费方**本工单不接**,只提供骨架;
  避免在 skeleton 阶段就引入 4-5 处跨模块 wiring,后续各 feature issue 各自接
- BACKEND-API-PRD §5.6 Agent 对话 SSE 不在本工单范围,留 AGENT-CONVERSATION-PRD / IJZYVS
- BACKEND-API-PRD §5.8 Skill 面板不属本工单,留 FRONTEND-SKILL-PANEL-PRD
- BACKEND-API-PRD §5.7 P1 节点衍生操作 (refresh / shuffle / paint / light / upscale) 不属 P0
