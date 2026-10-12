---
name: ponytail-debt
description: >
  汇总存量 shortcut: 和 ponytail: 注释为债务清单，也支持用户指定标记。
  适用于查看已推迟工作和重新评估条件。一次性只读报告，不改持久档位。
license: MIT
---

# Ponytail 债务清单

本仓禁止新增普通代码注释。此技能只读取存量 `shortcut:` 与 `ponytail:` 标记，不新增或重写标记。新的限制和升级条件放工单或维护文档。

标记扫描是纯文本检索，可直接执行：

```bash
rg -n --hidden --glob '!.git/**' --glob '!node_modules/**' --glob '!dist/**' --glob '!build/**' --glob '!coverage/**' '(#|//|/\*)\s*(shortcut|ponytail):' .
```

用户指定标记时用 `rg --fixed-strings` 搜索原词，并核对实际注释。跳过依赖、Git 与构建产物；去除仅提到键盘快捷键或引用标记的非债务命中。需要追踪所有者时用 `git blame`。

按文件分组，每行记录文件与行号、简化内容、已知限制和重新评估条件。缺少明确条件的行标记为 `no-trigger`。数量来自实际命中，不估算。

使用中文。最后给出总标记数和缺少条件数；没有命中时明确写零。一次性报告，不改档位、源码或配置。用户明确要求保存时，按仓库文档归属与任务工作树规则保存。
