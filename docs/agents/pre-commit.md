# 提交期守门（pre-commit）现状

> 本文是现状说明。历史版本（`blue_whale_web/` 时代的 prettier + lint-staged 提交期守门）已随前端迁出本仓失效，2026-09-26 按实况重写。

## 提交期唯一守门：`.githooks/pre-commit`

团队共用的发布线同步、任务开工和 PR 发布入口自动配置 `core.hooksPath = .githooks`，无需成员手动初始化；`scripts/setup-hooks.sh` 保留为人工排障入口。pre-commit 本身为纯 shell 零依赖，只做两件事：

1. **硬拦生成物入库**：staged 文件命中 `dist/`、`target/`、`.next/`、`__pycache__/`、`node_modules/` 等模式即拒绝提交（`graphify-out/` 团队图谱产物除外）。
2. **工单分支落后软提醒**：按任务元数据记录的目标 release 比对本机已抓取的 `origin/<目标>`，落后时打印提醒（不执行 fetch，不拦提交）；缺任务元数据时同样只提醒。

lint、typecheck、测试**不在提交期运行**——由 `verify-change-scope` 在收口与 PR 阶段按影响面分层执行（如 scoped/web 档含 web tsc + oxlint + vitest `--changed`），分层口径见 [testing-strategy.md](testing-strategy.md)。

## 手动跑检查

- Web lint：`npm --prefix web run lint`（oxlint）
- 本次改动适用哪个验证层级：`node scripts/verify-change-scope.mjs plan`

## 故障排查

| 现象 | 原因 | 修法 |
|---|---|---|
| pre-commit 报生成物拦截 | staged 区混入构建产物 | `git restore --staged <文件>` 移出 |
| 提示工单分支落后 origin | 本地分支落后已抓取的远端目标 | PR 前运行 `scripts/sync-task-from-origin.sh sync --target-branch <目标> --json` |
| 想绕过守门应急 | 仅紧急情况 | `git commit --no-verify`，并在 commit message 注明原因 |
