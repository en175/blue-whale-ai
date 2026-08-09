# 测试验证策略

> 命中完成任务、提交审查、创建/更新 PR、合并前验证时 Must Read。本文是测试选择、凭证复用和发布门禁的单一事实源；Git 状态机仍以 `docs/agents/git-workflow.md` 为准。

## 执行步骤

1. 开发循环只运行正在修改行为的单测、类型检查或手测，不生成发布凭证。
2. 通过 `scripts/commit-task-for-review.sh` 形成干净 HEAD；运行 `node scripts/verify-change-scope.mjs plan` 检查自动分层。
3. 运行 `node scripts/verify-change-scope.mjs run`；代码失败则修复并 amend，基础设施或已知 flaky 才对同一 HEAD 显式重试。
4. 报告完成或发布前运行 `node scripts/verify-change-scope.mjs check --json`；`VERIFIED` 才算完成。

完成标准：凭证状态为 `passed`，且 HEAD、合并基线、changed-files 哈希、输入指纹、验证层级、计划和通过结果均与当前状态一致。

## 验证层级

| 层级 | 适用范围 | 最低验证 |
| --- | --- | --- |
| `docs` | 根规则/上下文、普通 README 及 `docs/**/*.md` | `git diff --check` + Agent 规则结构测试 |
| `scoped/node` | `apps/*/src`、`packages/*/src|test` | 增量 TypeScript build + Vitest `--changed` |
| `scoped/web` | Web app/components/hooks/lib/workers | Web typecheck + Web Vitest `--changed` |
| `scoped/governance` | 本策略、选择器、发布门禁及关联技能 | 规则、选择器和发布门禁定向测试 |
| `full` | 高风险基础设施或未知路径 | 当前影响面的定向检查 + `pnpm verify` |

`full` 是风险层级，不是提交、PR 或合并阶段的默认动作。

## 路径映射

以下任一变化自动升级 `full`：

- 根依赖/锁文件、TypeScript 配置、Dockerfile、`deploy/`；
- 共享契约、数据库 schema/migration；
- 鉴权路径、全栈验收、Playwright 配置；
- Git/Agent Hook 与运行时构建、数据库、验收入口；
- 选择器尚未识别的未知路径，自动升级全量。

本策略文件自身属于 `scoped/governance`；普通 README 属于 `docs`，Agent 技能等可执行 Markdown 不自动降级。

Agent 可用 `--risk high` 主动升级。选择器只接受 `auto` 或 `high`，禁止通过参数、改写凭证或删减命令降级。高风险要求全量时，低层级凭证不得复用；同一影响面的 full 凭证保留定向检查，可覆盖较低层级。

## 凭证复用

`run` 将 JSON 凭证写到 Git common dir 下的 `blue-whale/verification/<HEAD>.json`，权限为仅当前用户可读写，不提交仓库。凭证记录：

- HEAD、merge-base、changed-files 哈希和验证层级；
- 实际命令、每次尝试的退出码与耗时，以及 full 内部分阶段耗时；
- Node/平台/架构、缓存开关和外部输入摘要组成的输入指纹；
- 重试类别、理由和两次尝试（若有）。

同一 HEAD 且基线、影响面、输入指纹未变化时，完成、PR 更新和发布直接复用，不设置任意时间过期。任一绑定字段变化即失效。`scripts/publish-review-package.sh` 在网络推送前硬检查凭证。

PR「测试结果」运行 `node scripts/verify-change-scope.mjs summary` 生成并粘贴；不要粘贴本机绝对路径或整段测试日志。

## 失败与重试

- 代码、类型、断言或业务行为失败：停止发布，修复后 amend，新 HEAD 重新验证。
- 明确的基础设施故障或已知 flaky：首次失败凭证落盘后，可再次运行 `run --retry-kind infrastructure|known-flaky --retry-reason "<具体原因>"`，只重试凭证中的失败命令一次。
- 重试理由必须在看到首次失败后填写；后续若出现另一条命令失败，不沿用旧理由继续重试。
- 凭证保留原失败和一次重试；重试仍失败则状态为 `failed`，发布门禁继续阻断。
- 不得把失败标记为“与本次无关”后跳过，也不得手工编辑凭证改成通过。

## 耗时治理

当前不设固定分钟数。凭证先采集每层命令耗时、full 分阶段耗时、缓存条件和结果；每个层级至少积累 30 次有效运行且分位数趋稳后，再为该层确定 p90 SLO。

SLO 用于发现测试膨胀并推动拆分、缓存或并行，不用于删除风险所需验证。全量入口的重复构建与串行优化属于独立任务。
