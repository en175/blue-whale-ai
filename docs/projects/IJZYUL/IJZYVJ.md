# IJZYVJ — [ARCH-2] chore: prettier + pre-commit 守门

> **工单**：[IJZYVJ — prettier + pre-commit 守门](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IJZYVJ)
> **父 issue**：[IJZYUL](./README.md)
> **状态**：✅ 已合并到 origin/master
> **分支**：`feature/IJZYVJ-补全前端提交守门`
> **commit**：`9c01ccf chore: 加 prettier + lint-staged 前端提交守门`
> **PR**：[#38](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/pulls/38)（KimJohn → master，merge commit `ed30ed3`）
> **完成日期**：2026-07-10
> **Gitee Issue 状态**：⚠️ state=open（PR 已合并，工单需手动 close）

## 范围

补全前端代码风格与提交守门链：

- **Prettier**：装 prettier + `npm run format` / `format:check` 脚本；`.prettierrc` + `.prettierignore`（排除 `node_modules`、`.next`、`graphify-out`、`blue_whale_web/patches`）
- **Pre-commit**：装 husky + lint-staged；`pre-commit` 钩子跑 `eslint --fix` + `prettier --write` 限定 staged 文件
- **Pre-push 钩子共存**：项目根已有 `.githooks/`（Gitee 工作流钩子），新前端 pre-commit 必须与现有钩子并存（不替换、不冲撞）

## 验收逐条

- [x] `npm run format` 自动格式化全仓；`npm run format:check` 校验退出码 0
- [x] 故意提交一个未格式化文件 → pre-commit 拦截并自动修复 → 重 commit 通过
- [x] 故意提交一个有 lint error 的文件 → pre-commit 拦截（不被自动修时给出明确报错信息）
- [x] 不影响 `scripts/gitee-issues.mjs` 等 scripts/ 与 `blue_whale_server/` 后端的现有提交流程
- [x] README 或 `docs/agents/pre-commit.md`（按需新建）记录本地启用方式（`npm run prepare` 或 `husky install`）

## 改动文件

- `package.json`（新增 prettier / husky / lint-staged 依赖 + format / format:check / prepare 脚本）
- `.prettierrc` — prettier 配置
- `.prettierignore` — 排除 node_modules / .next / graphify-out / patches
- `.husky/pre-commit` — pre-commit 钩子（限定 staged 文件跑 eslint --fix + prettier --write）
- `blue_whale_web/.eslintrc.json` 或相关 lint 配置（如需适配 lint-staged）
- `README.md`（按需补本地启用说明）

## 与现有 `.githooks/` 的共存方案

- 项目根 `.githooks/` 由 Gitee 工作流 hook 体系管理（`block-dangerous-git.sh` / `commit-msg-validator.sh` / `pre-push-remote-check.sh` 等）
- 新增的 husky `.husky/pre-commit` 走 husky 自身链，与现有钩子并存：
  - `git commit` → 触发 husky 链 → `.husky/pre-commit`（prettier + eslint staged）
  - 然后原有 git hook 链继续执行（`commit-msg` 等）
- `core.hooksPath` 不动；husky 通过 `npm run prepare` 注入

## 测试结果

- `npm run format` 全仓格式化无报错
- `npm run format:check` 退出码 0
- 手动触发 pre-commit：未格式化文件被自动修复并 re-stage
- 不影响 scripts/ 后端提交流程

## 备注

- prettier 版本：3.x
- husky 版本：9.x（v9 简化了 setup：不再需要 `husky install`，改 `husky` 单条命令）
- lint-staged 版本：17.x
- PR 合并后远程 source branch `feature/IJZYVJ-补全前端提交守门` 已在 origin/master 内，本地 worktree 待 cleanup
- 工单 #IJZYVJ 仍 state=open（PR #38 已合并，工单需手动 close）—— cleanup 阶段一并处理