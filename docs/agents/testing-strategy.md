# 测试验证策略

> 命中完成任务、提交审查、创建/更新 PR、合并前验证时 Must Read。本文是测试选择、凭证复用和发布门禁的单一事实源；Git 状态机仍以 `docs/agents/git-workflow.md` 为准。

## 执行步骤

1. 开发循环只运行正在修改行为的单测、类型检查或手测，可使用 `--changed`，不生成发布凭证。
2. 通过 `scripts/commit-task-for-review.sh` 形成干净 HEAD；按[高风险条件](#验收范围与高风险行为)检查规格和 diff，再按下方命令分支规划验证。
3. 按同一命令分支运行验证。代码失败则修复并 amend；基础设施或已知 flaky 按[失败与重试](#失败与重试)处理。
4. 按同一命令分支检查凭证。取得 `VERIFIED` 并完成[必验行为](#验收范围与高风险行为)和[跳过项检查](#跳过项与完成状态)后，才可报告完成。
5. 创建或更新 PR 前先运行 `scripts/sync-task-from-origin.sh sync --json`。同步后按下方 PR 命令分支验证，取得有效凭证再进入发布入口。`plan/run/ensure --stage pr` 对尚未包含远端目标提交的 HEAD 返回 `PR_TARGET_NOT_SYNCED`。发布门禁以 `check --stage pr` 硬校验，检查失败或凭证失效则阻断推送。

完成标准：凭证状态为 `passed`，且 HEAD、合并基线、changed-files 哈希、输入指纹、验证层级、计划和通过结果均与当前状态一致；本阶段相关必验行为已有有效证据。`VERIFIED` 证明所选命令通过，不单独证明产品行为已验收。

### 命令分支

以下命令均以 `node scripts/verify-change-scope.mjs` 开头。未触及高风险条件时使用普通分支；触及任一高风险条件时使用高风险分支。选择器每次调用独立读取参数，`plan` 只输出计划，不保存风险选择。高风险分支的每次规划、执行、检查、摘要和显式重试均保留 `--risk high`。

| 动作 | 普通分支 | 高风险分支 |
| --- | --- | --- |
| 收口规划 | `plan` | `plan --risk high` |
| 收口执行 | `run` | `run --risk high` |
| 收口检查 | `check --json` | `check --risk high --json` |
| PR 同步后验证 | `plan --stage pr`、`ensure --stage pr`、`check --stage pr --json` | `plan --stage pr --risk high`、`ensure --stage pr --risk high`、`check --stage pr --risk high --json` |
| PR 测试摘要 | `summary --stage pr` | `summary --stage pr --risk high` |

`ensure` 复用覆盖当前计划的凭证，无有效凭证时才执行验证。高风险任务须在发布前显式完成表中的高风险 PR 验证；发布入口自动调用的 `ensure --stage pr` 按路径计算范围，不能代替行为风险判断。

## 验证阶段与交付结论

Agent 在规划时按规格和实际影响面确定阶段，创建或更新 PR 前逐项复核。选择器的 `completion`、`pr` 是工程验证执行时点，均不代表部署后验收。

| 阶段 | 适用环境 | 所需证据 | 执行责任 | 推进条件 |
| --- | --- | --- | --- | --- |
| 发布前工程必验 | 本地任务区、隔离测试库及规格要求的集成环境 | 当前 HEAD、基线、范围、输入和计划匹配的凭证；相关集成、兼容及高风险行为证据 | 实施 Agent 执行并核验；需外部环境时明确协作负责人 | 本阶段必验全部 PASS 后，才可按授权创建或更新 PR；失败、跳过或缺环境时补验或阻断依赖该结果的发布 |
| 任务工程交付 | 当前任务分支及其验证环境；已发布时另核对远端 PR | 可审查提交、有效收口凭证、规格逐项结果；已执行的 PR 操作附 MCP 回读 | 实施 Agent 汇报工程结论，审查人评审；工单流转仍按 issue-tracker 现有规则 | 本轮工程范围完成且发布前工程必验通过，可交付本地结果或按授权推进 PR；不要求先完成实际部署 |
| 部署后验收 | 已部署指定版本的测试站或生产环境 | 部署版本、环境、真实链路或业务场景结果；事故恢复另附实际恢复证据 | 部署执行人提供部署证据，指定测试或业务负责人验收；Agent 仅汇报自己实际执行的检查 | 对应环境的实际证据齐备且验收负责人确认后，才可宣布对应部署或业务验收完成 |

工程交付完成不代表实际部署或业务验收完成。免业务测试任务仍须完成所需工程检查，并记录免测依据和范围；不能以免业务测试跳过工程验证。

每项相关验证在 PR 和工单中记录：阶段、环境及版本、证据或命令、执行责任人、实际结果 `PASS` / `FAIL` / `BLOCKED` / `NOT_RUN`、缺失或跳过原因及下一步。`FAIL` 表示已执行但失败，`BLOCKED` 表示前提不具备，`NOT_RUN` 表示尚未执行。业务验收尚未执行时继续保留 `NOT_RUN`，不从工程凭证推导通过。

发布前工程必验失败、被跳过或缺少所需环境时，普通与草稿 PR 均停止依赖该结果的发布。环境不足时不得将已有发布前工程必验改列为部署后验收；单测和构建不能替代规格要求的真实集成或兼容检查。仅部署后验收未执行时，发布前条件满足且发布授权覆盖即可推进普通 PR，保留该项 `NOT_RUN`。草稿选择按 [Git 工作流](git-workflow.md#pr-草稿条件与回读) 判断。

## 官方技能与仓库适配

`implement` 保持官方技能包 1:1。根 `CLAUDE.md` 路由到测试、Git 与代码探索规则，承载仓库适配。最终测试范围见[验证层级](#验证层级)，技能正文不重复维护仓库要求。

## 验证层级

最终收口和 PR 阶段采用相同标准，运行受影响应用或服务的完整测试集。`scoped` 表示限定应用范围；功能代码收口命令不使用 `--changed` 或 `--passWithNoTests`。共享依赖、跨应用契约或无法界定影响边界的变化，扩展至消费者和对应兼容验收。具体命令由选择器生成，Agent 调查实际接缝，不要求用户逐次指定测试文件。

| 层级 | 适用范围 | 最低验证 |
| --- | --- | --- |
| `docs` | 根规则/上下文、普通 README 及 `docs/**/*.md` | `git diff --check` + Agent 规则结构测试 |
| `scoped/node` | `apps/*/src`、`packages/*/src|test` | 增量 TypeScript build + 所属 Node 应用完整 Vitest |
| `scoped/backend` | `backend/apps/*`、`backend/libs/*` 下的 TypeScript（NestJS BFF） | backend typecheck（自带 tsconfig 与 `@lib/*` 别名）+ 全部 backend Vitest |
| `scoped/worker-java` | `server/blue-whale-worker/` 下的 Java 源码与构建配置（独立 Maven 工程，不在 pnpm workspace） | `mvn -f server/pom.xml -pl blue-whale-worker -am -q test` |
| `scoped/billing-java` | `server/blue-whale-billing/` 下的 Java 源码与构建配置（独立 Maven 工程，不在 pnpm workspace；验证命令与 worker 不同，故单列） | `mvn -f server/pom.xml -pl blue-whale-billing -am -q test` |
| `scoped/web` | 前端源码、静态资源、共享依赖和构建配置，具体范围由选择器判定 | 一次 Web typecheck + Web lint + 全部 Web Vitest + test/release 两次 Vite 打包 |
| `scoped/governance` | 本策略、选择器、发布门禁及关联技能 | 规则、选择器和发布门禁定向测试 |
| `scoped/control-plane` | Hook、Git、worktree、PR、授权、审计和工程技能校验 | Hook 黑盒测试 + Git/PR/worktree 脚本单测 |
| `scoped/operations` | 探针、隧道、一次性修复和维护工具 | `scripts/tests` 下的脚本单测 |
| `full` | 产品构建、运行时、数据库、部署、验收入口或显式高风险 | 受影响应用完整回归 + `pnpm verify`，并补相关必验行为 |

环境前提：计划包含 `worker-java` 时执行 `mvn -f server/pom.xml -pl blue-whale-worker -am -q test`，要求 PATH 上有 mvn；本机未装 Maven 时经容器执行同一命令（挂 `server/` 聚合根与 ~/.m2 缓存，勿跳过或标记与己无关）：

```bash
docker run --rm -v "$PWD/server":/workspace -w /workspace \
  -v "$HOME/.m2":/root/.m2 maven:3.9-eclipse-temurin-21 \
  mvn -f pom.xml -pl blue-whale-worker -am -q test
```

> **必须挂聚合根 `server/` 并从根跑**：worker 依赖 `server/blue-whale-common`，
> 只挂 `server/blue-whale-worker` 会解析不到模块内依赖（`Could not find artifact com.bluewhale:bluewhale-java-libs`）。

选择器默认收口阶段 `--stage completion`，PR 阶段为 `--stage pr`。两阶段中，产品影响路径、未知非可执行范围或显式高风险均升级 `full`，纯文档保持 `docs`。产品影响路径包括根依赖与锁文件、TypeScript 配置、Dockerfile、`deploy/`、共享契约、数据库 schema/migration，以及产品运行时构建与验收入口配置。

Git/Agent Hook 归 `scoped/control-plane`，本策略文件归 `scoped/governance`。`.agents/skills` 下已知的 Markdown、客户端元数据和工程脚本分别按文档或定向工具分类。

`scripts/` 和其他可执行路径必须显式分类。新增脚本未命中分类时返回 `UNCLASSIFIED_PATH` 并停止，不运行全量，也不静默降级；维护者先补分类和对应定向测试。未知的非可执行路径在两阶段均保守升级。

## 验收范围与高风险行为

以下行为变化使用[高风险命令分支](#命令分支)，并补对应的集成或兼容性验收。完整单测不能替代这些必验行为：

| 高风险条件 | 最少确认的行为 |
| --- | --- |
| 鉴权与权限 | 允许与拒绝路径，身份或权限变化后的访问边界 |
| 计费与额度 | 扣费或额度变化、重复调用与失败补偿 |
| 数据库迁移 | 迁移执行与已有数据兼容性，影响的数据读写链路 |
| 跨服务契约 | 实际消费者与生产者对字段及错误语义的兼容性 |
| 队列重试与幂等 | 重复投递、失败重试及迟到结果的副作用边界 |

Agent 从规格、diff 和调用链确定所需接缝、消费者及命令，把这些验收作为本次完成条件。没有环境或不能覆盖真实行为时，报告 `BLOCKED` 或 `NOT_RUN`，保留未验边界，不以单测或构建成功代替。`pnpm verify` 当前只运行根类型检查、构建和 backend 测试，不自动执行全部浏览器或外部服务验收。发布前工程必验行为未完成时，不报告工程交付完成，也不按验证完成继续发布；部署后验收按上方阶段分别报告。

## 跳过项与完成状态

逐项检查本次测试结果中的 skipped、pending、条件跳过及未执行验收。相关必验项被跳过时，报告验证未完成，不能将跳过计为通过。明确无关的平台或环境分支可跳过，但必须记录原因及为何与本次变化无关。没有发现测试、缺依赖、缺生成物或缺环境均不是有效通过结果。

交付证据按必验行为列出测试接缝或命令、实际结果 `PASS` / `FAIL` / `BLOCKED` / `NOT_RUN`、跳过原因和剩余边界。相关性是对规格和影响面的判断，Agent 不能仅按退出码或通过数量作结论；选择器凭证与行为验收证据分别报告。

## 凭证复用

前端相关推送须通过 [前端推送构建门禁](../../agent-rules/frontend-build-push.md)。Agent 主动执行验证，Git pre-push 核验待推送提交，缺少、失败或失效的凭证阻断推送；本地提交不新增打包检查。

`run` 将 JSON 凭证写到 Git common dir 下的 `blue-whale/verification/<HEAD>.json`，权限为仅当前用户可读写，不提交仓库。凭证记录：

定位指针：`$(git rev-parse --git-common-dir)/blue-whale/verification/$(git rev-parse HEAD).json`，JSON 含 `status` 字段；跑长验证后读该凭证文件确认结论，不要依赖管道尾输出或 shell 退出码。

- HEAD、merge-base、changed-files 哈希和验证层级；
- 实际命令、每次尝试的退出码与耗时，以及 full 内部分阶段耗时；
- Node/平台/架构、缓存开关和外部输入摘要组成的输入指纹；
- 重试类别、理由和两次尝试（若有）。

同一 HEAD 且基线、影响面、输入指纹未变化时，完成、PR 更新和发布直接复用，不设置任意时间过期。任一绑定字段变化即失效。`scripts/publish-review-package.sh` 在网络推送前调用 `ensure --stage pr` 自动复用或补跑验证，再硬检查凭证；收口凭证只有覆盖 PR 阶段实际计划时才可复用。当前范围已有失败凭证时，`ensure` 直接阻断，不自动覆盖失败记录或重试。PR 阶段凭证落盘后覆盖同 HEAD 的收口凭证。验收相关的缓存指纹对 full 两档都采集，保证带验收凭证与不带验收要求的输入指纹可比。

选择器只接受 `auto` 或 `high`，禁止通过参数、改写凭证或删减命令降级。低层级凭证不得覆盖高层级要求；带验收的全量凭证可覆盖不带验收的全量要求，反之不成立。

同一计划内也避免重复执行：`full` 的 backend 完整单测由 `pnpm verify` 执行一次，不再先跑一次 backend Vitest。旧凭证若只覆盖 `--changed` 计划，不能用于新的完整回归要求。行为验收证据同样绑定实际提交、基线和环境，代码或相关条件变化后重新验证。

PR「测试结果」按[命令分支](#命令分支)运行 `node scripts/verify-change-scope.mjs summary --stage pr`，高风险任务追加 `--risk high`。粘贴生成的摘要，不粘贴本机绝对路径或整段测试日志。

## 失败与重试

- 代码、类型、断言或业务行为失败：停止发布，修复后 amend，新 HEAD 重新验证。
- 明确的基础设施故障或已知 flaky：首次失败凭证落盘后，在原 `run` 命令上追加 `--retry-kind infrastructure|known-flaky --retry-reason "<具体原因>"`，保留原阶段与风险参数，只重试凭证中的失败命令一次。
- 重试理由必须在看到首次失败后填写；后续若出现另一条命令失败，不沿用旧理由继续重试。
- 凭证保留原失败和一次重试；重试仍失败则状态为 `failed`，发布门禁继续阻断。
- 不得把失败标记为“与本次无关”后跳过，也不得手工编辑凭证改成通过。

## 耗时治理

当前不设固定分钟数。凭证先采集每层命令耗时、full 分阶段耗时、缓存条件和结果；每个层级至少积累 30 次有效运行且分位数趋稳后，再为该层确定 p90 SLO。

SLO 用于发现测试膨胀并推动拆分、缓存或并行，不用于删除风险所需验证。全量入口的重复构建与串行优化属于独立任务。
