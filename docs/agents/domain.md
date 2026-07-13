# Domain Docs

工程技能（`/improve-codebase-architecture`、`/diagnosing-bugs`、`/tdd`、`/domain-modeling`、`/grill-with-docs`）探索代码库前，按本文件消费本仓库的领域文档。

## 探索前必读

- **`CONTEXT.md`**（仓库根）——项目领域语言 / 术语表。当前为前端 Canvas 单上下文。
- **`docs/adr/`**——读触及你将工作区域的 ADR。本仓库已有 0003–0011（git 工作流 / issue 关联 / project model 等）。

若上述文件不存在，**静默继续**——不标记缺失、不主动建议创建。`/domain-modeling`（经 `/grill-with-docs`、`/improve-codebase-architecture` 触达）会在术语 / 决策真正落实时惰性创建。

## 文件结构

本仓库为 **single-context**（单上下文）：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0003-no-direct-push-to-master.md
│   └── 0011-unified-project-model.md
└── ...
```

无 `CONTEXT-MAP.md`（多上下文 monorepo 才用）。若未来拆前后端独立上下文，改 multi-context 并建 `CONTEXT-MAP.md` 指向各 `CONTEXT.md`。

## 用术语表的词汇

输出命名领域概念（issue 标题、重构提案、假设、测试名）时，用 `CONTEXT.md` 定义的术语，别漂移到术语表明确规避的同义词。

例（来自现 `CONTEXT.md`）：用 `AgentChatPanel` 不写「对话区 / Agent 面板」；文档中用 `Canvas` 不写「画布」。

需要的概念还不在术语表——信号：要么你在发明项目不用的语言（重新考虑），要么真有缺口（记下给 `/domain-modeling`）。

## 标记 ADR 冲突

输出与现有 ADR 矛盾时，显式标出，别静默覆盖：

> _与 ADR-0011（统一 project model）冲突——但值得重开，因为…_
