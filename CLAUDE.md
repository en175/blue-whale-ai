## 代码理解工具

两套代码理解工具，分工见 `.claude/rules/code-intelligence.md`：

- **codebase-memory-mcp（CBM）= 默认第一站**：结构查询（找定义 / 调用链 / 复杂度 / 影响分析 / 架构全景），常驻零冷启动。
- **graphify = 按需进阶**：可视化 HTML 报告、跨文档导航、自然语言模糊探索。

结构查询不盲 grep/glob，先 CBM（`search_graph` / `trace_path` / `get_architecture`）。改代码后 `graphify update .` 刷新（AST-only，零费用）。

## 路由表：按场景查对应规则文件

| 场景 | 文件 |
|------|------|
| 代码理解（查结构 / 调用链 / 架构） | `.claude/rules/code-intelligence.md`（自动加载） |
| Gitee 工作流（提交/分支/PR/发布/worktree） | `.claude/rules/git-workflow.md`（自动加载） |
| Gitee Issue / MCP 工具操作 | `.claude/rules/issue-tracker.md`（自动加载） |
| 前端 UI 修改（`blue_whale_web/`） | `.claude/rules/frontend.md`（路径作用域，改前端文件时自动加载，无需手动查） |
| PR 模板 / Hook 兜底清单 / 低频细节 | `docs/agents/commit-and-review.md` |
| ADR（架构决策记录） | `docs/adr/` |

## Agent skills

> mattpocock/skills 工程技能的配置锚点。技能运行时读 `docs/agents/` 下三份配置；与上方「路由表」的 `.claude/rules/` 是两套——rules 管 git 工作流硬规则，`docs/agents/` 管 matt 技能运行时配置。

### Issue tracker

Issues / PRD 存 Gitee 仓库 Issues，无 `gh`/`glab` CLI，走 Gitee MCP（企业版优先，普通版回退）。见 `docs/agents/issue-tracker.md`。

### Triage labels

五规范角色（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）直映 Gitee 同名标签。见 `docs/agents/triage-labels.md`。

### Domain docs

Single-context：根 `CONTEXT.md` + `docs/adr/`，技能探索前读这俩。见 `docs/agents/domain.md`。

## 最高红线（摘要，细节见 rules 文件）

1. **禁直推 master** — 全走分支 → PR → merge。`hotfix/*` 无特权。
2. **发布须用户授权** — 未经明确授权禁止 push/PR/merge/release。
3. **合并只用 merge** — 禁 squash/rebase。合并不自动删源分支，事后手动清理。
4. **Agent 写入用 task worktree** — 不写本地 `master`。`scripts/start-task-worktree.sh` 开工。
5. **动 git 前先 fetch** — `git fetch origin` 后操作，落后 push 会被 hook 硬拦。
