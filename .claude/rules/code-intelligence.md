# 代码理解工具：CBM 主 + graphify 进阶

> CBM（codebase-memory-mcp）是默认第一站，graphify 按需进阶。两者互补不冲突。

## 分工：任务意图 → 工具

| 任务意图 | 工具 | 命令 |
|---|---|---|
| 找函数 / 类 / 路由定义 | CBM | `search_graph(name_pattern=...)` |
| 查调用链（谁调用 / 调用谁） | CBM | `trace_path(func, mode=calls)` |
| 数据流追踪 | CBM | `trace_path(func, mode=data_flow)` |
| 跨服务调用追踪 | CBM | `trace_path(func, mode=cross_service)` |
| 复杂度 / 热点 / 重构候选 | CBM | `query_graph`（Cypher，查 complexity / loop_depth） |
| 影响分析 / 死代码 / 高扇出 | CBM | `query_graph` / `trace_path(direction=inbound)` |
| 架构全景 / 模块边界 | CBM | `get_architecture(aspects=['clusters'])` |
| 取精确符号源码 | CBM | `get_code_snippet(qualified_name)` |
| 文本搜索（图谱增强 grep） | CBM | `search_code(pattern)` |
| 可视化 HTML 报告 / 交互图 | graphify | `graphify query "<问题>"` |
| 跨文档导航（wiki / index） | graphify | `graphify query` / 读 `graphify-out/wiki/` |
| 自然语言模糊探索 | graphify | `graphify explain "<概念>"` / `graphify path "<A>" "<B>"` |

## 命令速查

**CBM**（MCP 工具，零冷启动）：

- `search_graph(query="..." | name_pattern=... | label=...)` — 找符号
- `trace_path(function_name, mode=calls|data_flow|cross_service, direction=inbound|outbound)` — 调用链
- `get_code_snippet(qualified_name)` — 精确源码
- `query_graph(query="<Cypher>")` — 复杂图查询
- `get_architecture(aspects=[...])` — 结构全景。aspects 可选 `overview` / `structure` / `dependencies` / `routes` / `languages` / `packages` / `entry_points` / `hotspots` / `boundaries` / `layers` / `file_tree` / `clusters` / `all`（完整枚举见工具 schema）
- `search_code(pattern)` — 图谱增强文本搜索

**graphify**（CLI，需 `graphify-out/`）：

- `graphify query "<问题>"` — 自然语言查代码结构（scoped subgraph）
- `graphify path "<A>" "<B>"` — 查调用 / 依赖关系
- `graphify explain "<概念>"` — 聚焦概念
- `graphify update .` — 改代码后刷新图谱（AST-only，零 API 费用）

> task worktree 需 graphify 时再跑 `scripts/ensure-graphify-worktree.sh`（按需，不强制每个 worktree 都建图）。

## 索引维护

- **CBM**：watcher 自动增量索引。但**语义边（`SEMANTICALLY_RELATED`）增量不重新生成** —— 定期跑 `index_repository(repo_path=., mode=full)` 刷新语义边（需 `CBM_SEMANTIC_ENABLED=1`）。
- **graphify**：`graphify update .` AST-only 增量，零费用，改代码后随手跑。

## 团队 onboarding（CBM 不随仓库分发）

CBM 二进制和 MCP 配置在用户级，clone 后没有。首次接入：

1. 装 CBM：`uv tool install codebase-memory-mcp`（CLI 进 `~/.local/bin`，确认在 PATH）。
2. 配 MCP server：在 `.mcp.json`（项目级，gitignore 本地）或 `~/.claude.json` 的 `mcpServers`（用户级全局）注册 `codebase-memory-mcp`，env 含 `CBM_SEMANTIC_ENABLED=1`（开语义边）。最小配置：
   ```json
   "codebase-memory-mcp": {
     "command": "codebase-memory-mcp",
     "env": { "CBM_SEMANTIC_ENABLED": "1" }
   }
   ```
3. 建索引：`index_repository(repo_path=., mode=full)` → 确认 `index_status=ready`。
4. task worktree 另建独立索引（不得用主 checkout 索引替代）。

> CBM 重装会抹 `CBM_SEMANTIC_ENABLED` env：重加 + 重启 MCP + 重跑 `index_repository(mode=full)` 才恢复语义搜索。

## 降级路径

- **CBM 不可用**（未装 / 索引未就绪）→ grep/glob + Read 兜底。CBM gate 只 inject 不 deny，天然允许降级。
- **graphify 未生成**（无 `graphify-out/`）→ 跳过，CBM 已覆盖结构查询。
- **本仓 `graphify-out/` 被 gitignore**，各 worktree / clone 需各自生成或共享。
