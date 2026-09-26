# Agent 任务区与用户本地集成区工作流

> 本文是 Agent 写入任务隔离、本地验收合入、发布包装分支的单一权威源。命中：准备改代码、完成子 issue、合入用户本地 master、发布 PR、PR 合并后清理、巡检遗留 worktree。

## 原则

- 本地 `master` 是**用户本地集成区**：用户可以在这里开发、commit、整理或集成本地改动。
- Agent 不得把本地 `master` 当任务写入区；Agent 可写任务必须先创建独立 task worktree 和工单分支（散文文档同样如此，见下条）。
- **散文文档（[ADR-0025](../adr/0025-doc-on-master-allowlist.md) 修正一）**：根 `CONTEXT.md` + `docs/**/*.md` 曾可在本地 master 直改并由 `commit-spec-on-master.sh` 落盘，该直提通道 **2026-09-10 已废止**（与「PR 审合前不合入 master」红线冲突）；现与代码同路，走 `--type docs` task worktree → `commit-task-for-review.sh` → 授权后 `publish-review-package.sh --user-authorized --create-pr`。`.claude/`（规则源）、代码、`docs/**/*.json` 契约一如此路。
- **本地个人配置例外（[ADR-0010](../adr/0010-local-master-is-user-integration-zone.md)）**：仅根 `CLAUDE.local.md` 与 `.codex/config.toml` 在 Git 明确认定为 ignored 时可在本地 master 直改。两者保持未跟踪且不得提交；其他 ignored 文件仍不放行。
- 所有 task worktree 固定放在主仓同级目录：`../blue-whale-worktrees/`。
- 一个 task worktree 只承载一个任务分支，用完即清理。
- task worktree 基于同步后的本地 `master` 精确 SHA 创建，以同时保留个人本地更新和最新远程更新。
- 只读调查、研究、设计和审查不需要 task worktree；任务一旦可能写入仓库内容或改变 Git 状态，必须先执行本流程。

## 开工

在主 checkout 执行：

```bash
scripts/start-task-worktree.sh --type <类型> (--issue <工单号>|--no-issue) --summary <中文简述>
```

示例：

```bash
scripts/start-task-worktree.sh --type docs --no-issue --summary 补全工作树使用规范
```

脚本会：

- 校验当前是主 checkout 的干净 `master`，且没有 merge/rebase/cherry-pick/revert 正在进行；不满足时停止，不自动 abort、stash 或清理
- 校验并生成白名单前缀 + 结构化中文分支名
- `git fetch origin master`
- 本地已包含远程时保留本地 HEAD；本地落后时 `--ff-only`；分叉时普通 merge
- merge 冲突时自动 `git merge --abort`，不创建分支或 Work Tree
- 记录同步后的精确 `master` SHA，并从该 SHA 创建 task worktree

脚本生成 Work Tree 目录名，Agent 不需要设计路径。macOS/Linux/Git Bash 可使用 `.sh` 薄包装；Windows PowerShell/CMD 使用 `py -3 scripts/start-task-worktree.py ...`。两者运行同一个 Python 标准库实现。

### Windows（Git Bash）手动验证

`.sh` wrapper 在 Git Bash 下探测 Python 3 的顺序为 `python3`（命中 Microsoft Store 桩则跳过）→ `py -3` → 报错引导。CI 矩阵不覆盖 Windows，以下步骤需在 Windows 手动执行并记录结果。

前置：已装真正的 Python 3（python.org 安装包或 Microsoft Store 正式版），`py` launcher 随安装可用；Git Bash（Git for Windows 自带）。

1. 确认 `py -3` 可用、未被 Store 桩遮蔽：

   ```bash
   py -3 --version
   ```

   预期打印 `Python 3.x.x`。若报「Python was not found」，说明 Store 的 `python3` 应用执行别名在 PATH 最前，需在「设置 → 应用 → 高级应用设置 → 应用执行别名」关闭 `python3`/`python`，或保证 `py -3` 在 PATH 中早于 `WindowsApps`。

2. 在主 checkout（Git Bash）运行开工入口，验证结构化中文分支生成：

   ```bash
   bash scripts/start-task-worktree.sh --type chore --no-issue --summary 补全工作树使用规范
   ```

   预期退出码 0，stdout 含「已创建中文任务分支：chore/补全工作树使用规范」与 Work Tree 路径。

3. 验证 UTF-8 中文分支名往返：

   ```bash
   git -C <Work-Tree-路径> branch --show-current
   ```

   预期正确打印 `chore/补全工作树使用规范`，中文无乱码；随后推送时 pre-push 接受该中文名（pre-push 拒绝/接受的逻辑由 `scripts/tests/test_start_task_worktree.py` 黑盒覆盖，Windows 侧只需确认中文名不被 Git Bash 编码损坏）。

4.（可选）验证 Store 桩检测：临时把 `WindowsApps` 放到 PATH 最前再跑步骤 2，预期 wrapper 跳过桩、改走 `py -3` 成功；临时移除 `py` 后再跑，预期非零退出且 stderr 含「Microsoft Store 桩」引导。

每次 Windows 环境的 Python/Git Bash 升级或开工入口改动后，执行人在此记录通过结果（日期 + Python 版本 + Git Bash 版本）。

## 用户本地集成区

本地 `master` 由用户控制。Agent 不自动 stash、清理、rebase 或发布。开工入口只在主 checkout 干净时同步：保留本地 ahead 提交，并融合 `origin/master`；dirty 或合并冲突都会停止并保留原状态。

只有进入“合入任务验收分支”动作前，本地 `master` 必须是干净工作区；若不干净，Agent 只报告 `git status --short`，等待用户决定。

## Codebase Memory MCP

首次只读探索即执行 [仓库代码探索协议](../../agent-rules/code-discovery.md)，无需等待创建分支。
创建 task worktree 后重新确认当前目录对应的独立索引；建索引不替代查询。失败、覆盖不足及子代理交接均按同一协议处理。

## Graphify

Graphify 是按需强制，不是所有任务的启动门槛。

当任务涉及架构分析、跨文件关系、代码库导航，或 Agent 准备使用 `graphify query/path/explain` 时，必须先在当前 task worktree 内执行：

```bash
scripts/ensure-graphify-worktree.sh
```

禁止用主 checkout 的 `graphify-out/` 替代 task worktree 图谱。

## 子 issue 完成

Agent 完成子 issue 后直接走提交入口落盘 commit（无需用户先确认/授权），停在 commit 等 review。默认交付：

- 子 issue 的一个 commit（稳定可 review、可 revert 的检查点）
- 验证结果
- 用户 review / 微调入口

用户 review commit 后发现问题，Agent 修订完走提交入口 `--amend` 模式覆盖最后 commit，维持「一个子 issue 一个 commit」粒度：

```bash
scripts/commit-task-for-review.sh --amend              # 默认保留原 commit message
scripts/commit-task-for-review.sh --amend -m "<new>"   # 覆盖 commit message
```

`--amend` 仅在该分支已有自己的 commit 后可用（还没有时 amend 会改写 worktree 基线，被入口拒绝）。worktree 验收分支 publish 前不 push，amend 改写历史安全。

一个工单分支可以提交多次。父需求下的子项各落一个 commit 是既定流程（一个父工单一个 worktree），入口不再限制提交次数——早期版本用一个标记文件把「一个分支只能提交一次」钉死，逼得每个子项另开 worktree，与流程本身冲突。`--amend` 的用途仍然只有一个：修订**最后**那个 commit。

Agent 不自动合入本地 `master`、不自动推送、不自动开 PR。

## 合入用户本地集成区（legacy）

> **本节已废止为默认步骤（2026-09-09 发布分支流程）**：PR 审合前不合入 master，本地集成区同理不提前吃未审代码——用户确认 commit 后直接推送 + 提 PR，本地 `master` 在服务端合并后由开工入口同步获得。`merge-task-to-local-master.sh` 仅作为用户显式本地整合需求的 legacy 通道保留（机制如下），彻底下线另行治理工单。

用户显式要求本地合入时（若 review 发现问题，Agent 先走 `scripts/commit-task-for-review.sh --amend` 修订最后 commit 再确认），Agent 可以在明确确认下执行；用户也可以手动合入。Agent 执行时：

1. 确认本地 `master` 工作区干净；不干净则报告状态并停止。
2. 切回本地 `master`。
3. 合入任务分支，保留子 issue 边界：

```bash
scripts/merge-task-to-local-master.sh --user-authorized <任务分支>
```

4. 如有 merge conflict，Agent 可在本次合入授权范围内解决并运行验证；解决并暂存后，通过标准入口续接 merge commit：

```bash
scripts/merge-task-to-local-master.sh --user-authorized --continue <任务分支>
```

续接入口会校验 `MERGE_HEAD` 属于指定任务分支且不存在未解决冲突。完成后停在本地 `master` 汇报结果，不继续远程发布。

若冲突期间任务分支已通过 `--amend` 更新，先撤销旧合入，再重新运行第 3 步合入最新提交：

```bash
scripts/merge-task-to-local-master.sh --user-authorized --abort <任务分支>
```

ZCode / Claude Code / Codex Hook 放行任务分支的普通 `git commit` 与 `git merge`；仍硬拦任务分支用 merge/pull 同步 `origin/master`，以及缺少 `--user-authorized` 的合入本地 master 入口。提交入口是推荐的 review 检查点，合入入口带授权参数无交互放行。master 写入 Gate 仅额外放行已忽略的根 `CLAUDE.local.md` 与 `.codex/config.toml`。Codex 写入仍由 `Edit|Write` matcher 接入，但实际 `tool_name=apply_patch`、补丁位于 `tool_input.command`；薄 wrapper 只提取目标路径，分支与工作树判定继续复用 `block-master-edit.sh` 权威 Gate。

三端阻断等价只比较阻断型 `PreToolUse` / `PostToolUse`。提醒型 `Grep|Glob` 只注入代码发现 context、不阻断，按客户端实际事件与能力适配；`SessionStart` 只在会话启动/恢复时注入 context，不是工具调用 Gate，各平台生命周期挂载也不同，因此两类事件显式排除。

## 发布包装 Work Tree

多个子 issue 可先合入用户本地 `master`。用户决定发布时，仍通过同一个开工入口从同步后的本地 `master` 创建结构化中文发布包装 Work Tree：

```bash
scripts/start-task-worktree.sh --type feature --no-issue --summary 发布模块版本更新
```

发布包装分支负责适配远程 `origin/master`。若同步冲突，入口 abort 且不创建；创建后的测试或发布修复只发生在该 Work Tree，不回写用户本地 `master`。

PR 合并后在该 Work Tree 运行 `scripts/cleanup-task-worktree.sh`，与普通任务使用同一清理流程。

策略升级前已经存在的主 checkout 发布包装分支不要求迁移；其合并后仍使用旧清理入口收尾，但不得再以这种形态创建新分支：

```bash
scripts/cleanup-release-branch.sh --user-authorized <发布包装分支>
```

> 发布批次分支（`release/YYYY.MM.DD_*`，见 `git-workflow.md`「发布分支（Release）流程」）合入 master 后的清理同走本入口——其白名单已含 `release/*`；批次创建走 `scripts/manage-release-branch.sh create`。

## 发布前同步

模型应先依据本节主动检查分支与 `origin/master`，Hook 只在误走直接 merge/push 时兜底。任务/发布包装分支落后时运行：

```bash
scripts/sync-task-from-origin.sh sync --json
```

入口固定 rebase，不自动 fallback 到 merge；它在 worktree 私有 git dir 建立恢复文件和 backup ref。核心状态：

- `UP_TO_DATE`：无需同步，HEAD 未改写；
- `SYNCED`：rebase 与 `git diff --check` 完成，随后由 Agent 运行范围化测试；
- `REBASE_CONFLICT_ABORTED`：已自动 abort 并恢复同步前 HEAD。Agent 根据输出的 commit、冲突文件和三方 SHA 解释语义差异、给出推荐方案后停止；
- `VERIFICATION_FAILED`：保留恢复点，不得推送。

推送前测试失败时可运行 `scripts/sync-task-from-origin.sh rollback --json`。进入 push 前入口先持久化 fail-closed 状态，之后即使进程中断或状态确认写入失败也禁止自动 rollback。远端核验成功后先运行 `scripts/verify-pr-update.sh ...` 记录核验，再运行 `finalize`。完整事务见 [ADR-0013](../adr/0013-open-pr-update-state-machine.md)。

## 发布审查包双模式

发布入口必须且只能选择一种模式；旧的无模式调用立即拒绝：

```bash
# 首次发布并准备创建 PR
scripts/publish-review-package.sh --user-authorized --create-pr --json

# 首次发布到 release 基线
scripts/publish-review-package.sh --user-authorized --create-pr --target-branch release/prod --json

# 审查修订后更新已有 PR
scripts/publish-review-package.sh --user-authorized --update-pr <PR编号> --pr-snapshot <推送前临时JSON> --json
```

`--user-authorized` 表示 Agent 已从当前对话取得对应的创建或更新授权，ZCode / Claude Code / Codex Hook 静默放行。两种模式都校验结构化任务分支、工作区干净及分支包含最新 PR 目标基线（`origin/master` 或 `origin/release/*`）；不满足时返回 `NEEDS_SYNC`，Agent 使用 `sync --target-branch <目标>` 自动改走对应基线的同步入口一次，不询问 merge/rebase 策略。

- `--create-pr`：目标默认 `master`，可显式选择 `release/*`；推送后写入绑定实际目标的短期发布标记，Agent 按模板创建相同目标的非 draft PR 并停下等待审查。
- `--update-pr`：Agent 先通过 Gitee MCP 读取 PR 并规范化为临时快照（IID、opened、source、target、head、conflict、changed_files、fetched_at）；目标分支由快照决定，入口要求远端同名源分支存在，按实际目标硬校验快照和冻结范围，并使用同步事务捕获的旧 SHA 做显式 `force-with-lease`。合法新增范围逐项使用 `--allow-scope-file <路径>` 声明。
- 推送后校准 PR 描述并重新读取快照，运行 `scripts/verify-pr-update.sh --update-pr <PR编号> --pr-snapshot <推送后临时JSON> --json`。只有返回 `PR_UPDATE_VERIFIED` 后才可 `finalize` 和宣布完成；快照临时文件不进仓，完成后删除。

快照是 Agent 对 Gitee MCP 实时响应的规范化投影，不是人工填写的判断。临时文件必须为 JSON object，权限 `0600`，字段契约如下（`fetched_at` 距调用不得超过 300 秒）：

```json
{
  "pull_request_id": 65,
  "state": "opened",
  "source_branch": "feature/工单-中文简述",
  "target_branch": "master",
  "head_sha": "40位GitSHA",
  "conflict": false,
  "changed_files": ["path/to/file"],
  "fetched_at": 1783872000
}
```

首次创建 PR 前若发生过同步事务，创建成功后同样用新 PR 的 IID 和推送后快照运行 `verify-pr-update.sh`，再 `finalize`；create/update 的远端硬终点一致。

PR 更新授权按本轮意图判断：明确“修复后更新/重新推送 PR”覆盖本轮修订、同步、范围化测试、推送、描述校准和远端核验，不对内部步骤重复询问；只要求“修复”但未表达远端更新时停在本地 commit。

PR 创建后业务范围冻结，只允许本 PR 的 review 修订、测试、文档闭环与同步结果；新工单另开分支。机器校验提交/文件/merge/远端 SHA，Agent 对照 PR、Issue 和 review 反馈审查语义范围。

任务分支可直接 `git push` 保存或协作；创建/更新 PR 必须使用发布入口，保护分支与 `release/*` 的直推仍被 Hook 硬拦。旧脚本 `scripts/publish-task-branch.sh` 已废弃，只会提示选择明确模式。

create 模式的发布标记由创建 PR Hook 在 PreToolUse 校验（`draft` 非 true、`target_branch` 为 `master` 或 `release/*` 且与标记一致、`source_branch` 匹配），PostToolUse 创建成功后消费。创建失败不消耗，可原地重试（见 [ADR-0011](../adr/0011-release-marker-consume-after-pr-success.md)）。update 模式不使用发布标记。

**标记位置契约**：发布标记按来源分支隔离，存于 git common dir（`<repo>/.git/agent-release-review-package-<branch-slug>`，分支名中的 `/` 转义为 `%`）。common dir 对主 checkout 与所有 task worktree 是**同一物理路径**，因此 **ZCode / Claude Code / Codex session 在主 checkout 还是 worktree 启动均对称生效**——标记读写不依赖 session 启动位置。此契约修复了「主 checkout session + cd worktree 跑发布」时建 PR 被误拦的缺陷（标记写在 worktree git path、hook 在主仓 git path 找不到）。

PR 未合并前，本地分支、远程源分支和 task worktree 都保留，以便处理审查反馈；已有 PR 更新统一走 update 模式。

合并 PR 必须在当前对话中另获明确授权。Agent 自动生成绑定企业、仓库和 PR ID 的一次性凭证后调用 MCP；PreToolUse 按 `tool_use_id` 原子占用凭证，避免并发复用，只有 `tool_response.isError=false` 的明确成功 PostToolUse 才消费。失败或畸形结果释放占用并保留凭证。合并成功授权同时覆盖按分支形态执行上述安全清理，不再单独询问。

## PR 合并后清理 task worktree

PR 已经合并进 `origin/master` 后，在该任务的 task worktree 内执行：

```bash
scripts/cleanup-task-worktree.sh
```

脚本会：

- `git fetch origin`
- 确认当前分支已被 `origin/master` 包含
- 确认工作区干净
- 删除远程源分支（如仍存在）
- 删除当前 task worktree
- 删除本地任务分支
- `git fetch --prune`

如果 PR 尚未合并、工作区 dirty、当前路径不在 `../blue-whale-worktrees/`，脚本会失败并停止。脚本不再同步用户本地 `master`；用户自行决定何时把远程 `master` 同步回本地集成区。

## 巡检

在主 checkout 执行：

```bash
scripts/list-task-worktrees.sh
```

它只读报告 `../blue-whale-worktrees/` 下的任务状态，不删除任何东西。

报告分类：

- clean + merged：可进入该 worktree 执行 cleanup。
- dirty：先处理未提交改动。
- not-merged：保留，等待 PR 合并或继续处理审查反馈。
