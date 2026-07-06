## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

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

- **禁直推 master（最高红线）**：AI（及所有人）**禁止任何** `git push origin master`。所有进 master 的改动统一走 **开分支 → 推分支 → Gitee 建 PR → 服务端合并**。"自审合"只免互审，**不免流程**——自审通过后仍须自己走完分支→PR→合并。合并触发：低风险 PR 可用 Gitee MCP `merge_enterprise_pull` 自审合（秒级，不卡人）；**高风险 PR 禁 AI 用 MCP 合，必须人手动合**。`hotfix/*` 无特权，同样走分支→PR。根因与决策见 [`docs/adr/0003-no-direct-push-to-master.md`](docs/adr/0003-no-direct-push-to-master.md)；hook 兜底见下「远程-本地同步」。
- **合并只用 merge（禁 squash/rebase）**：AI 用 Gitee MCP `merge_enterprise_pull` 时 `merge_method=merge`（或不传，Gitee 默认 merge）。传 `squash`/`rebase` 会被 `.claude/hooks/block-squash-merge.sh` 拦。人在 Gitee 网页手动合并同样选 merge。合并即删源分支：MCP 传 `prune_source_branch=true`，或 Gitee 界面勾「删除源分支」。
- **分支命名遵循强制白名单**：开分支前缀必须是工单分支前缀（hook 强制——不在白名单则 `--force-with-lease` 被拦、落后 `origin/master` 时 push 被拦）。前缀清单、标题格式、生命周期、保护分支规则见 [`docs/agents/branch-naming.md`](docs/agents/branch-naming.md)；决策见 [`docs/adr/0004-branch-naming.md`](docs/adr/0004-branch-naming.md)。
- **禁碰生成物**：`graphify-out/`、`dist/`、`target/`、`.next/`、`__pycache__/`、`node_modules/` 等自动生成的目录/文件，AI 不得改动（改了下次生成即冲突）。
- **远程-本地同步（动 git 前先 fetch）**：执行任何 git 写操作（`checkout -b` / `commit` / `push`）前，必须先 `git fetch origin`，无例外。本仓库多人（含 AI）协作，远程 master 可能有新合并。同步用 `rebase`（不用 merge，保 PR diff 干净）：`git rebase origin/master`。落后的工单分支 push 会被 pre-push hook 拦。rebase 撞冲突 → AI 先解 → 改了前端跑 `npm run lint`（blue_whale_web）/ 改了后端跑 `pytest`（blue_whale_server）→ 解不动 `git rebase --abort`。rebase 后强推用 `git push --force-with-lease`（仅工单分支放行；裸 `--force`、对 `master`/`main` 强推被 AI guardrails 拦）。心智：动手前先同步。**机制兜底（不靠记忆）**：`pre-commit` 软提醒落后、`pre-push` 硬拦落后（铁闸），见 [`docs/adr/0006-sync-mechanism-auto-block.md`](docs/adr/0006-sync-mechanism-auto-block.md)。
- **Commit message 用 Conventional Commits**：`<type>: <描述>`，type 用 `feat` / `fix` / `docs` / `refactor` / `chore`。一次提交只干一件事。`feat`（commit type）与 `feature`（分支前缀）刻意不统一——前者遵 Conventional Commits 标准，后者遵业界分支惯例，详见 [`docs/agents/branch-naming.md`](docs/agents/branch-naming.md)。
- **禁提交**（hook 会挡）：生成物（`graphify-out/`、`dist/`、`target/`、`.next/`、`__pycache__/`、`node_modules/`）、`.claude/settings.local.json`（个人本机配置）、密钥凭证（`.env`、`*.key`、`*.pem`）。（`.claude/` 作为团队协作目录**进仓**：`settings.json` + `hooks/` 共享，仅 `settings.local.json` 个人覆盖不进仓。）

### 命中以下情况 → 必查 `docs/agents/commit-and-review.md`

- **开 PR** → 模板见 `.gitee/PULL_REQUEST_TEMPLATE.md`（Gitee 自动加载），风险等级字段必填。

> Hook 违规时会拦截并在错误信息里指路到该文档。

## Gitee Issue 与 MCP 工具

### Issue tracker

Issues 追踪在 Gitee 仓库的 Issues（远程见 `git remote -v`，本仓库为 `git@gitee.com:hangzhou_xuanfu_1/blue-whale-ai.git`）。Gitee 不在 gh/glab CLI 支持范围内，技能以自由文本工作流记录。详见 `docs/agents/issue-tracker.md`。

- **创建 issue**：`mcp__gitee-ent__create_enterprise_issue`（**必传 `project_id` 关联仓库**，值用 `mcp__gitee-ent__list_enterprise_repositories` 查；不传则工单只出现在企业工作项、仓库 Issues 页看不到，hook `block-issue-without-repo.sh` 硬拦。详见 `docs/agents/issue-tracker.md` 与 ADR-0007）。
- **加/移除标签**：`mcp__gitee-ent__update_enterprise_issue`（`labels` 为逗号分隔标签名；Gitee 标签要求长度 2–20、非特殊字符）。
- **关闭**：`mcp__gitee-ent__update_enterprise_issue`（`state="closed"`）。
- **合并 PR**：`mcp__gitee-ent__merge_enterprise_pull`（`merge_method=merge`、`prune_source_branch=true`）。

### Triage labels

采用五个默认标签名（needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix），与 Gitee 标签一一映射。详见 `docs/agents/triage-labels.md`。
