# Superpowers（团队共享技能 · 权威源）

本目录是 [obra/superpowers](https://github.com/obra/superpowers) 在本仓库的**唯一权威源**（single source of truth）。Claude Code 与 ZCode 的运行时副本由 `scripts/sync-superpowers-skills.sh` 从这里同步。

## 版本

- **superpowers**: 6.4.1（见 `VERSION`，tag `v6.4.1`，SHA `5bf4e78`）
- 上游：https://github.com/obra/superpowers
- 协议：MIT（见 `LICENSE`）

## 精简说明

2026-09-23 从 14 个 skill 精简为 2 个 code review 技能（`receiving-code-review` / `requesting-code-review`），其余 12 个方法论 skill（brainstorming、TDD、debugging 全家桶等）按需求移除。保留的 2 个 skill 与上游 `v6.4.1`（即当前 main 最新提交）零差异。SessionStart 注入钩子随 `using-superpowers` 一并退役（`.claude/hooks/superpowers-session-start.sh` 与两端注册已删）。

## 目录布局

```
.superpowers/
├── skills/      # 2 个 skill（receiving-code-review、requesting-code-review）
├── VERSION      # 版本 + 上游 SHA
├── LICENSE      # 上游 MIT
└── README.md    # 本文件
```

## 三端安装策略

| Harness | 来源 | 入库 |
|---------|------|------|
| **Claude Code** | `.claude/skills/`（同步自本源） | ✅ |
| **ZCode** | `.zcode/skills/`（同步自本源） | ✅ |
| **Codex** | 各自本地官方插件（`~/.codex/plugins/cache/claude-plugins-official/superpowers`） | ❌ 不入库 |

Codex 不入库——它通过官方插件市场本地维护。若 Codex 端也需要精简，各成员在本地插件侧自行处理。

## 维护契约（重要）

1. **唯一权威源 = 本目录**。任何 skill 内容修订都先改这里，再跑同步脚本推到 `.claude/skills/` 与 `.zcode/skills/`。**禁止直接改两端副本**——下次同步会覆盖。
2. **同步脚本**：`scripts/sync-superpowers-skills.sh`（白名单同步这 2 个 skill 名，不误删 mattpocock skills；带 `--dry-run` 与 VERSION 校验）。
3. **升级上游**：从新版本 tag 更新 `.superpowers/skills/`（只取保留的 2 个 skill）与 `VERSION`，跑同步脚本推到两端，commit 走提交入口。

## 与 CLAUDE.md 的关系

superpowers 是**可选技能**，不替代本仓 git/issue 工作流硬规则。`CLAUDE.md` 是团队 Agent 规则的唯一权威源。

详见 `docs/agents/superpowers.md`。
