---
paths:
  - "blue_whale_web/**"
---

# 前端设计系统

设计系统契约在 `blue_whale_web/DESIGN.md`（`@google/design.md` 格式）：YAML front matter 设计 token（机器可读）+ Markdown 设计理念（人/agent 可读）。

## 规则

### 代码规模与复杂度（IK747Z-1，2026-08-07 起硬性）

- **文件 ≤800 行**（eslint `max-lines` error 级，CI 构建拦截；超限直接构建失败）。
- **函数 ≤80 行 / 圈复杂度 ≤15 / 参数 ≤5 / 嵌套 ≤4**（eslint warning 级渐进约束，拆分存量后升 error）。
- 新功能开工前先确认落点文件行数：目标文件已 >600 行，先拆再改，禁止继续膨胀。
- 历史巨型文件豁免清单在 `blue_whale_web/eslint.config.mjs` 的 `LEGACY_LARGE_FILES`（IK747Z-3/-4 拆分后必须逐个移除豁免）。
- 测试文件同样 ≤800 行；测试超标 = 被测对象接口面太大，先拆实现再拆测试。

### 架构与分层

- 分层单向依赖：页面/组件 → hooks → lib（纯函数/领域逻辑）→ packages（契约/数据）。禁止组件直接 import `app/api/` 路由、禁止 `lib/` 反向引组件。
- 浏览器端（"use client"）禁止 import server-only 模块（`node:*` 依赖）；server-only 代码必须走包子路径导出（如 `@blue-whale/core/placement`），不进主 barrel。
- 跨组件共享状态用 Zustand store；单组件用 useState；URL 状态用 searchParams（对齐 ADR-0022）。

### 设计系统

- 修改 `blue_whale_web/` 下任何 UI（颜色、字体、圆角、间距、组件样式）前，**必须先读 `blue_whale_web/DESIGN.md`**。
- 颜色/字体/圆角/间距一律使用其中定义的 token，**禁止在组件里硬编码 hex/rgba 值**。新增颜色先在 `colors:` 注册，再用 `{colors.xxx}` 引用。
- 强调色只用 `accent`；状态色只用 `success` / `destructive`；不引入第二个品牌强调色。
- 改完 DESIGN.md 后在 `blue_whale_web/` 运行 `npm run design:lint` 校验（0 errors 通过，warnings 可接受）。
- 导出 Tailwind 主题：`npm run design:export:tw`。

## 补丁注意

`pnpm --filter blue_whale design:spec` 依赖 `blue_whale_web/patches/@google+design.md+0.3.0.patch`（npm 包 0.3.0 缺 `dist/spec.md`，根 `pnpm-workspace.yaml` 的 `patchedDependencies` 会在安装时补回）。**升级 `@google/design.md` 版本后必须重做补丁**：运行 `pnpm patch @google/design.md@<version>`，在临时目录补入 `dist/spec.md`，再运行 `pnpm patch-commit <临时目录>`。
