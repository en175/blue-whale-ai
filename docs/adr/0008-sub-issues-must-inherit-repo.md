# ADR-0008：子 issue 必须继承父项仓库/项目归属，并完成仓库可见性反查

- **状态**：Accepted
- **日期**：2026-07-07
- **决策者**：JJNNReno（与 Codex 调查后确认）

## 背景

父工作项 `IJZ5WA` 关联到 blue-whale-ai 仓库，仓库 Issues 页可见；但其 5 个子工作项 `IJZ74J` / `IJZ74K` / `IJZ74L` / `IJZ74M` / `IJZ74N` 只在企业工作台父项详情页可见，仓库 Issues 页不可见。

实测 MCP 行为：

- `get_enterprise_issue_detail(IJZ74*)` 能按 ident 直接查到这些子项。
- 这些子项 `parent_id/root_id` 指向父项，但 `project_id=0`、`program_id=0`。
- `list_enterprise_issues(project_id=父项 project_id, search=子项 ident)` 返回空。
- `list_enterprise_issues(search="IJZ74")` 能从企业全局列表查到它们。

结论：问题不是权限或数据不存在，而是子项没有继承父项的仓库/项目归属。AI Agent 以仓库 Issues 作为任务池时会漏掉这类子项。

## 决策

### D1. Agent 可执行任务必须仓库可见

所有可交给 AI Agent 执行的任务，必须能通过仓库维度查询发现：

```text
list_enterprise_issues(project_id=<repo_project_id>, search=<issue_ident>)
```

只在企业工作台可见、不在仓库 Issues 可见的工作项，不算发布成功。

### D2. 子 issue 创建必须继承父项归属

创建子 issue 前必须读取父项详情，并传入：

- `parent_id = parent.id`
- `project_id = parent.project_id`
- `program_id = parent.program_id`
- `issue_type_id = parent.issue_type.id`

创建后紧跟 `update_enterprise_issue` 补 `ready-for-agent` 标签，并用 D1 的仓库维度查询反查。

### D3. Hook 兜底范围扩大到子 issue

延续 [ADR-0007](0007-issue-must-link-repo.md) 的“规范前置 + Hook 兜底”模式：

- `create_enterprise_issue` 缺 `project_id` 或 `project_id=0`：硬拦。
- `create_enterprise_issue` / `update_enterprise_issue` 带 `parent_id` 但缺 `project_id` 或 `program_id`：硬拦。
- `update_enterprise_issue` 显式把 `project_id` 设为 `0`：硬拦。
- 普通更新标题、标签、状态时不要求重复传 `project_id`。

### D4. 不新增本地 Gitee API 发布脚本

Issue 发布入口仍为 MCP。原因：

- 当前仓库协作流程已经围绕 Gitee MCP 工具建立。
- 本地脚本会重复维护 API 鉴权、请求格式和错误处理。
- 本次故障可通过 MCP 参数规则、hook 和发布后反查解决。

## 后果

- 正面：子 issue 不再只停留在企业工作台父项下；仓库 Issues 维度能稳定作为 Agent 任务池。
- 正面：普通 issue 更新不被误拦，只有会破坏仓库可见性的创建/更新被拦。
- 代价：创建子 issue 前必须多读一次父项详情，创建后必须多做一次仓库维度反查。

## 迁移策略

对已存在的 `IJZ74J` / `IJZ74K` / `IJZ74L` / `IJZ74M` / `IJZ74N`：

1. 先尝试 `update_enterprise_issue` 补 `parent_id=33553306`、`project_id=48854568`、`program_id=883843`。
2. 每个子项更新后用 `list_enterprise_issues(project_id="48854568", search=ident)` 验证。
3. 如果 Gitee 不允许后改归属，则重新创建仓库可见子 issue，旧子项评论迁移目标后关闭。

迁移会写真实 Gitee 数据，执行前必须单独确认。

## 闭环验证（2026-07-12，IK0FRU 探针）

迁移策略 step 3 的不确定性「Gitee 是否允许后改归属」由 IK0FRU 探针消除：

- **根 issue 场景直接验证**：`update_enterprise_issue(IK0FL6, program_id=883843)` 成功，`get_enterprise_issue_detail(IK0FL6).program_id` 反查 = 883843（0 → 883843）。
- **副作用**：单传 `program_id` 一个字段，`state` / `assignee` / `labels` 均无变化——无污染。（对比：同次 update 若附带 `label_ids` 含 `ready-for-agent`，state 会被企业看板自动化改成 `progressing`、assignee 被指派——系标签触发，与归属字段无关。）
- **结论（根 issue 场景）**：Gitee **允许后改归属**。根 issue 走 step 1（`update` 补归属）即可，step 3（重建）不必要。子 issue 场景见下「覆盖范围」。

**覆盖范围**：

- 根 issue（`root_id=0`，如 IK0FL6）——**直接验证可行**。
- 子 issue（带 `parent_id`，如 IJZ74*）——**未单独验证**。`program_id` 是工作项的字段级属性，`update` 改字段值一般不因 issue 层级（根/子）而异，故子 issue 预期同样允许后改归属；但本探针未直接证实，执行 IJZ74* 迁移时仍须按 step 2 反查确认后方可定论。

据此，存量 `program_id=0` 根游离项的批量补挂（后续 ticket）走 `update_enterprise_issue(program_id=883843)` 路径，无需重建。

参考：[IK0FRU](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK0FRU)（探针）、[IK0FL6](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK0FL6)（探针样本）。

## 参考

- [ADR-0007：所有 Gitee issue 必须关联仓库](0007-issue-must-link-repo.md)
- [ADR-0014：根 issue 必须归属项目](0014-root-issue-must-link-program.md)
- [`docs/agents/issue-tracker.md`](../agents/issue-tracker.md)
- [`docs/research/gitee-enterprise-subissues-mcp.md`](../research/gitee-enterprise-subissues-mcp.md)
- 实测事件：`IJZ5WA` / `IJZ74J` / `IJZ74K` / `IJZ74L` / `IJZ74M` / `IJZ74N`
