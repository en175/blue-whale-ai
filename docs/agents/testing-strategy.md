# 测试验证策略

> 命中完成任务、提交审查、创建/更新 PR、合并前验证时 Must Read。本文是测试选择、凭证复用和发布门禁的单一事实源；Git 状态机仍以 `docs/agents/git-workflow.md` 为准。

## 执行步骤

1. 开发循环只运行正在修改行为的单测、类型检查或手测，不生成发布凭证。
2. 通过 `scripts/commit-task-for-review.sh` 形成干净 HEAD；运行 `node scripts/verify-change-scope.mjs plan` 检查自动分层。
3. 运行 `node scripts/verify-change-scope.mjs run`（默认收口阶段）；代码失败则修复并 amend，基础设施或已知 flaky 才对同一 HEAD 显式重试。
4. 报告完成前运行 `node scripts/verify-change-scope.mjs check --json`；`VERIFIED` 才算完成。
5. 创建或更新 PR 前先运行 `scripts/sync-task-from-origin.sh sync --json`，再运行 `node scripts/verify-change-scope.mjs run --stage pr`；`plan/run --stage pr` 对尚未包含远端目标提交的 HEAD 返回 `PR_TARGET_NOT_SYNCED`，避免按旧任务起点误选大范围验证。发布门禁以 `check --stage pr` 硬校验，缺少覆盖 PR 阶段要求的凭证即阻断推送。

完成标准：凭证状态为 `passed`，且 HEAD、合并基线、changed-files 哈希、输入指纹、验证层级、计划和通过结果均与当前状态一致。

## 验证层级

| 层级 | 适用范围 | 最低验证 |
| --- | --- | --- |
| `docs` | 根规则/上下文、普通 README 及 `docs/**/*.md` | `git diff --check` + Agent 规则结构测试 |
| `scoped/node` | `apps/*/src`、`packages/*/src|test` | 增量 TypeScript build + Vitest `--changed` |
| `scoped/backend` | `backend/apps/*`、`backend/libs/*` 下的 TypeScript（NestJS BFF） | backend typecheck（自带 tsconfig 与 `@lib/*` 别名）+ 根 Vitest 过滤 `backend` `--changed` |
| `scoped/worker-java` | `server/blue-whale-worker/` 下的 Java 源码与构建配置（独立 Maven 工程，不在 pnpm workspace） | `mvn -f server/pom.xml -pl blue-whale-worker -am -q test` |
| `scoped/web` | Web app/components/hooks/lib/workers、`web/src` 下的契约副本 JSON、`web/scripts` 工具脚本 | Web typecheck + Web lint + Web Vitest `--changed` |
| `scoped/governance` | 本策略、选择器、发布门禁及关联技能 | 规则、选择器和发布门禁定向测试 |
| `scoped/control-plane` | Hook、Git、worktree、PR、授权、审计和工程技能校验 | Hook 黑盒测试 + Git/PR/worktree 脚本单测 |
| `scoped/operations` | 探针、隧道、一次性修复和维护工具 | `scripts/tests` 下的脚本单测 |
| `full` | 产品构建、运行时、数据库、部署、整栈验收入口或显式高风险 | 当前影响面的定向检查 + `pnpm verify` |

环境前提：`scoped/worker-java` 与 `full` 档会执行 `mvn -f server/pom.xml -pl blue-whale-worker -am -q test`，要求 PATH 上有 mvn；本机未装 Maven 时经容器执行同一命令（挂 `java/` 聚合根与 ~/.m2 缓存，勿跳过或标记与己无关）：

```bash
docker run --rm -v "$PWD/java":/workspace -w /workspace \
  -v "$HOME/.m2":/root/.m2 maven:3.9-eclipse-temurin-21 \
  mvn -f pom.xml -pl blue-whale-worker -am -q test
```

> ⚠️ **必须挂聚合根 `java/` 并从根跑**：worker 依赖 `server/blue-whale-common`，
> 只挂 `server/blue-whale-worker` 会解析不到模块内依赖（`Could not find artifact com.bluewhale:bluewhale-java-libs`）。

验证分两个阶段：选择器默认**收口阶段（`--stage completion`）**；**PR 阶段（`--stage pr`）**继续按影响面选择验证，不再把所有代码 PR 无条件升级为 `full`。普通 Node/Web、治理、Hook 与工程控制面、运维工具改动保持 `scoped`；只有产品影响路径或显式 `--risk high` 才升级 `full`。纯文档保持 `docs`。

`scripts/` 和其他可执行路径必须显式分类。新增脚本未命中分类时返回 `UNCLASSIFIED_PATH` 并停止，不运行全量，也不静默降级；维护者先补分类和对应定向测试。未知的非可执行路径仍由 PR 阶段兜底策略处理。

## 验收范围（full 的两档）

PR 阶段只有产品影响路径或显式高风险改动进入 `full`，并执行整栈验收（`pnpm verify`）：

- 根依赖/锁文件、TypeScript 配置、Dockerfile、`deploy/`；
- 共享契约、数据库 schema/migration；
- 鉴权路径、全栈验收、Playwright 配置；
- 产品运行时构建、数据库和验收入口。

Git/Agent Hook 不属于产品影响路径，归 `scoped/control-plane`。本策略文件自身属于 `scoped/governance`；普通 README 属于 `docs`。`.agents/skills` 下已知的 Markdown、客户端元数据和工程脚本分别按文档或定向工具分类；未知可执行路径继续失败并要求补分类。

Agent 可用 `--risk high` 主动升级为带验收的全量。选择器只接受 `auto` 或 `high`，禁止通过参数、改写凭证或删减命令降级。低层级凭证不得覆盖高层级要求；带验收的全量凭证可覆盖不带验收的全量要求，反之不成立。

## 凭证复用

`run` 将 JSON 凭证写到 Git common dir 下的 `blue-whale/verification/<HEAD>.json`，权限为仅当前用户可读写，不提交仓库。凭证记录：

- HEAD、merge-base、changed-files 哈希和验证层级；
- 实际命令、每次尝试的退出码与耗时，以及 full 内部分阶段耗时；
- Node/平台/架构、缓存开关和外部输入摘要组成的输入指纹；
- 重试类别、理由和两次尝试（若有）。

同一 HEAD 且基线、影响面、输入指纹未变化时，完成、PR 更新和发布直接复用，不设置任意时间过期。任一绑定字段变化即失效。`scripts/publish-review-package.sh` 在网络推送前按 PR 阶段要求硬检查凭证：收口阶段凭证不满足代码类 PR 的发布要求，需先运行 `run --stage pr`。PR 阶段凭证落盘后覆盖同 HEAD 的收口凭证。验收相关的缓存指纹对 full 两档都采集，保证带验收凭证与不带验收要求的输入指纹可比。

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
