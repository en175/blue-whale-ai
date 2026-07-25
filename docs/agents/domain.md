# Domain docs

本仓库是**单上下文**（single-context）布局。工程技能消费领域文档的规则如下。

## 探索前先读

- 根 `CONTEXT.md` —— 项目领域语言 / ubiquitous language 单一权威源。
- `docs/adr/` —— 读触及你即将改动区域的 ADR。（单上下文，无 `src/<context>/docs/adr/`。）

上述文件不存在时**静默继续**——不报告缺失、不预先建议创建。`/domain-modeling`（经 `/grill-with-docs`、`/improve-codebase-architecture` 触达）会在术语 / 决策真正落地时惰性创建它们。

## 编辑这些文档

根 `CONTEXT.md` 与 `docs/**/*.md` 是散文规格文档，编辑它们**无需开 task worktree**：AI 可在本地 master 直改，落盘走 `scripts/commit-spec-on-master.sh -m "<描述>"`（[ADR-0025](../adr/0025-doc-on-master-allowlist.md)，不 push、不开 PR）。`docs/**/*.json` schema / 契约、fixtures 不是散文，仍走 worktree。

## 文件结构

单上下文（多数仓库）：

```
/
├── CONTEXT.md
├── docs/adr/        ← 架构决策记录，最高编号 0012
└── ...
```

无 `CONTEXT-MAP.md`，非 monorepo 多上下文。

## 用 glossary 的词汇

输出（issue 标题、重构提案、假设、测试名）命名领域概念时，用 `CONTEXT.md` 定义的术语，不漂移到 glossary 明确回避的同义词。

需要用的概念不在 glossary 里，是信号——你在发明项目不用的语言（重新考虑），或真实缺口（记下给 `/domain-modeling`）。

## 标注与 ADR 的冲突

输出与现有 ADR 矛盾时显式指出，不静默覆盖：

> _与 ADR-0003（禁直推 master）冲突——但值得重开，因为……_
