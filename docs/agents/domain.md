# Domain docs

本仓库是**单上下文**（single-context）布局。

- `CONTEXT.md`（仓库根）：项目领域语言 / ubiquitous language 单一权威源。
- `docs/adr/`：架构决策记录（ADR），过去架构决策的历史（最新 0010）。

技能读领域文档时：

- 涉及领域术语 / 概念 → 读根 `CONTEXT.md`。
- 理解过去架构决策 → 读 `docs/adr/`（按编号）。

无 `CONTEXT-MAP.md`，非 monorepo 多上下文。
