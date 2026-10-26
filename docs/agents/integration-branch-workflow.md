# 集成分支工作流

一个父任务（规格或需求）拆成多张工单并行实施时使用：每张工单一个独立子任务 worktree 与分支，合入同一**集成分支**，最终以**单个 PR** 交付。`implement-spec` 技能是本工作流的主要使用场景；任何采用同样分支形态的多工单工作流都按本文执行。

授权红线、分支命名、发布入口与 PR 更新事务等通用规则见 [git-workflow.md](git-workflow.md)；worktree 元数据、通用同步与清理见 [worktree-workflow.md](worktree-workflow.md)；MCP 操作见 [issue-tracker.md](issue-tracker.md)，状态权威见 [gitee-workflow-agent.md](gitee-workflow-agent.md)；验证分层见 [testing-strategy.md](testing-strategy.md)。本文只承载本工作流特有的规则，不重复上述文件的通用含义。

## 与上游 implement-spec 技能的执行映射

`.agents/skills/implement-spec/SKILL.md` 是上游 1:1 原文，其中三处通用指令在本仓按本文执行，不按字面执行：

| 技能原文 | 本仓执行 |
| --- | --- |
| 第 3 步：首次合并后开 draft PR | 集成分支全程保持本地；全部工单集成、整包评审与修订完成后，按本文「同步、评审与发布」一次性创建**非 draft** PR（[ADR-0116](../adr/0116-implement-spec-integration-workflow.md)） |
| 第 4 步：implementer 完成前自行把集成分支 tip 合入自己分支 | implementer 不碰集成分支；合回只由 merger 按本文「merger 合回」受控执行 |
| 第 8 步：mark draft ready / 按 issue tracker 关闭工单 | 本仓按发布授权创建非 draft PR；Resolve 记录工程验证与交付，保持业务状态。工程解锁按下节，业务流转按状态权威；PR 合入 release 仍只证明入线 |

调用 implement-spec 技能授权实现与本地集成，不授权发布；推送、建 PR、合并仍按 git-workflow.md「发布授权」节单独获得明确授权。

## 工程依赖与任务图

接手整包先按 issue-tracker.md 覆盖全部粗状态分页建立父子任务图；接手子票核对自身、父要求与直接前置。声明沿用「前置工单」，兼容旧 `Blocked by`，逐项记录编号、标题、链接和解锁要求。

| 前置要求 | 解锁证明 |
| --- | --- |
| 同包工程依赖 | 前置本票工程验证通过，成果经受控合回进入集成分支，后续任务实际基线包含所需成果 |
| 外部必须先独立入 release | 目标 release 已包含所需提交；同一契约章节的基础设施继续按 git-workflow.md 先独立入线，不能改称同包依赖 |
| 验收或环境前置 | 声明要求的实际验收结论或环境就绪证据有效且覆盖本次范围 |

仅以全部声明前置满足判定 frontier，无关兄弟尚未完成不阻塞。前置要求不清时先澄清，不把粗状态 closed 或业务终态当作通用解锁条件。同包成果解锁后仍记录工程交付，业务验收默认随父。

子任务证据区分自身 diff 与固定继承依赖。合回、同步或修订改变 HEAD、基线、范围或输入时，按 testing-strategy.md 重新核对和验证；只有绑定有效才复用证据。整包审查及必验行为覆盖父规格当前完整范围。

依赖变化、交付、提测、生产收口和恢复时刷新相关证据，日常编码复用有效记录。父子部署、定向返工、同包恢复及新增范围的业务判断统一读状态权威，不按工程任务图自动推进状态。

## 开工

**集成分支**就是未来的 PR 源分支，从当前本地发布线工作树用普通开工入口建立：

```bash
scripts/start-task-worktree.sh --type <类型> --issue <父工单号> --summary <6–15字中文简述> --target-branch <master|dev|test|release>
```

进入返回的 worktree，用 `python3 scripts/lib/task_metadata.py read --json` 核对记录的 `target_branch` 与 `start_sha`，后续同步、验证、发布、清理全程使用该记录。核对目录 CBM 项目后，按状态权威判定开工或恢复，再按 issue-tracker.md 认领并回读父工单，建 worktree 不代替该 API 调用。

**子任务 worktree**同样从当前本地发布线工作树建立，必须带 `--target-branch` 和 `--integration-worktree` 指向集成 worktree 的绝对路径：

```bash
scripts/start-task-worktree.sh --type <类型> --issue <子工单号> --summary <6–15字中文简述> --target-branch <master|dev|test|release> --integration-worktree <集成worktree绝对路径>
```

入口从集成分支记录**固定继承提交**，子任务在该提交之上开工。进入子 worktree 后核对元数据与 CBM 项目，按状态权威与认领流程处理子工单，并备好该工单工具链所需依赖。

子任务开工后若需要集成分支的新内容，在子分支尚无自有提交前执行 `git merge --ff-only <集成分支>`；已有自有提交时不自行 rebase，留待 merger 合回时受控处理。

## implementer 派发与实施

每个 implementer 子代理独占一张工单、其声明文件和一个子任务 worktree。派发前父级先走 CBM 结构查询定位工单涉及的符号与路径（`search_graph` → `trace_path`，按 `agent-rules/code-discovery.md`），把符号/路径与覆盖结论写进派单——子代理会话无 CBM 注入，缺 MCP 工具时只能消费父级证据定向精读。派发时给出：工单与规格指针、验收标准、声明的文件范围、集成 worktree 路径、所需依赖提交、上述代码探索证据与工具能力核对，并明确告知有其他代理并行工作、须保留他人改动、超出自身范围的修改只报告不动手。

实施按工单验收标准进行，凡可先写测试的切片用 `/tdd` 驱动红绿循环。提交只走：

```bash
scripts/commit-task-for-review.sh -m "<message>"
```

完成回报：worktree、分支、HEAD、变更文件清单，以及**本工单自身 diff** 的验证证据——固定继承提交是依赖上下文，不算本工单的改动。**子分支保持本地**：与 release 的同步和 PR 发布只发生在集成分支上，子分支不推送、不单独建 PR。

## merger 合回

merger 子代理是集成 worktree 在任一时刻的唯一写入者，一次只合回一个已提交的子任务。在集成 worktree 执行：

```bash
python3 scripts/merge-implement-spec-child.py --child-worktree <子任务worktree绝对路径> --json
```

入口只改写未共享的子分支：将其自有提交受控 rebase 到集成分支当前提交，核对结果文件树与同一基线上的无冲突合并一致，然后快进集成分支。记录返回的 HEAD——子任务提交 ID 可能已变化。冲突、文件树不一致、子分支已共享或存在保留的恢复引用时入口停止：**保留父子两个 worktree 现场**，不得改用普通合并或临时改写历史代替；其余独立工单继续派发。

若集成分支缺少子任务记录的 release 起点提交，先按 worktree-workflow.md 的同步入口同步集成分支再重试。合回成功后检查受影响的交互面并更新任务图。本地集成只满足实施内部的依赖：不关闭 Gitee 工单；凡要求「已合入 release」的前置条件，在该 PR 真正合入 release 之前仍视为阻塞。最终验证覆盖合并后的整包分支，范围按 testing-strategy.md。

## 同步、评审与发布

全部工单集成后，在集成 worktree 同步到元数据记录的目标 release：

```bash
scripts/sync-task-from-origin.sh sync --target-branch <记录的release> --json
```

目标改动过本任务删除或替换的路径时，改用 `sync --keep-conflicts` 让 rebase 停在冲突处：逐个核对双方版本并解决，暂存后以 `git -C <集成worktree> -c core.editor=true rebase --continue` 走完（显式 `-C` 让 Hook 在 HEAD detached 时仍能识别任务目录），再运行 `scripts/sync-task-from-origin.sh complete-resolved --json` 并要求返回 `SYNCED_RESOLVED`——它核对最终文件树与 Git 自动合并结果的差异不超出记录的冲突路径并保留恢复引用；继续之前先复核这些路径的内容。

记录同步后的 HEAD 与固定 diff 基线，然后对**整个规格 diff** 跑 `/code-review`，显式传入基线与规格。评审修订由单个 implementer 子代理在集成 worktree 独占完成，经 `scripts/commit-task-for-review.sh` 落盘。修订若叠加在未完成的同步事务上，重跑同步入口并核对记录的 `synced_head` 等于新 HEAD；入口只在核对备份引用、merge-tree 谱系、远端源 SHA 与 PR 冻结范围后接受干净的线性续接。被拒绝时保留恢复引用并报告失败证明，不改写事务元数据强行通过。

发布前运行 PR 阶段验证：

```bash
node scripts/verify-change-scope.mjs run --stage pr
node scripts/verify-change-scope.mjs check --stage pr --json
```

HEAD 或目标变化使既有证据失效，须重跑受影响的评审与验证。若任务起点尚未进入远端 release，报告未共享基线并保留本地结果——本工作流不授权推送 release 分支。

获得发布授权后，按 git-workflow.md「发布授权」节执行：PR 正文用 `pr` 技能模板，链接规格与每张已交付工单及其验收、验证证据；经发布入口推送：

```bash
scripts/publish-review-package.sh --user-authorized --create-pr --target-branch <记录的release> --json
```

随后创建 source/target 与发布标记一致、显式 `draft=false` 的 Gitee PR，回读确认非 draft 状态、描述、工单链接、source、target、HEAD、冲突状态与 diff；按 git-workflow.md 保存新鲜快照并运行 `scripts/verify-pr-update.sh --update-pr <PR编号> --pr-snapshot <快照JSON> --json` 核验（新建 PR 同样适用）。若同步事务仍未 finalize，核验通过后运行 `scripts/sync-task-from-origin.sh finalize --json`——它记录发布前 rebase 之后清理子任务所需的谱系证据。随后按 issue-tracker.md 合并保留标签、记录工程进度并交给开发者评审；合并 PR 须单独授权。

已存在 PR 时不建第二个：按 git-workflow.md「已有 PR 审查修订」的更新事务执行。源分支若含历史子任务合回留下的 merge commit，按下方 linearize 程序处理；改写后的 HEAD 须重新评审与验证，旧 HEAD 的结论不沿用。若已有 PR 是 draft 且可用工具无法变更 draft 状态，报告剩余人工动作并保持交接挂起，不声称 PR 已可评审。

### linearize（已发布 PR 的 merge commit 受控线性化）

已发布 PR 因合法子任务 merge commit 被 `SCOPE_MERGE_COMMIT_DETECTED` 拦截时，本轮须先明确获准更新该 PR。取 Gitee 快照，先从 Gitee 核对子工单确属该规格，再在集成 worktree 执行：

```bash
scripts/sync-task-from-origin.sh linearize --user-authorized --update-pr <PR编号> --pr-snapshot <临时JSON> --child-branch <子分支> --json
```

多个子分支重复传 `--child-branch`。入口核验各子分支 worktree 元数据与 merge 父提交，要求本地 HEAD 等于远端 PR 源 HEAD、目标发布线已在本地 HEAD 中、所有提交路径属于 PR 冻结范围；保存原 HEAD 恢复点，把原文件树写成线性提交并运行 PR 阶段验证，失败时保留恢复点不推送。成功后在新 HEAD 上重新执行代码评审；评审产生同范围修订时用提交入口落盘，再 `sync --json` 更新恢复点并重跑 PR 阶段验证。评审与验证通过后按 `--update-pr` 入口以远端 SHA 租约推送，回读 Gitee 并运行 `verify-pr-update.sh`，最后 finalize。遇 `REMOTE_SOURCE_CHANGED` 或租约变化先核对远端提交归属，不覆盖未知提交。普通 `sync` 返回 `UP_TO_DATE` 不会自动处理 merge commit。

## 清理

远端 PR 内容核验通过后，先取新鲜 Gitee PR 快照，从各子任务 worktree 执行：

```bash
python3 scripts/cleanup-implement-spec-child.py --pr-snapshot - --json
```

将规范化快照通过标准输入传入，或继续使用 JSON 文件路径。入口核对远端 PR 源已包含该子任务的工作。普通快进路径要求子任务 HEAD 是远端 PR 源 HEAD 的祖先；集成分支合回后因发布线前进而 rebase 的，须先更新同一 PR、完成 Gitee 回读与同步事务 finalize，清理入口核对旧子提交、每次同步保留的原提交及合并文件树证明；已发布 PR 经 linearize 后，清理入口核对旧子提交属于改写前历史、改写前后文件树相同、新线性提交是远端 PR 源 HEAD 的祖先。入口删除前复核远端核验分支 HEAD 未变化；任一证明断链时保留该子 worktree。报告删除了哪些子 worktree、保留了哪些及原因。

PR 已合并后也使用同一入口。入口从远端目标 release 确认快照中的 PR 源 HEAD 已合入，再检查子任务提交或保留的同步、线性化证明；不要求源分支或集成 worktree 仍存在。子任务提交经移植进入 PR、原 SHA 已不是源 HEAD 祖先时，须显式传 `--equivalent-commit <完整 SHA>`：入口核验该提交属于 PR 源 HEAD、与子任务补丁逐字节一致，并在隔离索引中重放比对完整文件树。子任务 HEAD 若等于同步证明的原源 HEAD，可直接进入该证明的引用、文件树和远端回读校验。删除前复核远端目标 release 未变化。仅出现在后续 release 提交中的子任务改动，不能作为该 PR 的清理依据。

集成 worktree 保留到 PR 合入目标 release 并核验之后（供评审期间的修订使用），再按通用入口 `scripts/cleanup-task-worktree.sh` 清理。

清理前保留工单、提交、验证与 PR 指针，供后续验收或返工读取。代码承载证明与工作树清理不表示业务验收或工单完成。
