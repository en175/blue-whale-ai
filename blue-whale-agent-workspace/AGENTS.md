# Agent Workspace 通用入口

> **当前权威（2026-07-24，IK2D8R）**：运行时 Agent 配置以 `runtime-bundle/` 为准；`skill/` 是历史维护源，其 decision_context / L1 / 固定九分支 / 旧 agent/turn 语义已废弃，迁移结论见 `../docs/wayfinder/IK2D8R-first-runtime-bundle-migration.md`。

任何 Agent 必须先完整读取仓库根目录 `../CLAUDE.md`，遵守其中的 Work Tree、中文分支和 Git 红线；仓库级规则优先。

随后完整读取本目录 `CLAUDE.md`，获取 Blue-Whale Agent Workspace 的角色、产出物和编排协作规则。不要把 `@CLAUDE.md` 当作可自动展开的跨工具指令。

在以上两份文件读取完成前，禁止修改本目录文件或执行 Git 写入动作。
