## 代码理解工具

两套代码理解工具，分工见 `.claude/rules/code-intelligence.md`：

- **codebase-memory-mcp（CBM）= 默认第一站**：结构查询（找定义 / 调用链 / 复杂度 / 影响分析 / 架构全景），常驻零冷启动。
- **graphify = 按需进阶**：可视化 HTML 报告、跨文档导航、自然语言模糊探索。

结构查询不盲 grep/glob，先 CBM（`search_graph` / `trace_path` / `get_architecture`）。改代码后 `graphify update .` 刷新（AST-only，零费用）。

## 路由表：按场景查对应规则文件

| 场景                              | 文件                                                  |
| ------------------------------- | --------------------------------------------------- |
| 代码理解（查结构 / 调用链 / 架构）            | `.claude/rules/code-intelligence.md`                |
| Gitee 工作流（提交/分支/PR/发布/worktree） | `.claude/rules/git-workflow.md`                     |
| Gitee Issue / MCP 工具操作          | `.claude/rules/issue-tracker.md`                    |
| 前端 UI 修改（`blue_whale_web/`）     | `.claude/rules/frontend.md`（路径作用域，改前端文件时自动加载，无需手动查） |
| PR 模板 / Hook 兜底清单 / 低频细节        | `docs/agents/commit-and-review.md`                  |

## 最高红线（摘要，细节见 rules 文件）

1. **禁直推 master** — 全走分支 → PR → merge。`hotfix/*` 无特权。
2. **发布须用户授权** — 未经明确授权禁止 push/PR/merge/release。
3. **合并只用 merge** — 禁 squash/rebase。合并不自动删源分支，事后手动清理。
4. **可写任务先建 task worktree** — 只读调查/审查可直接进行；一旦任务可能写文件或改变 Git 状态，必须先从主 checkout 运行唯一入口：`scripts/start-task-worktree.sh --type <类型> (--issue <工单号>|--no-issue) --summary <6–15字中文简述>`。入口成功前禁止写入。
5. **Worktree 基于同步后的本地 master** — 入口要求主 checkout 位于干净 `master`，先 fetch `origin/master`；远程领先则 fast-forward，本地领先则保留，双方分叉则普通 merge。冲突自动 abort 且不创建 Work Tree；成功后从同步后的精确 SHA 创建中文任务分支。
6. **授权无二次弹框** — 只认当前对话中的人类授权；Agent 自动使用 `--user-authorized` 或一次性凭证（提交入口除外：worktree 工单分支 commit 本地可逆，出现即放行），Hook 只纠偏和硬拦，不返回 ASK。
7. **文档驱动、Hook 兜底** — Agent 优先依据本文件及路由规则主动调用标准入口；Hook 只在检测到绕过、缺授权、缺模式或危险 Git 操作时阻断，禁止让 Hook 自动同步、选择策略或推进正常状态机。

## 写入前自检（每次写操作前强制执行）

**摘要是约束声明，自检是执行机制。** 在调用 Edit、Write 或任何会改变 Git 状态的操作前，必须逐项完成以下检查：

1. **确认当前分支** — 读取当前分支；可写任务必须位于由唯一入口创建的结构化中文工单分支，不得在 `master` / `main` 执行。
2. **确认 Agent 任务区** — 确认已从主 checkout 通过唯一入口 `scripts/start-task-worktree.sh --type <类型> (--issue <工单号>|--no-issue) --summary <6–15字中文简述>` 创建并进入独立 task worktree。
3. **确认目标路径** — 对每个写入目标确认其所属 Work Tree；目标路径不得指向用户本地集成区（master 主检出区）。
4. **确认 Git 写入区域** — 任何会改变 Git 状态的操作只在正确的 Agent 任务区及其工单分支执行。

任一项不满足，尤其可写任务尚未进入工单分支或目标路径指向 master 主检出区，立即停止写入，先通过唯一入口创建并进入任务 Work Tree。自检不得新增审批弹框；Hook 继续只在违规时兜底，不自动同步、选择策略或推进工作流。

## Agent skills

> mattpocock/skills 工程技能的配置锚点。技能运行时读 `docs/agents/` 下三份配置；与上方「路由表」的 `.claude/rules/` 是两套——rules 管 git 工作流硬规则，`docs/agents/` 管 matt 技能运行时配置。

### Issue tracker

硬约束见路由表（`.claude/rules/issue-tracker.md`）；详细手册/迁移 runbook 见 `docs/agents/issue-tracker.md`。外部 PR 非请求面。

### Triage labels

五角色全默认名（needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix）。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文（根 `CONTEXT.md` + `docs/adr/`）。见 `docs/agents/domain.md`。
