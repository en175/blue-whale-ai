# IJZYVT — [ARCH-8] test: 新增 Playwright 端到端测试

> **工单**：[IJZYVT — Playwright E2E](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IJZYVT)
> **父 issue**：[IJZYUL](./README.md)
> **状态**：✅ 已合并到 master（PR #75，merge commit `f473880`）
> **分支**：`feature/IJZYVT-新增Playwright端到端`
> **commit**：`be9efac`（rebase 后）→ merged as `f473880`
> **PR**：[#75](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/pulls/75)
> **完成日期**：2026-07-13

## 范围

引入 Playwright 端到端测试，覆盖 IJZYUL 父 issue 缺口的 #8 vertical slice：

- **路由兜底 3 spec** —— `error-boundary` / `loading-skeleton` / `not-found`（IJZYVA 当时手动验证的脚本化版）
- **Canvas tracer-bullet 1 spec** —— 失败卡 → 重试 → 终态 `normal` CTA flip（覆盖 IJZYUL 父 README 提到的 Canvas 工作台主流程）
- **error trigger 用 URL query string**（`?e2e_error=1`），不用 env var —— env 方案会让 webServer 全局污染其他 spec
- **auth 绕过**用 `page.addInitScript` 注 `bw-user` 到 localStorage，避开 LoginModal
- **CI 集成仅在本文档规划**，不动 pre-commit；走 `npm run test:e2e` + 未来独立 CI 工单

端到端路径：

1. `blue_whale_web/playwright.config.ts` —— single project (chromium) + `npm run build && npm run start`（**prod 模式**，dev overlay 抢 ErrorBoundary）
2. `blue_whale_web/e2e/_fixtures/auth.ts` —— `seedAuth(page)` 注 `bw-user`
3. `blue_whale_web/e2e/route-fallback/*.spec.ts` —— 3 spec
4. `blue_whale_web/e2e/canvas/canvas-tracer-bullet.spec.ts` —— 1 spec
5. `blue_whale_web/app/page.tsx` —— routing layer（`export default function Home()` 委派 HomeClient）
6. `blue_whale_web/app/_components/home-client.tsx` —— client component，hydration 后 useEffect 读 URL → setState → render 抛错
7. `.gitignore` + `blue_whale_web/.prettierignore` —— 追加 5 个 Playwright 产物路径

## 验收逐条

- [x] `npm install` 成功，`@playwright/test@^1.48.0` 进入 `blue_whale_web/package.json` devDeps
- [x] `npx playwright install chromium` 成功；`npx playwright test` 退出 0，4 spec 全绿（24.6s）
- [x] `cd blue_whale_web && npm run test` 仍 90/90（IJZYWD 合后基准，无回归）
- [x] `cd blue_whale_web && npm run lint` 0 新增 warning（26 个 warning 全在 `TemplateCards.tsx` + `LoginModal.tsx`，baseline 既有，IJZYVT 未触碰）
- [x] `cd blue_whale_web && npm run build` 成功（query string throw 不破 prod bundle，"Compiled successfully in 1895ms"）
- [x] `docs/projects/IJZYUL/README.md` 第 5 行 `5/8 子 issue 完成 / 1 已撤回 / 1 待办`（VT 已移到完成侧）、第 52 行 #8 改为 IJZYVT 行
- [x] `.gitignore` + `.prettierignore` 各追加 5 个 Playwright 输出路径（`test-results/` `playwright-report/` `.playwright/` `blob-report/` `playwright/.cache/`）；**不**改 pre-commit hook
- [x] `blue_whale_web/app/_components/home-client.tsx` 的 useEffect throw 仅影响 `?e2e_error=1` 访问；其他路径零行为变化（4 个 spec 中 3 个不带 query string 跑过验证）

## 改动文件（14 个）

**新文件（8 个）**：

- `blue_whale_web/playwright.config.ts`（~45 行）—— single chromium + webServer (`build && start` prod) + retry 策略
- `blue_whale_web/e2e/_fixtures/auth.ts`（~15 行）—— `seedAuth(page)` addInitScript 注 `bw-user`
- `blue_whale_web/e2e/route-fallback/error-boundary.spec.ts`（~30 行）—— `?e2e_error=1` → `main[role="alert"]`（避开 Next.js announcer div strict mode 撞车）+ 重试 + 返回首页
- `blue_whale_web/e2e/route-fallback/loading-skeleton.spec.ts`（~33 行）—— route 延迟 1500ms → `role=status` + `aria-label="页面加载中"` + ≥7 animate-pulse（用 `toBeAttached` + `toHaveAttribute` 避开 ARIA live region hidden 陷阱）
- `blue_whale_web/e2e/route-fallback/not-found.spec.ts`（~20 行）—— `/canvas/foo-bar-not-exist` → 404 + h1 "页面不存在"
- `blue_whale_web/e2e/canvas/canvas-tracer-bullet.spec.ts`（~44 行）—— seed auth → /canvas → failed 卡 → retry → "手动应用"
- `blue_whale_web/app/_components/home-client.tsx`（~70 行）—— 原 Home 抽出 + useEffect query string throw
- `docs/projects/IJZYUL/IJZYVT.md`（本文档，~150 行）

**修改文件（6 个）**：

- `blue_whale_web/package.json` —— 加 `@playwright/test` devDep + `test:e2e` / `test:e2e:ui` 脚本
- `blue_whale_web/app/page.tsx` —— 改为 routing layer，`export default function Home() { return <HomeClient /> }`
- `blue_whale_web/package-lock.json` —— npm install 自动更新（@playwright/test + transitive）
- `.gitignore` —— 追加 5 个 Playwright 产物路径
- `blue_whale_web/.prettierignore` —— 同上
- `docs/projects/IJZYUL/README.md` —— 第 5 行 + 第 52 行（最小改动）

## 关键设计决策

**为何 query string 不用 env var**：

- `webServer.env.NEXT_PUBLIC_E2E_ERROR=1` 会让 Next.js 编译时把 env 静态替换进 bundle，全局污染：`loading-skeleton.spec.ts` 访问 `/` 时也会 throw，spec 失败。
- query string 方案让 throw 仅在客户端 hydrate 时读 `window.location.search` 判断，spec 显式 `page.goto('/?e2e_error=1')` 才触发，其他 spec 零干扰。
- prod 风险：`?e2e_error=1` 在生产环境不可能出现（无业务入口），query check 是零成本守卫。

**为何 throw 走 useEffect + setState，不用 useState initializer 或顶层条件 throw**：

- **useState initializer 抛错不会触发** —— useState init 只在 mount 时跑一次；hydration 阶段 client 不重跑 init（直接复用 server 提供的 initial state），throw 永不触发，error.tsx 永不渲染。
- **顶层 `if (searchParams) throw` 同理** —— hydration match 阶段不会重跑条件 throw。
- **useEffect + setState 是唯一可靠路径**：hydration commit 完成后 useEffect 跑 → 检查 URL → `setShouldThrow(true)` → 触发 re-render → render 阶段 throw → React ErrorBoundary 100% 捕到 → app/error.tsx 渲染。

**为何 webServer 走 prod (`build && start`)，不是 `next dev`**：

- **Next.js dev mode 强制注入 dev error overlay**，接管 client-side throw，绕开 React ErrorBoundary → app/error.tsx 不渲染（实测 `error-boundary.spec.ts` 在 dev mode 下只看到 `__next-route-announcer__` div，error.tsx 完全不出现）。
- prod mode 是 ErrorBoundary → error.tsx 的标准路径；Playwright 验证 prod 路径与生产一致性高。
- 代价：spec 跑前要 build（~30-60s 一次性，next start ~3s），本机 / CI 都接受。

**为何 error-boundary spec 用 `main[role="alert"]`，不是 `getByRole("alert")`**：

- Next.js 永远在 body 末尾注入 `<div role="alert" aria-live="assertive" id="__next-route-announcer__">`（无障碍路由播报）。
- error.tsx 用 `<main role="alert">`。两个元素都 match `role="alert"` → Playwright strict mode 报错。
- 直接锁 `main[role="alert"]` 精确到 error.tsx 主区，避开 announcer div。

**为何 auth 用 localStorage 不用 UI**：

- `LoginModal` 流程（phone + SMS `1234` + agreement checkbox）单独成 spec 价值不大，与 Canvas tracer-bullet 重复。
- `page.addInitScript` 在每个 navigation 之前注入 `bw-user`，等价于"已登录用户"，Canvas 端到端无 auth 摩擦。
- seed 用户 `{username:'e2e', phone:'13800000000'}` 是占位值，`authStorage.ts:11-28` 校验仅需非空 string，零冲突。

**为何 pre-commit 不跑 Playwright**：

- `docs/agents/pre-commit.md:9-11` 明确 pre-commit 只跑 `lint-staged`（prettier + eslint on changed files）。
- Playwright 启动浏览器 + dev server 慢（>30s/次），阻塞每次 commit 不合理。
- 走 `npm run test:e2e` 脚本 + 未来 CI 集成工单（与 `pre-commit.md:82` 联动计划一致）。

**为何 spec 内 `retries: 1` 仅 Canvas 文件**：

- 路由兜底 3 spec 是静态 SSR 标记，0 异步，0 flake。
- Canvas spec 依赖 800ms `setTimeout`（`AgentChatPanel.tsx:233-235`）+ 400ms inter-message（`AgentChatPanel.tsx:208`），时序窗口紧。
- 5s Playwright timeout + spec 内 `retries: 1`（仅本文件）够稳；全局 retries 会拖慢 route-fallback spec。

**为何 spec 文件名用 `.spec.ts` 不用 `.test.ts`**：

- vitest 配置 `include: ["**/*.test.{ts,tsx}"]`（`vitest.config.ts:13`）会扫到 `e2e/` 下文件，与 Playwright 测试重复跑。
- Playwright 默认 test pattern 是 `*.spec.ts`（`testDir: './e2e'` 默认 `testMatch: /^(.*\.)?(spec|test)\.(ts|js)$/` 实际优先 spec），改用 `.spec.ts` 显式区分。
- vitest 不会跑 `.spec.ts`（不在 include pattern），Playwright 跑 `.spec.ts` + `.test.ts`（默认 testMatch），零冲突。

**为何 app/page.tsx 拆为 routing wrapper + _components/home-client.tsx**：

- 原 `page.tsx` 是 `"use client"`（用 useState），加上 query string throw 后 useState initializer 不重跑 → throw 永不触发。
- 方案 A：整页 server component + client component throw。但 server wrapper 自身不做事，引入额外抽象无价值。
- **方案 B（采用）**：`page.tsx` 是 routing layer（直接 `return <HomeClient />`，无 `"use client"` 标记），`_components/home-client.tsx` 是 `"use client"` 持有所有 useState/useEffect 与 JSX。`page.tsx` 极简（13 行），职责单一。

## 测试结果

- `npx playwright test` —— 4/4 green（24.6s 总耗时，含 webServer prod build ~18s + 4 spec 实跑 ~7s）
  - `not-found.spec.ts` —— 729ms ✅
  - `loading-skeleton.spec.ts` —— 7.0s ✅（route 延迟 1500ms 主导）
  - `canvas-tracer-bullet.spec.ts` —— 875ms ✅
  - `error-boundary.spec.ts` —— 13.8s ✅（首跑编译 + hydration + ErrorBoundary 替换 ~14s，后续应稳定在 ~5s）
- `npm run test` —— 90/90 保持（4.76s；IJZYWD 合后基准）
- `npm run lint` —— 0 新增（26 warning 全 baseline：12 个 `TemplateCards.tsx` `<img>` + 1 个 `LoginModal.tsx` unused var + 13 个其他既有；IJZYVT 未触碰 `TemplateCards.tsx` / `LoginModal.tsx`）
- `npm run build` —— 0 error（"Compiled successfully in 1895ms"，prod bundle 含 `?e2e_error=1` query check，死代码 ~80 字节）

## CI 集成（规划）

> 引用 `docs/agents/pre-commit.md:82`：「后续 CI 工单独立开（参考 ARCH-8 IJZYVT Playwright E2E 的 CI 联动计划）」。

IJZYVT 不实现 CI 集成。**未来 CI 工单的推荐流水线**：

```bash
cd blue_whale_web && npm run lint && npm run test && npm run test:e2e
```

- `npm run lint` —— IJZYVJ 已 ship（prettier + eslint）
- `npm run test` —— vitest（IJZYVQ 加 jobs.test.ts 后 90/90）
- `npm run test:e2e` —— 本工单新增（Playwright）

Playwright 配置已为此预留：

- `reuseExistingServer: !process.env.CI` —— 本地复用 dev server，CI 起 fresh
- `retries: process.env.CI ? 2 : 0` —— CI 跑 2 次重试吸收 flake
- `workers: process.env.CI ? 1 : undefined` —— CI 单 worker 避免资源竞争
- `reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list'` —— CI 出 GitHub Actions 注释 + HTML 报告（artifact）

CI 工单开时按需追加 `playwright.config.ts` 的 `webServer.url: http://localhost:3000` 健康检查等待 + 上传 `playwright-report/` artifact。

## `/review` 双轴复查

- **Standards**：0 hard violations；4 judgement calls（均有 spec 价值支撑）：
  1. error trigger 选 query string 不用 env var —— Simplicity 机会（避免 webServer 污染，零业务侵入）
  2. throw 走 useEffect + setState，不用 useState initializer —— Correctness 必须（init 不重跑，throw 永不触发）
  3. webServer 走 prod (`build && start`)，不用 `next dev` —— Correctness 必须（dev overlay 抢 ErrorBoundary，error.tsx 永不渲染）
  4. Canvas spec 单文件 `retries: 1` —— Reliability 平衡（脆弱文件加 retry，全局 retries 拖慢其他 spec）
- **Spec**：8/8 PASS（验收逐条 8 项全绿），0 scope creep（严守 Scope B：3 route-fallback + 1 canvas，无 visual regression / API E2E / 多浏览器）

## 状态时间线

| 时间                  | 事件                                                          |
| --------------------- | ------------------------------------------------------------- |
| 2026-07-09 17:20      | IJZYVT Gitee issue 创建                                       |
| 2026-07-13 09:22      | Commit `be9efac`（14 files / +550 / -41）+ rebase origin/master（140 commit 无冲突）|
| 2026-07-13 09:22      | Push `feature/IJZYVT-新增Playwright端到端` 到 origin          |
| 2026-07-13 09:27      | PR #75 创建（head `be9efac` → base `master` `ea480ce`）       |
| 2026-07-13 10:46      | Merge PR #75（merge_method=merge）→ origin/master `f473880`   |
| 2026-07-13 10:54      | 本地清理：worktree + local branch + remote tracking ref       |
| 2026-07-13 11:04      | IJZYVT Gitee issue state=closed                               |

## 备注

- IJZYUL 总进度：7/8 已合（VA/VJ/VO/VQ/VR/WD/VT）+ 1 撤回（VK）+ 0 待办 = 8/8 闭环（详见 `IJZYUL/README.md` 进度表）
- `app/page.tsx` 改 13 行（routing wrapper + JSDoc），`app/_components/home-client.tsx` 新建 70 行；其余 5 个 modify 文件都是纯 append（gitignore / prettierignore / package.json scripts & devDeps / README / page.tsx routing）
- pre-commit hook 不动（lint-staged only），Playwright 走 `npm run test:e2e`
- 远程 source branch `feature/IJZYVT-新增Playwright端到端` 由 Gitee 服务端在 PR merge 时自动清理，本地 `git fetch --prune` 后 stale ref 已删
