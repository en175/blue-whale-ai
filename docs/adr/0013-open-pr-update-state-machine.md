# ADR-0013：发布前同步与已有 PR 更新状态机

- **状态**：Accepted
- **日期**：2026-07-12
- **决策者**：JJNNReno（与 Codex 经 `grilling` 决策树共同得出）

## 背景

PR !65 审查修订后，本地源分支落后 `origin/master`。发布入口按 [ADR-0006](0006-sync-mechanism-auto-block.md) 正确阻断，但执行 Agent 把“需要 rebase”扩展成“merge 被 Hook 拦、rebase 也必然冲突”的死锁判断，停在人工策略选择。只读复演确认：Hook 放行 `git rebase origin/master` 与 `git rebase --continue`，同一分支在临时克隆中 rebase 无冲突并从 3 个分支提交收敛为 2 个线性提交；Gitee PR diff 同时已从旧快照的 12 文件收敛为 3 文件。

根因不是缺少 Git 通路，而是正常流程没有明确回答：

1. 阻断后 Agent 如何自动恢复；
2. 首次创建 PR 与更新已有 PR 如何区分；
3. rebase 改写后如何恢复、如何防止覆盖未知远端提交；
4. 什么远端证据才足以宣布“PR 已更新”。

## 总原则

`CLAUDE.md` 及其路由规则驱动模型执行正常流程；标准脚本封装确定性 Git 操作；Hook 仅阻断绕过、缺授权、缺模式和危险 Git 操作。Hook 不自动同步、不选择策略、不推进状态机，合规入口静默放行。

## 决策

### D1. 同步策略固定为 rebase

任务/发布包装分支落后 `origin/master` 时，Agent 主动调用：

```bash
scripts/sync-task-from-origin.sh sync --json
```

入口只在 linked task worktree 的结构化任务分支运行，要求工作区干净且无进行中的 Git 操作。它 fetch 后幂等判断；需要同步时固定执行 rebase，不自动 fallback 到 merge。冲突自动 `rebase --abort` 并输出 `REBASE_CONFLICT_ABORTED`，由 Agent 生成语义冲突决策包后停下。

这不改变 ADR-0006：pre-commit/pre-push/发布入口仍只检测和阻断；同步发生在模型依据规则显式调用的标准入口中，不发生在 Hook 内。

### D2. 同步是可恢复事务

首次 rebase 前，入口在 worktree 私有 git dir 写入权限 `0600` 的 `agent-sync-recovery.json`，并创建 `refs/agent-sync-backups/<branch-slug>`：

- `original_head`：事务开始前 HEAD；
- `upstream_sha`：本轮 `origin/master`；
- `remote_branch_sha`：同步前远端同名源分支 SHA（不存在则为空）；
- `synced_head`：成功 rebase 后 HEAD；
- `pushed_head`：远端推送成功后 HEAD。

同一事务再次同步时保留最初 `original_head` 与 `remote_branch_sha`，只推进 `upstream_sha` / `synced_head`。推送前验证失败可运行：

```bash
scripts/sync-task-from-origin.sh rollback --json
```

rollback 仅在工作区干净、HEAD 未离开事务且尚未进入推送时使用 `git reset --keep` 恢复。进入 push 前先原子持久化 `push_state=in_flight` 与 `pushed_head`；push 返回失败后也只有重新读取远端并证明 SHA 与推送前完全一致时才清除。进程中断、远端已接收但客户端丢失确认、push 成功后的状态确认写入失败或任何不确定结果均 fail closed，禁止自动 rollback。远端核验成功后运行：

```bash
scripts/sync-task-from-origin.sh finalize --json
```

清除恢复文件和 backup ref。推送后若远端异常，保留恢复点并交给用户决定，不自动强推回旧版本。

### D3. 发布入口必须显式双模式

无模式调用立即 fail closed：

```bash
# 首次发布
scripts/publish-review-package.sh --user-authorized --create-pr --json

# 更新已有 PR
scripts/publish-review-package.sh --user-authorized --update-pr <PR编号> --pr-snapshot <推送前临时JSON> --json
```

`--create-pr` 推送分支并写创建 PR 的短期发布标记；`--update-pr` 要求远端同名源分支已存在，并要求 Agent 先通过 Gitee MCP 读取 PR，将 IID、state、source、target、head、conflict、changed_files、fetched_at 规范化为权限受控的临时 JSON。入口硬校验 IID/opened/source/target/head 和冻结文件范围，再使用同步事务捕获的旧 SHA 作为显式 `--force-with-lease=<ref>:<sha>`，不写创建标记、不提示新建 PR。合法 review 修订新增文件必须逐项用 `--allow-scope-file` 明示；语义相关性仍由 Agent 对照 review/Issue 判断。

发布入口仍校验工作区干净及 `origin/master` 是 HEAD 祖先。失败返回 `NEEDS_SYNC` 并指向同步入口；Agent 在已有更新授权范围内自动纠偏一次，不询问同步策略。

### D4. 授权按本轮意图，不按内部步骤

- “创建/推送 PR”授权覆盖首次推送和一次成功的 PR 创建，不覆盖合并。
- “修复后更新/重新推送 PR”授权覆盖本轮本地修订、显式同步、范围化测试、安全推送、PR 描述校准和远端核验；rebase 不二次询问。
- 只说“修复 review 问题”而未表达推送/更新意图时，停在本地 commit。
- 冲突、测试失败、未知远端提交或安全强推失败时，原授权不允许偷偷换成 merge、重建分支或远端回滚。

### D5. PR 创建后冻结业务范围

创建后只允许加入本 PR 的审查修订、测试、文档闭环和与 `origin/master` 的同步结果。新需求或无关工单进入新任务分支。

机器硬检查 PR/源分支/目标分支关系、远端 SHA、祖先关系、新增文件声明、merge commit 与最终 diff；Agent 对照 PR 描述、关联 Issue 和 review 反馈判断提交及文件内容的业务相关性。结构违规直接停止；语义存疑交给用户。线性提交不能仅凭形态证明业务相关，因此“冻结快照 + 新文件显式声明 + Agent 语义审查”三者缺一不可。

### D6. 测试与远端硬终点

同步入口保证 Git 不变量：rebase 已结束、工作区干净、`origin/master` 为 HEAD 祖先、恢复点有效、`git diff --check` 通过。Agent 按变更范围运行任务测试；失败不 push。

已有 PR 更新只有同时满足以下条件才能宣布完成：

1. push 成功；
2. Gitee PR 仍为 opened；
3. source branch 匹配；
4. Gitee `head_sha` 等于本地 HEAD；
5. `conflict=false`；
6. 文件数和最终 diff 已复核；
7. 本轮修订出现在远端 diff；
8. PR 描述已同步当前实现、测试、风险与未完成事项。

push 后 Agent 重新通过 Gitee MCP 获取同一规范快照，并运行 `scripts/verify-pr-update.sh --update-pr <PR编号> --pr-snapshot <推送后临时JSON> --json`。入口硬校验 opened/source/target、`head_sha=HEAD`、`conflict=false`、changed_files 与本地最终 diff 一致，并在恢复记录写入 `verified_head`；`finalize` 必须同时看到 `push_state=pushed`、`pushed_head=HEAD`、`verified_head=HEAD`。Gitee 暂未刷新时有限轮询；超过次数只报告“推送成功，PR 更新未确认”。普通网络读取最多重试两次；lease 变化时重新读取并做一次范围检查，整条链路最多自动重同步一次。第二次 lease 变化或发现未知提交立即停止。

规范快照是 Agent 对 Gitee MCP 实时响应的机器投影，不是人工判断：固定字段为 `pull_request_id`、`state`、`source_branch`、`target_branch`、`head_sha`、`conflict`、`changed_files`、`fetched_at`，有效期 300 秒，临时文件权限 `0600` 且不得进仓。首次创建 PR 前若存在同步事务，PR 创建成功后也使用同一验证入口写入 `verified_head`，再 finalize。

### D7. 信息归属与冲突输出

- Issue 评论：验收标准、范围、风险接受变化的权威决策记录；
- PR 描述：引用决策并反映当前实现、测试、风险、未完成事项；
- PR 评论：本轮 review 修订和远端核验结果；
- Commit：实际文件变化，不替代决策档案。

冲突停止时，Agent 必须基于入口结构化输出补齐 PR、分支、各 SHA、正在重放 commit、冲突文件/来源、语义差异、推荐方案、diff 影响、abort/恢复状态；不能只说“请人工处理”。

## 状态接口

脚本提供稳定状态，中文说明仅供人读。核心状态包括：`UP_TO_DATE`、`SYNCED`、`REBASE_CONFLICT_ABORTED`、`VERIFICATION_FAILED`、`ROLLED_BACK`、`FINALIZED`、`NEEDS_SYNC`、`REMOTE_READ_FAILED`、`REMOTE_SOURCE_MISSING`、`REMOTE_LEASE_CHANGED`、`PR_EVIDENCE_INVALID`、`PR_PREFLIGHT_VERIFIED`、`PUSH_STATE_PERSIST_FAILED`、`PUSHED_CREATE_PR`、`PUSHED_UPDATE_PR`、`PR_UPDATE_VERIFIED`。普通远端读取错误可重试，lease/证据/持久化错误 fail closed；Agent 按状态推进，不解析自然语言猜测。

## 考虑过的方案

- **Hook 内自动 rebase**：否决。违反文档驱动、Hook 只兜底原则，且冲突会把任意命令留在半完成状态。
- **同步时 merge origin/master**：否决。制造同步 merge commit、掩盖重复历史，并与任务分支 rebase 规则冲突。
- **rebase 失败自动换 merge/重建分支**：否决。改变历史策略和最终 diff，必须由人决策。
- **发布入口隐式 rebase**：否决。执行“发布”时悄悄改写本地历史，接口过浅且错误模式不清晰。
- **无模式调用默认 create**：否决。保留误开重复 PR 的根因。
- **统一硬编码测试集**：否决。前端、后端、脚本、文档任务无可靠统一集合；采用 Git 不变量硬检查 + Agent 范围化测试。

## 后果

- 正常路径由规则文档明确，Agent 能在无冲突时自动恢复，不再把阻断等同死锁。
- create/update 不再共享含糊输出，已有 PR 更新不会生成创建标记。
- rebase/force-with-lease 有可审计快照，未知远端提交不会被新读取的 lease 值“认可”后覆盖。
- 增加恢复文件、backup ref、finalize 和远端核验步骤；这是防止历史改写次生卡点的必要复杂度。
- 个人 memory 只记录历史经验，必须标注适用版本并服从仓库规则与实时状态。

## 验证

- `scripts/tests/test_sync_task_from_origin.py`：真实 bare origin + linked worktree 黑盒同步事务；
- `scripts/tests/test_publish_review_package.py`：create/update、PR 快照前后硬校验、冻结范围、显式 lease、推送状态故障注入、结构化网络失败、标记差异与并发远端变化；
- `scripts/test-hooks.sh`：Claude/Codex Hook 只对违规命令阻断、合规入口静默放行；
- 新 Agent 会话在临时远端复验 `NEEDS_SYNC → SYNCED → PUSHED_UPDATE_PR → FINALIZED`。

## 参考

- [ADR-0006](0006-sync-mechanism-auto-block.md)：检测与阻断策略；
- [ADR-0010](0010-local-master-is-user-integration-zone.md)：task worktree 与发布包装分支；
- [ADR-0011](0011-release-marker-consume-after-pr-success.md)：create 模式发布标记；
- [ADR-0012](0012-agent-noninteractive-authorization.md)：Agent 非交互授权。
