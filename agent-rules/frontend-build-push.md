# 前端推送构建门禁

## 自动启用

Agent 按团队流程运行 `scripts/sync-release-line.sh` 或 `scripts/start-task-worktree.sh` 时，共享入口自动将当前克隆的 Git Hook 指向 `.githooks`；新任务工作树继承该配置。`scripts/publish-review-package.sh` 在发布前再次自动启用，覆盖同步更新后的已有任务工作树。成员无需手动运行 `scripts/setup-hooks.sh`。

普通 `git pull` 只更新文件；自动启用发生在团队共用的同步、开工或发布入口，适用于使用这些入口的所有编程智能体。

## 本地推送前执行

1. 在待推送分支对应的 task worktree 形成干净提交，并同步任务目标 release。
2. 用户授权发布后，Agent 调用已有的创建或更新 PR 标准入口。入口在 `git push` 前自动执行 `verify-change-scope.mjs ensure --stage pr`，按影响面复用有效凭证或补跑本地检查。前端相关改动执行一次类型检查、lint、受影响单测和 test、release 两次 Vite 打包。
3. 入口再次执行 `check --stage pr`，结果为 `VERIFIED` 后才推送。Agent 按已有 Git 工作流创建或更新 PR。

Agent 可以在发布前主动运行 `node scripts/verify-change-scope.mjs run --stage pr` 提前发现问题；已有有效结果不会在发布时重复构建。同一提交和输入已有失败结果时，自动入口继续阻断；修复产生新提交后重新检查，基础设施重试仍按测试策略显式执行。

`.githooks/pre-push` 逐条核验实际待推送 SHA；与当前 HEAD 不同的引用须在对应工作树验证和推送。Hook 不执行构建、不同步分支。删除普通任务分支和推送 tag 不触发前端构建检查，`master`/`main`/`dev`/`test`/`release` 的直推与删除保护保持生效。

批次管理入口初次创建 release 时，仅允许复用与远端 `origin/master` 完全相同的生产提交。已有 release 更新或包含新代码的 release 创建仍进入构建检查；不含任何前端构建输入的仓库保持原推送行为。

## 触发范围

- 前端源码、静态资源、入口、依赖、环境与构建配置。
- 前端引用的 `backend/libs/contracts/`、`backend/libs/core/`。
- 根及 backend 的依赖与 TypeScript 配置，以及 pnpm 锁文件、workspace 配置、Node 版本和 Docker context 排除配置。

纯文档与无前端影响的 Hook、Git、worktree 和维护工具改动保持原定向验证。

## 凭证与失败

凭证须绑定提交、任务起点、目标分支及远端 SHA、改动范围、实际计划和成功结果。前端输入指纹另记录构建环境文件、相关环境变量和依赖安装记录的摘要，不输出环境变量值。

同一 HEAD 且绑定字段未变时复用凭证。新增提交、目标分支推进、环境配置或依赖安装记录变化后重新验证。任何类型检查或打包失败均阻断，包括 release 基线同样失败的情况；按测试策略修复或申明允许的基础设施重试，不绕过门禁。
