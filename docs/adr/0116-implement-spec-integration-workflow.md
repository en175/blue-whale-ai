# 规格整包实施的合回与清理方式

- 状态：已采纳
- 日期：2026-09-27
- 关联工单：IKIOS6

现有本仓适配让子任务分支合入集成分支，再由 merger 合回子任务。并行子任务分叉后，非快进合回会留下 merge commit；PR 发布入口会拦截这种提交。现有清理入口还要求提交已进入远端 release，而原技能第 9 步发生在 PR 合入 release 之前。

`implement-spec` 在本仓继续使用任务图、并行 implementer、独立子任务 worktree、merger 合回，以及集成分支上的收口和 PR 阶段验证。merger 合回前，可以将尚未共享的子任务分支受控 rebase 到集成分支当前提交，再以快进方式合回。合回后的文件树须与同一集成分支提交上的无冲突合并结果一致；冲突或内容核对失败时停止，不自动改用非快进合并。这样保留技能的分工与执行顺序，并让 PR 更新分支保持线性；[ADR-0013](0013-open-pr-update-state-machine.md) 的 merge commit 发布门禁不放宽。

子任务分支已共享时，不按上述路径改写其提交。IKGZ87 已提供 `--integration-worktree`，让子任务开工时继承固定的父整合提交；并行子任务分叉后，仍须按本决策核对文件树并受控合回。

2026-09-27 经用户确认，调整 `implement-spec` 的 PR 创建时机。第 3 步只建立本地集成分支，第 7 步完成整包评审与修订，第 8 步在验证通过且获得发布授权后创建正式 PR，显式传 `draft=false`。任务图、并行 implementer、独立子任务 worktree、merger 合回和整包评审保持不变。

这一调整替代本决策此前的"先创建草稿 PR"要求。[上游九步流程](https://github.com/mattpocock/skills/blob/c55ee46073ed923f86ce59a5eb3b6d895095d1b7/skills/in-progress/implement-spec/SKILL.md)在实施前创建草稿，但本仓 [ADR-0013](0013-open-pr-update-state-machine.md) 在 PR 创建后冻结业务范围，只接受审查修订、测试、文档闭环和同步结果。将首次 PR 创建移到整包实现与评审之后，可保留现有发布门禁，也不再需要为零差异草稿增加提交。调用技能本身不代表发布授权；已有 PR 继续按原 PR 更新事务处理，不另建 PR。

已发布的 PR 源分支若含合法子任务合回产生的 merge commit，仅在获得更新该 PR 的明确授权后，才允许标准入口受控线性化。入口先留恢复点，核对改写前后的文件树，重跑验证，再以远端 SHA 租约推送并回读 Gitee。任一检查失败就停止，不把此情形视为通过原有发布门禁。改写后须针对当前提交重新执行代码评审和发布核验，再将 PR 标记为可评审；旧提交的评审结论不能沿用。

`implement-spec` 第 9 步仍在 PR 合入 release 前清理子任务 worktree。为此新增子任务专用清理入口。普通快进路径确认子任务提交已进入远端 PR 源分支。若父整合分支合回后因发布线前进而 rebase，须先发布当前 HEAD、完成 Gitee 回读和同步事务 finalize；首次创建 PR 后同样通过 `verify-pr-update.sh` 记录核验结果，已有 PR 继续更新原 PR。清理入口逐次核对原提交保留引用、无冲突合并文件树以及已核验的 PR 源提交，证明断链时保留子工作树。已发布 PR 经受控线性化后，原子任务 SHA 不再属于新历史，须等 Gitee 回读与事务 finalize 后，核对原子提交属于改写前 PR 源、改写前后文件树相同且新线性提交已进入远端 PR 源，再清理对应 worktree。现有 `cleanup-task-worktree.sh` 继续用于提交已进入远端 release 后的任务清理。

2026-09-30 文档归属调整：`implement-spec` 技能正文还原为上游 1:1 原文，本决策定义的机制（集成分支开工与固定继承提交、merger 受控合回、PR 创建时机、受控线性化、子任务清理证明链）改由 [integration-branch-workflow.md](../agents/integration-branch-workflow.md) 承载，技能中 draft PR、implementer 自行合回、工单关闭三处通用指令按该文的执行映射覆盖。决策内容不变。
