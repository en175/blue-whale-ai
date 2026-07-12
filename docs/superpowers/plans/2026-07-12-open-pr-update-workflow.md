# 已有 PR 更新流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为首次发布与已有 PR 审查修订提供文档驱动、可恢复、可核验且不会误建重复 PR 的标准流程。

**Architecture:** 新增事务式同步模块，显式封装 fetch、rebase、恢复点、rollback/finalize 与结构化状态；收紧发布模块为 `--create-pr` / `--update-pr <IID>` 双模式。模型依据 `CLAUDE.md` 路由规则主动编排同步、范围化测试、推送和 Gitee 核验；Hook 只阻断绕过、缺授权或缺模式的违规命令。

**Tech Stack:** Bash 3.2、Python 3 标准库、Git CLI、unittest、现有 Claude/Codex Hook 夹具。

## Global Constraints

- `CLAUDE.md` 与路由规则是正常流程权威；Hook 仅作违规兜底，不自动 rebase、不选择策略、不驱动状态机。
- 任务分支落后 `origin/master` 时唯一默认策略为 rebase；禁止自动 fallback 到 merge。
- 推送或修改 Gitee PR 必须来自当前对话的明确发布/更新授权；本计划不授权远端操作。
- 已有 PR 更新授权覆盖本轮同步、范围化测试、推送、描述校准与远端核验，不对内部步骤重复询问。
- PR 创建后冻结业务范围；结构范围机器硬检查，业务范围由 Agent 对照 PR、Issue 和 review 反馈审查。
- 推送前允许受控本地 rollback；推送成功后禁止自动回滚远端。
- 不新增第三方依赖；脚本兼容 macOS Bash 3.2，并保留 Windows Git Bash 的 Python 3 启动路径。

---

### Task 1: 事务式同步模块

**Files:**
- Create: `scripts/sync-task-from-origin.py`
- Create: `scripts/sync-task-from-origin.sh`
- Create: `scripts/tests/test_sync_task_from_origin.py`

**Interfaces:**
- Consumes: 当前 worktree、当前结构化任务分支、`origin/master`、可选远端同名源分支。
- Produces: `sync`、`rollback`、`finalize` 三个动作；稳定 JSON 状态 `UP_TO_DATE`、`SYNCED`、`REBASE_CONFLICT_ABORTED`、`ROLLED_BACK`、`FINALIZED`；worktree 私有恢复记录和 `refs/agent-sync-backups/<branch-slug>` 恢复 ref。

- [ ] **Step 1: 写同步成功与幂等的失败测试**

  在临时 bare origin + clone 中构造 master 前进、任务分支有本地提交的真实历史，断言尚不存在的入口失败；期望接口为：

  ```bash
  scripts/sync-task-from-origin.sh sync --json
  ```

  成功后必须满足 `origin/master` 是 HEAD 祖先、状态为 `SYNCED`、恢复点记录原 HEAD；再次调用返回 `UP_TO_DATE` 且不改 HEAD。

- [ ] **Step 2: 运行单文件测试确认 RED**

  Run: `python3 scripts/tests/test_sync_task_from_origin.py -v`

  Expected: FAIL，因为同步入口尚不存在。

- [ ] **Step 3: 实现最小同步路径**

  Python 模块使用 `subprocess.run` 调用真实 Git；校验 linked worktree、结构化任务分支、工作区干净和无进行中 Git 操作；fetch 后若落后则创建恢复 ref/JSON 记录并执行 `git rebase origin/master`。Shell wrapper 只负责选择非 Microsoft Store 桩的 `python3`，否则 fallback `py -3`。

- [ ] **Step 4: 运行单文件测试确认 GREEN**

  Run: `python3 scripts/tests/test_sync_task_from_origin.py -v`

  Expected: 同步与幂等用例通过。

- [ ] **Step 5: 写冲突、rollback、finalize 的失败测试**

  构造同文件同一行冲突，断言入口自动 `rebase --abort`、HEAD 恢复、输出包含冲突文件/正在重放 commit/三方 SHA；构造成功 rebase 后的 `rollback --json`，断言用受控 `reset --keep` 恢复原 HEAD；`finalize --json` 删除 marker 与 backup ref。

- [ ] **Step 6: 实现恢复事务并重新跑测试**

  Run: `python3 scripts/tests/test_sync_task_from_origin.py -v`

  Expected: 所有同步事务用例通过，且 `git diff --check` 无错误。

### Task 2: 发布入口显式双模式

**Files:**
- Modify: `scripts/publish-review-package.sh`
- Create: `scripts/pr-update-evidence.py`
- Create: `scripts/sync_recovery.py`
- Create: `scripts/verify-pr-update.sh`
- Create: `scripts/lib/python3-command.sh`
- Create: `scripts/tests/test_publish_review_package.py`
- Modify: `scripts/publish-task-branch.sh`

**Interfaces:**
- Consumes: `--user-authorized` 加且仅加一个模式：`--create-pr` 或 `--update-pr <positive IID>`；update 还必须消费 Agent 通过 Gitee MCP 生成的新鲜规范化 `--pr-snapshot`，合法新增范围逐项传 `--allow-scope-file`。
- Produces: create 模式安全推送并写发布标记、状态 `PUSHED_CREATE_PR`；update 模式 push 前机器核验 PR 身份、状态、远端 head 与冻结范围，使用绑定旧 SHA 的显式 lease，不写创建标记；push 后由 `verify-pr-update.sh` 机器核验硬终点并记录 `verified_head`。进入 push 前恢复事务先持久化 fail-closed 状态。

- [ ] **Step 1: 写参数层和模式差异失败测试**

  覆盖缺模式、双模式、非法 IID、update 远端分支不存在、create/update 标记差异和输出差异。

- [ ] **Step 2: 运行测试确认 RED**

  Run: `python3 scripts/tests/test_publish_review_package.py -v`

  Expected: FAIL，因为旧入口接受无模式且总写创建标记。

- [ ] **Step 3: 实现显式模式与结构化状态**

  保留授权、分支、clean、ancestor 校验；`NEEDS_SYNC` 必须指向 `sync-task-from-origin.sh sync --json`，不得指引直接 merge。update 模式用实际 `ls-remote` SHA 绑定 lease；create 模式写 marker，update 模式主动移除可能残留的同分支 create marker。

- [ ] **Step 4: 运行发布单测确认 GREEN**

  Run: `python3 scripts/tests/test_publish_review_package.py -v`

  Expected: 全部通过。

### Task 3: Hook 仅作双模式违规兜底

**Files:**
- Modify: `.claude/hooks/confirm-release-action.sh`
- Modify: `scripts/test-hooks.sh`

**Interfaces:**
- Consumes: Agent 发出的 Bash 命令。
- Produces: 标准同步入口静默放行；发布入口缺授权、缺模式、双模式或 update 缺 IID 时阻断；合规 create/update 静默放行。Hook 不调用同步脚本、不执行 Git 写操作。

- [ ] **Step 1: 先修改 Hook 黑盒断言并确认 RED**

  Run: `bash scripts/test-hooks.sh`

  Expected: 新的无模式拒绝、双模式拒绝、同步入口放行断言失败。

- [ ] **Step 2: 最小修改 Hook 兜底逻辑**

  在标准发布入口白名单处校验授权与模式；直接 push 提示同时列出 create/update 两种入口；普通 `git merge origin/master` 的错误信息明确同步应走 rebase 同步入口，合入本地 master 才走 merge-task。

- [ ] **Step 3: 运行 Hook 全量测试确认 GREEN**

  Run: `bash scripts/test-hooks.sh`

  Expected: 现有与新增断言全部通过，Claude/Codex shim 一致性通过。

### Task 4: 文档权威与 ADR

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CONTEXT.md`
- Modify: `.claude/rules/git-workflow.md`
- Modify: `docs/agents/worktree-workflow.md`
- Modify: `docs/agents/commit-and-review.md`
- Modify: `docs/agents/hooks/README.md`
- Modify: `docs/adr/0006-sync-mechanism-auto-block.md`
- Create: `docs/adr/0013-open-pr-update-state-machine.md`

**Interfaces:**
- Consumes: 用户确认的最终设计。
- Produces: 正常路径由规则文档明确驱动；新 ADR 定义 create/update 状态机、授权、范围冻结、恢复事务、有限重试、冲突决策包、PR 描述与 Issue 决策归属、远端硬终点；ADR-0006 仅链接显式恢复入口，保持 Hook 不隐式同步。

- [ ] **Step 1: 更新权威规则与术语**

  全部旧的无模式 `publish-review-package.sh --user-authorized` 示例改成明确模式；写明 update 模式推送后必须通过 Gitee MCP 核对 opened/source/head/conflict/diff，并校准 PR 描述。

- [ ] **Step 2: 写 ADR-0013 并自审一致性**

  Run: `rg -n "publish-review-package\.sh --user-authorized(\s|`|$)" CLAUDE.md CONTEXT.md .claude/rules docs scripts`

  Expected: 除迁移说明或测试输入外，不存在无模式正常流程示例。

- [ ] **Step 3: 运行文档/Hook 同源检查**

  Run: `bash scripts/test-hooks.sh`

  Expected: 文档关键字和 Hook 行为断言全部通过。

### Task 5: 陈旧个人操作记忆校准

**Files:**
- Modify outside repo: `~/.claude/projects/-Users-kimjohn-Blue-Whale-AI/memory/gitee-force-push-disabled.md`
- Modify outside repo: `~/.claude/projects/-Users-kimjohn-Blue-Whale-AI/memory/merge-conflict-commit-deadlock.md`
- Modify outside repo: `~/.claude/projects/-Users-kimjohn-Blue-Whale-AI/memory/append-commit-to-open-pr.md`

**Interfaces:**
- Consumes: 当前已验证规则与 PR !64/!65 事实。
- Produces: 明确历史适用条件，删除“所有 rebase 都会卡死”的过宽结论，并指向仓库权威规则；个人 memory 不成为团队规则源。

- [ ] **Step 1: 标记历史条件与当前入口**

  保留旧故障事实，明确当时 Gitee 设置/Hook 版本；当前行为必须以仓库规则、脚本和实时分支保护为准。

- [ ] **Step 2: 检查个人记忆不再建议直接 merge 绕过**

  Run: `rg -n "首次就用 merge|git merge origin/master|无法自动完成" ~/.claude/projects/-Users-kimjohn-Blue-Whale-AI/memory/{gitee-force-push-disabled,merge-conflict-commit-deadlock,append-commit-to-open-pr}.md`

  Expected: 命中只存在于清晰标注的历史/废弃说明中。

### Task 6: 最终验证、提交与双轴审查

**Files:**
- Modify as required by review findings.

**Interfaces:**
- Consumes: Work Tree diff 与本计划。
- Produces: 一个 Conventional Commit；Standards 与 Spec 两轴均无阻塞 finding；fresh-agent 独立复验关键状态机。

- [ ] **Step 1: 运行新鲜全量验证**

  ```bash
  python3 scripts/tests/test_sync_task_from_origin.py -v
  python3 scripts/tests/test_publish_review_package.py -v
  python3 scripts/tests/test_start_task_worktree.py
  bash scripts/test-hooks.sh
  bash -n scripts/sync-task-from-origin.sh scripts/publish-review-package.sh scripts/verify-pr-update.sh scripts/lib/python3-command.sh .claude/hooks/confirm-release-action.sh
  python3 -m py_compile scripts/sync-task-from-origin.py scripts/pr-update-evidence.py scripts/tests/test_sync_task_from_origin.py scripts/tests/test_publish_review_package.py
  git diff --check
  ```

- [ ] **Step 2: 通过标准提交入口提交**

  Run: `scripts/commit-task-for-review.sh -m "feat: 完善已有 PR 安全更新流程"`

- [ ] **Step 3: 以基线 `db77dace4da876f6d0e93c51017346724d3bae02` 做 Standards/Spec 双轴审查**

  两个独立 reviewer 分别对仓库规范与本计划审查；任何 hard finding 或需求缺口都先修复、重新验证、通过 `commit-task-for-review.sh --amend` 更新提交，再重新审查。

- [ ] **Step 4: fresh-agent 独立验收**

  新 Agent 只读取规则和计划，在临时 bare remote 中验证 `NEEDS_SYNC → SYNCED → PUSHED_UPDATE_PR → finalize`，并确认无模式发布被 Hook 拦、合规模式静默放行。

- [ ] **Step 5: 仅在所有证据新鲜且审查通过后报告完成**

  不推送、不创建 PR；报告 commit、测试计数、两轴审查结果、fresh-agent 结果和仍需用户授权的后续动作。
