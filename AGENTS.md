`CLAUDE.md` 是本仓库团队 Agent 规则的唯一权威源。
开始任何任务前，必须完整读取根目录 @CLAUDE.md

代码探索前必须读取 `agent-rules/code-discovery.md`；不要等创建 worktree 后才查询 CBM。

任何 `mcp__gitee-ent__create_enterprise_issue` 调用：必传 `project_id` + `program_id`（blue-whale-ai 固定 48854568 / 883843），缺任一则工单游离、项目视图查不到（IKFV91 / IKH3YM 两次实证）；建后回读核验 `program_id ≠ 0`。细则与全部建单规则见 `docs/agents/issue-tracker.md`「创建」节。
