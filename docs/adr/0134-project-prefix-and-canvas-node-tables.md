# ADR-0134：`project_` 前缀与画布节点行表

- **状态**：已采纳
- **日期**：2026-10-27
- **决策者**：lixq
- **关联**：[ADR-0117](0117-table-naming-and-module-prefix.md)、IKQY33 / IKQWV1

## 背景

画布内容一直以 `canvas.nodes_json` / `edges_json` 整体存储，节点无法按类型、来源、生成任务检索，也挡不住整份文档覆盖写。IKQWV1 把画布改为按对象落行：新增 `project_nodes` / `project_edges` / `project_node_revisions`。

ADR-0117 §5 曾明确把 `canvas` 划入「本身就是模块名、不为整齐去改」的免改名单。本次两处改名不是为整齐：`canvas` 与 `prompt_preview_snapshots` 的写入方、读取方和生命周期都属于项目画布，表名带上下文前缀后，跨表检索、慢查询和迁移文件名才自解释；节点行表也落在同一前缀下，避免出现 `project_nodes` 与 `canvas` 混排。

## 决策

1. `canvas` → `project_canvas`，索引 `uk_canvas_project` → `uk_project_canvas__project`。
2. `prompt_preview_snapshots` → `project_prompt_preview_snapshots`，索引 `uk_prompt_preview_source` → `uk_project_prompt_preview_snapshots__source`。
3. 新增 `project_nodes`、`project_edges`、`project_node_revisions`，命名与索引按 ADR-0117 的 `uk_{表}__{列}` / `idx_{表}__{列}`。
4. 软删表沿用 `is_delete`，唯一键**不含** `is_delete`：被软删的行仍占位，写入方必须复活而不是重建。该约束由后续写入工单（IKQY3H 及其下游）承担。

## 后果

- 改名是**发布期破坏性变更**：DDL 执行后旧镜像读 `canvas` 立即失败。部署顺序必须是「停旧实例 → 执行 DDL → 起新镜像」，或先提供过渡视图。
- 迁移语句顺序固定为：建新表 → 旧表上改索引 → 单条多表 `RENAME TABLE`。改索引是唯一可能按名字失配的步骤，放在表改名之前，失败时旧表仍可用、可重跑；与 `054_bw_prefix_rename.sql` 同一规矩。
- 新表暂不含 `tag` / `parent_node_id` 与生成归属列，由 Agent 写入与归属合并工单补齐。
