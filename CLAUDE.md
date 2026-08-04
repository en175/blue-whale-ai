## 代码理解工具

两套代码理解工具，分工见 `docs/agents/code-intelligence.md`（渐进式，碰代码理解任务前 Must Read）：

- **codebase-memory-mcp（CBM）= 默认第一站**：结构查询（找定义 / 调用链 / 复杂度 / 影响分析 / 架构全景），常驻零冷启动。
- **graphify = 按需进阶**：可视化 HTML 报告、跨文档导航、自然语言模糊探索。

结构查询不盲 grep/glob，先 CBM（`search_graph` / `trace_path` / `get_architecture`）。改代码后 `graphify update .` 刷新（AST-only，零费用）。

## 路由表：按场景 Must Read 对应规则文件

> **渐进式加载**：本表 + 下方 ID 兜底常量 + 最高红线摘要常驻上下文；规则全文按需读。碰对应场景前 **Must Read** 指向的文件，不凭记忆操作。加载策略与分层决策见 [ADR-0044](docs/adr/0044-rules-progressive-loading.md)。

| 场景（碰这类操作前 Must Read） | 规则文件（加载方式） |
| --- | --- |
| 代码理解（查结构 / 调用链 / 架构） | `docs/agents/code-intelligence.md`（渐进式） |
| Gitee 工作流（提交/分支/PR/发布/worktree） | `docs/agents/git-workflow.md`（渐进式） |
| Gitee Issue / MCP 工具操作 | `.claude/rules/issue-tracker.md`（常驻） |
| 前端 UI 修改（`blue_whale_web/`） | `.claude/rules/frontend.md`（路径作用域，改前端文件时自动加载） |
| PR 模板 / Hook 兜底清单 / 低频细节 | `docs/agents/commit-and-review.md` |
| 文档直改 master（`CONTEXT.md` / `docs` 散文） | `docs/adr/0025-doc-on-master-allowlist.md` + `scripts/commit-spec-on-master.sh` |
| 产品文档/技能资产归位（docs/projects、docs/skills） | `docs/README.md`（渐进式，新建产品文档前读） |

## Gitee ID 兜底常量

本仓固定 ID（长期稳定，模型可直接用；碰到 401 或疑似变更时以 `list` API 为准，校验走 `scripts/gitee-resolve-ids.sh`）：

| ID | 值 | 含义 | 动态查法 |
| --- | --- | --- | --- |
| `enterprise_id` | `16660949` | 杭州玄浮科技 | `list_enterprises` |
| `project_id` | `48854568` | blue-whale-ai 仓库 | `list_enterprise_repositories` |
| `program_id` | `883843` | Blue-Whale-AI 项目 | `list_programs` |

⚠️ URL 里的 `883843` 是 **program_id**（项目路由），**不是** `enterprise_id` / `project_id`——误当后两者传入会触发误导性 401。完整 ID 解析约定见 `.claude/rules/issue-tracker.md`。

⚠️ 所有 `mcp__gitee-ent__*` 写操作：未知/错名参数被**静默忽略**——描述误传 `body` 会建成空描述工单（正确参数名 `description`）。写调用后必须回读验证关键字段已生效，细则见 `.claude/rules/issue-tracker.md`「写操作回读验证」。

## 最高红线（摘要，细节见 rules 文件）

1. **禁直推 master** — 全走分支 → PR → merge。`hotfix/*` 无特权。
2. **发布须用户授权** — 未经明确授权禁止 push/PR/merge/release。
3. **合并只用 merge** — 禁 squash/rebase。合并不自动删源分支，事后手动清理。
4. **可写任务先建 task worktree** — 只读调查/审查可直接进行；一旦任务可能写文件或改变 Git 状态，必须先从主 checkout 运行唯一入口：`scripts/start-task-worktree.sh --type <类型> (--issue <工单号>|--no-issue) --summary <6–15字中文简述>`。入口成功前禁止写入。**散文文档例外（[ADR-0025](docs/adr/0025-doc-on-master-allowlist.md)）**：仅编辑根 `CONTEXT.md` + `docs/**/*.md` 时可直改并用 `scripts/commit-spec-on-master.sh -m "<描述>"` 落盘；规则源、代码和契约仍必须走 worktree。**本地个人配置例外（[ADR-0010](docs/adr/0010-local-master-is-user-integration-zone.md)）**：仅根 `CLAUDE.local.md` 与 `.codex/config.toml` 在 `git check-ignore` 确认已忽略时可直改；不得暂存或提交。其他忽略文件仍必须走 worktree。
5. **Worktree 基于同步后的本地 master** — 入口要求主 checkout 位于干净 `master`，先 fetch `origin/master`；远程领先则 fast-forward，本地领先则保留，双方分叉则普通 merge。冲突自动 abort 且不创建 Work Tree；成功后从同步后的精确 SHA 创建中文任务分支。
6. **授权无二次弹框** — 只认当前对话中的人类授权；Agent 自动使用 `--user-authorized` 或一次性凭证（提交入口除外：worktree 工单分支 commit 本地可逆，出现即放行），Hook 只纠偏和硬拦，不返回 ASK。
7. **文档驱动、Hook 兜底** — Agent 优先依据本文件及路由规则主动调用标准入口；Hook 只在检测到绕过、缺授权、缺模式或危险 Git 操作时阻断，禁止让 Hook 自动同步、选择策略或推进正常状态机。
8. **同族工单串行、契约先行** — 同一契约章节的基础设施先合入，功能工单再开工；跨进程字段先在契约文档定死后实现。细则见 `docs/agents/git-workflow.md`（路由表 Must Read）。
9. **技术栈红线** — 新代码只允许 Node.js/TypeScript 体系（Next.js `blue_whale_web` + `apps/` 下 `product-api`/`agent-worker`/`generation-worker` 与 `packages/`）；`blue_whale_server`（Java）与 `blue_whale_agent_worker`（Python）已退役，禁止写入；`blue_whale_api`（new-api，Go）与 `blue_whale_pay_web`/`blue_whale_pay_server`（支付，Java）已迁出至独立仓库 `blue-whale-api` / `blue-whale-pay`，不在本仓维护。旧目录与旧文档中的 Java/Python 方案不是现行方案，范围以 [ADR-0055](docs/adr/0055-prelaunch-typescript-unification-scope.md) 为准。

## 任务状态机（摘要，全文见 `.claude/rules/issue-tracker.md`）

带 `--issue` 的工单任务，状态随流程自动流转，Agent 主动调 `update_enterprise_issue`，不等人手动改：

| 时机 | 流转 |
| --- | --- |
| worktree 入口成功 | 需求 意向→进行中；任务 待办的→进行中；缺陷 待确认/已确认→修复中 |
| PR 创建成功 | 打 `ready-for-review` 标签 |
| PR 合并成功 | 需求/任务→已完成；缺陷→已修复 + `修复待验证` 标签 |

- **禁设状态**：已验收 / 已拒绝 / 已取消 —— 归人。
- **前置错位**：工单已在进行中或已是终态 → 停止，问人，等指示。
- 变更失败重试一次；仍失败继续主线但汇报置顶标红。`--no-issue` 与只读任务不适用。

## 写入前自检（每次写操作前强制执行）

**摘要是约束声明，自检是执行机制。** 在调用 Edit、Write 或任何会改变 Git 状态的操作前，必须逐项完成以下检查：

1. **确认当前分支** — 读取当前分支；可写任务必须位于由唯一入口创建的结构化中文工单分支，不得在 `master` / `main` 执行（**散文文档例外见本节末 [ADR-0025](docs/adr/0025-doc-on-master-allowlist.md)**）。
2. **确认 Agent 任务区** — 确认已从主 checkout 通过唯一入口 `scripts/start-task-worktree.sh --type <类型> (--issue <工单号>|--no-issue) --summary <6–15字中文简述>` 创建并进入独立 task worktree。
3. **确认目标路径** — 对每个写入目标确认其所属 Work Tree；目标路径不得指向用户本地集成区（master 主检出区）。
4. **确认 Git 写入区域** — 任何会改变 Git 状态的操作只在正确的 Agent 任务区及其工单分支执行。

任一项不满足，尤其可写任务尚未进入工单分支或目标路径指向 master 主检出区，立即停止写入，先通过唯一入口创建并进入任务 Work Tree。自检不得新增审批弹框；Hook 继续只在违规时兜底，不自动同步、选择策略或推进工作流。

**例外（[ADR-0025](docs/adr/0025-doc-on-master-allowlist.md)）**：若写入目标仅是散文规格文档（根 `CONTEXT.md` + `docs/**/*.md`），不适用上述 worktree 自检——AI 可在本地 master 直改，落盘走 `scripts/commit-spec-on-master.sh -m "<描述>"`。`.claude/`（规则源）、代码、`docs/**/*.json` 契约仍适用自检。

**本地个人配置例外（[ADR-0010](docs/adr/0010-local-master-is-user-integration-zone.md)）**：根 `CLAUDE.local.md` 与 `.codex/config.toml` 仅在 `git check-ignore` 明确命中时不适用上述 worktree 自检。Agent 必须保持文件未跟踪、不得输出其中凭证；路径不精确、未被忽略或属于其他本地文件时仍按普通写入任务处理。

## Agent skills

> mattpocock/skills 工程技能的配置锚点。技能运行时读 `docs/agents/` 下三份配置（issue-tracker / triage-labels / domain 手册）；这与路由表里的规则文件是两套——规则文件管项目工作流硬规则（issue-tracker 常驻、git-workflow/code-intelligence 渐进式），本节三份配置管 matt 技能运行时。

### Issue tracker

硬约束见路由表（`.claude/rules/issue-tracker.md`）；详细手册/迁移 runbook 见 `docs/agents/issue-tracker.md`。外部 PR 非请求面。

### Triage labels

五角色全默认名（needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix）。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文（根 `CONTEXT.md` + `docs/adr/`）。见 `docs/agents/domain.md`。
