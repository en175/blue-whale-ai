# Superpowers 上游记录

`CLAUDE.md` 是团队 Agent 规则的权威源，`.agents/skills` 是团队工程技能的实际存储目录。`.claude/skills` 指向同一目录。ZCode 直接发现 `.agents/skills`。

## 上游版本

| 项 | 值 |
| --- | --- |
| superpowers | 6.4.1 |
| 上游 tag | `v6.4.1` |
| 上游 SHA | `5bf4e78011075bcfc0dc295f0724994cd123ee71` |
| 锁定日期 | 2026-09-19 |
| 协议 | MIT，见 `.superpowers/LICENSE` |

`.superpowers/VERSION` 记录版本和来源，`.superpowers/skills/` 保存上游原件。运行时使用 `.agents/skills/receiving-code-review/` 和 `.agents/skills/requesting-code-review/`。更新上游时，先核对原件的差异，再在任务分支明确修订 `.agents/skills/` 中对应的完整技能包并提交审查。上游目录不会自动覆写运行时技能。

2026-09-23 的精简保留了上述两个审查技能，其余 12 个上游技能已退役。原 SessionStart 注入钩子也已退役。

项目技能随 Git 检出交付。修改、增加或删除团队技能时，编辑 `.agents/skills/` 或经 `.claude/skills/` 链接编辑同一文件树。无需运行逐技能同步命令。成员个人技能目录由成员自行管理。
