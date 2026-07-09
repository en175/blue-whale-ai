## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- 在 task worktree 中需要 Graphify 时，先运行 `scripts/ensure-graphify-worktree.sh`；不得使用主 checkout 的 `graphify-out/` 代替当前 worktree 图谱。

## 设计系统 (DESIGN.md)

前端设计系统契约在 `blue_whale_web/DESIGN.md`（`@google/design.md` 格式）。它由两部分组成：YAML front matter 的设计 token（机器可读）+ Markdown 正文的设计理念（人/agent 可读）。

规则:
- 修改 `blue_whale_web/` 下任何 UI（颜色、字体、圆角、间距、组件样式）前，**必须先读 `blue_whale_web/DESIGN.md`**。
- 颜色/字体/圆角/间距一律使用其中定义的 token，**禁止在组件里硬编码 hex/rgba 值**；新增颜色先在 `colors:` 注册，再用 `{colors.xxx}` 在组件里引用。
- 强调色只用 `accent`；状态色只用 `success` / `destructive`；不引入第二个品牌强调色。
- 改完 DESIGN.md 后在 `blue_whale_web/` 运行 `npm run design:lint` 校验（0 errors 才算通过，warnings 可接受）；导出 Tailwind 主题用 `npm run design:export:tw`。
- `npm run design:spec` 依赖补丁 `blue_whale_web/patches/@google+design.md+0.3.0.patch`（npm 包 0.3.0 缺 `dist/spec.md`，由 `postinstall` 跑 `patch-package` 自动补回）。**升级 `@google/design.md` 版本后必须重做补丁**：先 `npm i @google/design.md@latest`，再按需重新下载 spec.md 到 dist/ 并 `npx patch-package @google/design.md`。

## Gitee 工作流（提交与审查）

> 防御顺序：**规范前置 → Hook 兜底**。高频硬约束见下；低频细节（PR 模板、hook 兜底清单）下沉到 [`docs/agents/commit-and-review.md`](docs/agents/commit-and-review.md)，命中时查。

### 高频硬约束（每次都遵守）

- **发布动作必须先获用户授权（最高红线）**：Agent 开发完成子 issue 后的默认终点是**任务验收分支上的未提交 diff + 验证结果汇报**；未经用户明确授权，禁止执行任何发布动作：`git push`、发布分支、创建 PR、合并 PR、创建 release、删除远程源分支。授权使用自然语言即可，但必须明确包含发布/推送/开 PR/合并意图；“继续”“可以”“你处理吧”“完成后走流程”这类泛化许可不算发布授权。**发布审查包**一次授权覆盖“推送当前工单分支 + 创建指向 `master` 的 PR”，不覆盖合并；PR 创建后必须停下来交给开发者审查。发布审查包必须使用唯一入口 `scripts/publish-review-package.sh --user-authorized`：Hook 会在该入口处弹出一次确认，直接 `git push` 会被硬拦；入口推送成功后写入短期发布标记，合法 PR 必须消费该标记且不二次弹窗。**合并 PR**必须另获授权，且仍只能用 merge 方法；Hook 会对合并单独确认。Hook 是兜底，不代替 Agent 主动遵守规则。
- **禁直推 master（最高红线）**：AI（及所有人）**禁止任何** `git push origin master`。所有进 master 的改动统一走 **开分支 → 推分支 → Gitee 建 PR → 服务端合并**。低风险 PR 可在用户明确授权后由 Agent 用 Gitee MCP `merge_enterprise_pull` 合并；**高风险 PR 禁 AI 用 MCP 合，必须人手动合**。`hotfix/*` 无特权，同样走分支→PR。根因与决策见 [`docs/adr/0003-no-direct-push-to-master.md`](docs/adr/0003-no-direct-push-to-master.md)；hook 兜底见下「远程-本地同步」。
- **合并只用 merge（禁 squash/rebase）**：AI 用 Gitee MCP `merge_enterprise_pull` 时 `merge_method=merge`（或不传，Gitee 默认 merge）。传 `squash`/`rebase` 会被 `.claude/hooks/block-squash-merge.sh` 拦。人在 Gitee 网页手动合并同样选 merge。合并即删源分支：**MCP 无 `prune_source_branch` 参数、Gitee merge 默认也不删**（踩坑见 [`docs/agents/hooks/README.md`](docs/agents/hooks/README.md)），Agent 在 PR 合并后回到 task worktree 运行 `scripts/cleanup-task-worktree.sh` 清理，或人在 Gitee 界面勾「删除源分支」。
- **分支命名遵循强制白名单**：开分支前缀必须是工单分支前缀（hook 强制——不在白名单则 `--force-with-lease` 被拦、落后 `origin/master` 时 push 被拦）。前缀清单、标题格式、生命周期、保护分支规则见 [`docs/agents/branch-naming.md`](docs/agents/branch-naming.md)；决策见 [`docs/adr/0004-branch-naming.md`](docs/adr/0004-branch-naming.md)。
- **Agent 写入任务必须用 task worktree**：本地 `master` 是用户本地集成区，允许用户自行开发、commit、整理；Agent 不得把本地 `master` 当任务写入区。改文件前必须在主 checkout 运行 `scripts/start-task-worktree.sh <branch> <worktree-dir>`，task worktree 默认从 `origin/master` 创建，固定在 `../blue-whale-worktrees/`。子 issue 完成后停在任务验收分支的未提交 diff，用户确认后才通过 `scripts/commit-task-for-review.sh --user-authorized -m "<message>"` 提交任务分支，并通过 `scripts/merge-task-to-local-master.sh --user-authorized <branch>` 合入本地 `master`。发布审查包用 `scripts/publish-review-package.sh --user-authorized`；PR 合并后用 `scripts/cleanup-task-worktree.sh`；巡检用 `scripts/list-task-worktrees.sh`。完整流程见 [`docs/agents/worktree-workflow.md`](docs/agents/worktree-workflow.md)，决策见 [`docs/adr/0010-local-master-is-user-integration-zone.md`](docs/adr/0010-local-master-is-user-integration-zone.md)。
- **Codebase Memory MCP 准入**：创建 task worktree 后、代码检索或修改前，必须对该 worktree 执行 Codebase Memory MCP `index_repository(repo_path=<task-worktree>)` 并确认 `index_status=ready`；不得用主 checkout 索引替代任务 worktree 索引。
- **禁碰生成物**：`graphify-out/`、`dist/`、`target/`、`.next/`、`__pycache__/`、`node_modules/` 等自动生成的目录/文件，AI 不得改动（改了下次生成即冲突）。
- **远程-本地同步（发布前先 fetch）**：Agent 创建 task worktree 时脚本会先 `git fetch origin master`，并从 `origin/master` 创建任务分支，不依赖用户本地 `master` 是否 dirty/ahead。工单分支准备发布前必须包含最新 `origin/master`；落后的工单分支 push 会被 pre-push hook 拦。发布包装分支若与 `origin/master` 冲突或测试失败，修复只发生在发布包装分支，不回写用户本地集成区。rebase 撞冲突 → AI 先解 → 改了前端跑 `npm run lint`（blue_whale_web）/ 改了后端跑 `pytest`（blue_whale_server）→ 解不动 `git rebase --abort`。rebase 后强推用 `git push --force-with-lease`（仅工单分支放行；裸 `--force`、对 `master`/`main` 强推被 AI guardrails 拦）。**机制兜底（不靠记忆）**：`pre-commit` 软提醒工单分支落后、`pre-push` 硬拦落后（铁闸），见 [`docs/adr/0006-sync-mechanism-auto-block.md`](docs/adr/0006-sync-mechanism-auto-block.md)。
- **Commit message 用 Conventional Commits**：`<type>: <描述>`，type 用 `feat` / `fix` / `docs` / `refactor` / `chore`。一次提交只干一件事。`feat`（commit type）与 `feature`（分支前缀）刻意不统一——前者遵 Conventional Commits 标准，后者遵业界分支惯例，详见 [`docs/agents/branch-naming.md`](docs/agents/branch-naming.md)。
- **禁提交**（hook 会挡）：生成物（`graphify-out/`、`dist/`、`target/`、`.next/`、`__pycache__/`、`node_modules/`）、`.claude/settings.local.json`（个人本机配置）、密钥凭证（`.env`、`*.key`、`*.pem`）。（`.claude/` 作为团队协作目录**进仓**：`settings.json` + `hooks/` 共享，仅 `settings.local.json` 个人覆盖不进仓。）

### 命中以下情况 → 必查 `docs/agents/commit-and-review.md`

- **开 PR** → 必须已有用户发布授权；PR 目标分支必须是 `master`；模板见 `.gitee/PULL_REQUEST_TEMPLATE.md`（Gitee 自动加载），风险等级字段必填。
- **并行任务 / task worktree 生命周期** → 开工、发布、清理、dirty master SOP 见 `docs/agents/worktree-workflow.md`。

> Hook 违规时会拦截并在错误信息里指路到该文档。

## Gitee Issue 与 MCP 工具

### Issue tracker

Issues 追踪在 Gitee 仓库的 Issues（远程见 `git remote -v`，本仓库为 `git@gitee.com:hangzhou_xuanfu_1/blue-whale-ai.git`）。Gitee 不在 gh/glab CLI 支持范围内，技能以自由文本工作流记录。详见 `docs/agents/issue-tracker.md`。

- **创建 issue**：`mcp__gitee-ent__create_enterprise_issue`（**必传 `project_id` 关联仓库**，值用 `mcp__gitee-ent__list_enterprise_repositories` 查；不传则工单只出现在企业工作项、仓库 Issues 页看不到，hook `block-issue-without-repo.sh` 硬拦。详见 `docs/agents/issue-tracker.md` 与 ADR-0007）。
- **Agent 可执行任务必须仓库可见**：创建子 issue 时必须先读父项，继承父项 `project_id` / `program_id`，并在创建后用 `mcp__gitee-ent__list_enterprise_issues(project_id, search=ident)` 反查；否则 AI Agent 不能稳定从仓库 Issues 拉到任务。详见 `docs/agents/issue-tracker.md` 与 ADR-0008。
- **加/移除标签**：`mcp__gitee-ent__update_enterprise_issue`（`label_ids` 为逗号分隔的**标签数字 ID**，ID 用 `mcp__gitee-ent__list_enterprise_labels` 查；Gitee 标签要求长度 2–20、非特殊字符）。注意：`create_enterprise_issue` 对企业私有仓库的 labels 会静默忽略，需紧跟一次 `update_enterprise_issue` 补 `label_ids`。
- **关闭**：`mcp__gitee-ent__update_enterprise_issue`（`issue_state_id`，**不是 `state`**——该工具无 `state` 入参。先 `mcp__gitee-ent__list_issue_type_states` 查该 issue 工作项类型的合法状态枚举，传「已完成」对应的 id）。
- **合并 PR**：`mcp__gitee-ent__merge_enterprise_pull`（`merge_method=merge`）。**删源分支**：该 MCP 工具**无 `prune_source_branch` 参数**（Gitee REST API 有，但未暴露给此 MCP），且 Gitee merge **默认不删**源分支（实战踩坑见 [`docs/agents/hooks/README.md`](docs/agents/hooks/README.md)）。Agent 在 PR 合并后用 `scripts/cleanup-task-worktree.sh` 清理源分支和 worktree，或人在 Gitee 网页勾「删除源分支」。

### Triage labels

采用五个默认标签名（needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix），与 Gitee 标签一一映射。详见 `docs/agents/triage-labels.md`。
