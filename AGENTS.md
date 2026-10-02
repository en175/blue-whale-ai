@CLAUDE.md 是本仓库团队 Agent 规则的唯一权威源。
开始任务前完整读取根目录 `CLAUDE.md`，再按其路由表加载对应规则。

结构查询（查符号 / 调用链 / 架构）先调 CBM 工具：`search_graph` 找符号、`trace_path` 查调用、`get_code_snippet` 精读，纯文本、配置、日志检索除外；切换 worktree 后重新核对索引。协议：`agent-rules/code-discovery.md`。

调用 `mcp__gitee-ent__*` 前读取 `docs/agents/issue-tracker.md`「ID 解析约定」及对应操作节，按 `CLAUDE.md`「Gitee ID 兜底常量」填写工具所需 ID。创建 issue 后按「创建」节回读归属并确认仓库可见。
