## 路由表：按场景 Must Read 对应规则文件

碰对应场景前读取指向的规则，不凭记忆操作。常驻原则保留关键约束，详细流程按需加载，分层依据见 [ADR-0044](docs/adr/0044-rules-progressive-loading.md)。

| 场景 | 必读规则 |
| --- | --- |
| 启动/调试本地服务、连接数据库、接管端口 | `.agents/skills/start-local-services/SKILL.md` + `docs/adr/0064-testsite-db-access-governance.md` |
| 代码理解：查结构、调用链、架构；切换 worktree | `agent-rules/code-discovery.md` |
| 产品技术选型、运行时例外、Python 工具处置 | `agent-rules/product-runtime.md` |
| Git 提交、分支、PR、发布、worktree；当前发布线开工、换期、遗留分支清点 | `docs/agents/git-workflow.md` |
| 多工单单 PR、集成分支、并行子任务合回 | `docs/agents/integration-branch-workflow.md` |
| 任何 Gitee MCP 调用、规格发布与拆单 | `docs/agents/issue-tracker.md` |
| 工单开工、恢复、返工、部署确认、提测、生产验证与收口 | `docs/agents/gitee-workflow-agent.md` |
| 测试验证：任务收口、提交审查、创建/更新 PR、合并前 | `docs/agents/testing-strategy.md` |
| Blue-Whale 账号密码登录：浏览器自动化、本地服务确认、测试站直连 | `agent-rules/app-login.md` |
| 前端产品实现：`web/` 页面、组件、API 客户端、TanStack Query | `agent-rules/frontend-web.md` + `.agents/skills/frontend-delivery/SKILL.md`；缺陷读 `references/bugfix.md`，新服务端状态读写读 `references/request.md` |
| PR 模板、Hook 兜底清单 | `docs/agents/commit-and-review.md` |
| 新建产品文档、产品文档/技能资产归位 | `docs/README.md` |

## 常驻原则

1. 本仓库工单与 PR 全部读写仅使用 Gitee MCP；操作前读取 [渠道规则](agent-rules/gitee-mcp-only.md)。
2. 发布须当前对话中的人类明确授权，涵盖 push、PR、merge、release；Agent 自动使用标准入口和授权凭证，已有授权不二次确认。
3. master 代表生产版本，禁止直推；PR 合并只用 merge，合并后按清理入口处理源分支，`hotfix/*` 无特权。
4. 代码相关任务，包括只读调查、调试和审查，先在当前本地发布线运行 `scripts/sync-release-line.sh --json` 并核对该目录索引；失败即停止报告。写入任务经 `scripts/start-task-worktree.sh --target-branch <master|dev|test|release>` 从 `origin/master` 起步进入独立任务区；PR 目标在开工时声明，所有受保护分支均只接受 PR 合入。改动工具链、hook 或规范时目标写 `master`，让后续新分支一并继承。
5. Agent 按文档主动调用标准入口；Hook 只纠偏或阻断，不返回 ASK，不自动同步、选择策略或推进任务状态。
6. 同一契约章节的基础设施工单先合入目标环境分支，功能工单再开工；跨进程字段先在契约文档确定。
7. 产品采用 TypeScript、Next.js Web、NestJS API 与 Node.js LTS；已批准的两个 Java 服务和专用计算边界见技术栈规则。工程工具不受产品语言禁令，无关 Python 存量不阻塞功能任务。
8. 收口与发布前按测试策略取得当前有效凭证；带工单任务主动按 Agent 工作流手册核对事件与验收证据后流转。
9. Agent 在编程实施过程中禁止新增普通代码注释；仅保留必要的工具指令和许可证声明。编程或审查前读取 [注释规则](agent-rules/code-comments.md)。

## Gitee ID 兜底常量

本仓日常使用以下 ID；疑似变更或 401 时按 issue-tracker「ID 解析约定」核对。

| ID | 值 | 含义 |
| --- | --- | --- |
| `enterprise_id` | `16660949` | 杭州玄浮科技 |
| `project_id` | `48854568` | blue-whale-ai 仓库 |
| `program_id` | `883843` | Blue-Whale-AI 项目 |

URL 中的 `883843` 是项目路由 `program_id`，不能充当 `enterprise_id` 或 `project_id`。

## 写入前自检

调用 Edit、Write 或任何改变 Git 状态的操作前，逐项核对：

1. 当前分支与工作目录是从当前发布线经开工入口建立的独立任务区及结构化中文工单分支。
2. 每个写入目标所属 Work Tree 都是该任务区，不指向 master、main 或 release 检出区。
3. Git 状态变更仅在该任务区及工单分支执行；任一项不满足，先停止写入并通过同步、开工入口纠正。

## 任务状态（摘要，全文见 `docs/agents/issue-tracker.md`）

适用 PRD 评审通过并有产品确认后，开发自行拆分并创建子任务，关联业务父需求、明确负责人及提测计划后按授权执行；已有任务接手时才使用认领／交接，避免重复创建；提交、开 PR、合并 PR 均不自动完成工单。实际部署测试后提测，测试及发布前验收通过后待发布；生产验证和测试、产品共同验收均通过才可已上线。子任务交付不自动完成父需求。只读及 `--no-issue` 任务不自动改工单；状态写入前查当前类型的合法状态并回读验证。

## 写入前自检（每次写操作前强制执行）

**摘要是约束声明，自检是执行机制。** 在调用 Edit、Write 或任何会改变 Git 状态的操作前，必须逐项完成以下检查：

1. **确认当前分支** — 读取当前分支；可写任务必须位于由开工入口创建的结构化中文工单分支，不得在 `master` / `main` 执行（**散文文档例外见本节末 [ADR-0025](docs/adr/0025-doc-on-master-allowlist.md)**）。
2. **确认 Agent 任务区** — 确认已从主 checkout 通过开工入口创建并进入独立 task worktree。
3. **确认目标路径** — 对每个写入目标确认其所属 Work Tree；目标路径不得指向用户本地集成区（master 主检出区）。
4. **确认 Git 写入区域** — 任何会改变 Git 状态的操作只在正确的 Agent 任务区及其工单分支执行。

任一项不满足，尤其可写任务尚未进入工单分支或目标路径指向 master 主检出区，立即停止写入，先通过开工入口创建并进入任务 Work Tree。

**例外（[ADR-0025](docs/adr/0025-doc-on-master-allowlist.md)）**：若写入目标仅是散文规格文档（根 `CONTEXT.md` + `docs/**/*.md`），不适用上述 worktree 自检——AI 可在本地 master 直改，落盘走 `scripts/commit-spec-on-master.sh -m "<描述>"`。`.claude/`（规则源）、代码、`docs/**/*.json` 契约仍适用自检。

**本地个人配置例外（[ADR-0010](docs/adr/0010-local-master-is-user-integration-zone.md)）**：根 `CLAUDE.local.md` 与 `.codex/config.toml` 仅在 `git check-ignore` 明确命中时不适用上述 worktree 自检。Agent 必须保持文件未跟踪、不得输出其中凭证；路径不精确、未被忽略或属于其他本地文件时仍按普通写入任务处理。

## Agent skills

技能配置入口如下，使用对应技能前读取配置。

### Issue tracker

见 `docs/agents/issue-tracker.md`。

### Triage labels

见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文（根 `CONTEXT.md` + `docs/adr/`）。见 `docs/agents/domain.md`。

<!-- BLUEWHALE_SOP_ENTRY:START -->
## 蓝鲸产研协作 SOP

涉及需求、开发、测试、缺陷或交付时，先读 [蓝鲸产研协作规则](docs/agents/bluewhale-product-sop.md)，规范来源为 [IKP5VB](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/table?issue=IKP5VB)。执行前核对适用 PRD 及产品评审确认、业务父需求、目标版本和当前操作授权。原有技术、安全、代码审查及发布设定继续保留。
<!-- BLUEWHALE_SOP_ENTRY:END -->

同步版本、已处理差异和本仓保留设定见 [同步记录](docs/agents/bluewhale-product-sop.sync.json)。
