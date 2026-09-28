# Superpowers 上游记录

本目录保存 [obra/superpowers](https://github.com/obra/superpowers) 的上游版本、许可和两份审查技能原件。团队运行时技能的实际存储目录是 `.agents/skills/`；`.claude/skills` 指向该目录，ZCode 直接从该目录发现技能。`CLAUDE.md` 仍是团队 Agent 规则的权威源。

- 版本：6.4.1，tag `v6.4.1`，完整 SHA 见 `VERSION`。
- 许可：MIT，见 `LICENSE`。
- 保留原件：`receiving-code-review`、`requesting-code-review`。

2026-09-23 从上游 14 个技能精简为上述两个，SessionStart 注入钩子一并退役。本目录仅用于上游来源比对，不向运行时技能目录自动写入。更新上游时保留版本与许可记录，核对差异后在任务分支修订 `.agents/skills/` 中的完整技能包。

项目技能维护方式见 `docs/agents/superpowers.md`。
