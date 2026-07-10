# IJZYVA — [ARCH-1] feat: Next.js 路由兜底 UI

> **工单**：[IJZYVA — 新增路由兜底 UI（error / loading / not-found）](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IJZYVA)
> **父 issue**：[IJZYUL](./README.md)
> **状态**：✅ 已合并到 origin/master
> **分支**：`feature/IJZYVA-新增路由兜底UI`
> **commit**：`fb9ea33 feat(app): 新增路由兜底 UI（error/loading/not-found）`
> **PR**：[#35](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/pulls/35)（Banfield → master，merge commit `f6902dc`）
> **完成日期**：2026-07-09

## 范围

为 Next.js App Router 加三条路由级兜底 UI，端到端可验证：

- **错误边界**：任意未捕获异常渲染统一错误页（dev 模式错误堆栈、生产模式友好提示 + 重试按钮），不白屏
- **加载骨架**：`/` 和 `/canvas` 路由切换时显示稳定骨架，不出现内容闪烁
- **404 兜底**：访问 `/canvas/<不存在id>` 等不存在的路由渲染 404 页

## 验收逐条

- [x] `blue_whale_web/app/error.tsx` 存在，使用 Tailwind + DESIGN token（不硬编码颜色/字体）；根布局已包 `<html lang="zh-CN">`，错误页维持中文
- [x] `blue_whale_web/app/loading.tsx` 存在，骨架结构与首页 hero 区域一致（避免内容跳动）
- [x] `blue_whale_web/app/not-found.tsx` 存在，提供返回首页入口
- [x] 手动验证：首页临时 `throw new Error("test")` → 渲染 error.tsx；访问 `/canvas/foo-bar-not-exist` → 渲染 not-found.tsx；Next.js dev 路由切换 → loading.tsx 闪现
- [x] `npm run build` 成功；`npm run lint` 无新增 warning
- [x] 不引入新依赖（如 `next/error` 自带样式即可，不引 react-error-boundary）

## 改动文件

- `blue_whale_web/app/error.tsx` — 错误边界 UI（client component）
- `blue_whale_web/app/loading.tsx` — 加载骨架（server component）
- `blue_whale_web/app/not-found.tsx` — 404 页（server component）
- `blue_whale_web/app/error.test.tsx` — vitest 单测（dev 模式错误堆栈 + 重置回调）
- `blue_whale_web/app/loading.test.tsx` — vitest 单测（骨架渲染）
- `blue_whale_web/app/not-found.test.tsx` — vitest 单测（404 文本 + 返回链接）

## 测试结果

- `npm run build` ✓ Compiled
- `npm run test` 通过（含新增 3 个 .test.tsx）
- `npm run lint` 0 issues

## 备注

- DESIGN.md 颜色 / 字号 / 圆角 token 全部使用 `var(--tc-*)`，无硬编码 hex
- 仅新增 3 个 .tsx + 3 个 .test.tsx，diff 控制在 6 文件，不影响 layout/page 等无关文件
- PR 合并后远程 source branch `feature/IJZYVA-新增路由兜底UI` 已在 origin/master 内，本地 worktree 待 cleanup