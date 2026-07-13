# Superpowers（团队共享技能 · 权威源）

本目录是 [obra/superpowers](https://github.com/obra/superpowers) 在本仓库的**唯一权威源**（single source of truth）。Claude Code 与 ZCode 的运行时副本由 `scripts/sync-superpowers-skills.sh` 从这里同步。

## 版本

- **superpowers**: 6.1.1（见 `VERSION`，tag `v6.1.1`，SHA `c984ea2`）
- 上游：https://github.com/obra/superpowers
- 协议：MIT（见 `LICENSE`）

## 目录布局（刻意对齐上游）

```
.superpowers/
├── skills/      # 14 个 skill（与上游同名）
├── hooks/
│   ├── session-start     # SessionStart 注入 using-superpowers 引导
│   └── run-hook.cmd      # polyglot 分发器（Windows 兼容）
├── VERSION      # 版本 + 上游 SHA
├── LICENSE      # 上游 MIT
└── README.md    # 本文件
```

`hooks/` 与 `skills/` 保持同级——`hooks/session-start` 用 `PLUGIN_ROOT=$(脚本父目录)` 自解析路径，读到 `../skills/using-superpowers/SKILL.md`。**改动此布局会破坏钩子。**

## 三端安装策略

| Harness | 来源 | 入库 |
|---------|------|------|
| **Claude Code** | `.claude/skills/`（同步自本源） | ✅ |
| **ZCode** | `.zcode/skills/`（同步自本源） | ✅ |
| **Codex** | 各自本地官方插件（`~/.codex/plugins/cache/claude-plugins-official/superpowers`） | ❌ 不入库 |

Codex 不入库——它已通过官方插件市场安装并启用（`~/.codex/config.toml` `[plugins."superpowers@claude-plugins-official"] enabled=true`），各成员本地自行维护。

## 14 个 skill 清单

`brainstorming` · `dispatching-parallel-agents` · `executing-plans` · `finishing-a-development-branch` · `receiving-code-review` · `requesting-code-review` · `subagent-driven-development` · `systematic-debugging` · `test-driven-development` · `using-git-worktrees` · `using-superpowers` · `verification-before-completion` · `writing-plans` · `writing-skills`

> 名称与本项目 mattpocock skills（`tdd` / `code-review` / `diagnosing-bugs` 等）**零冲突**，共存。

## 维护契约（重要）

1. **唯一权威源 = 本目录**。任何 skill 内容修订都先改这里，再跑同步脚本推到 `.claude/skills/` 与 `.zcode/skills/`。**禁止直接改两端副本**——下次同步会覆盖。
2. **同步脚本**：`scripts/sync-superpowers-skills.sh`（白名单同步这 14 个 skill 名，不误删 mattpocock skills；带 `--dry-run` 与 VERSION 校验）。
3. **升级上游**：
   ```bash
   # 1. 更新 .superpowers/（skills + hooks + VERSION + LICENSE）
   # 2. 跑同步脚本推到两端
   scripts/sync-superpowers-skills.sh
   # 3. commit 全部改动（走提交入口）
   ```
4. **副本一致性是团队约定，非自动**。新增成员 clone 后，两端副本已在仓库内，无需本地装插件（Codex 除外）。

## 与 CLAUDE.md 的关系

superpowers 是**可选方法论技能**，不替代本仓 git/issue 工作流硬规则。特别地：

- **`using-git-worktrees`** 的 declared preference = `scripts/start-task-worktree.sh`（见 `CLAUDE.md`）。本 skill 检测到 declared preference 后跳过自带 `git worktree add` 兜底，所有可写任务仍走 `CLAUDE.md` 红线 #4 入口。
- superpowers 的 `using-superpowers` SessionStart 钩子要求「任何回应前先调 skill」，**服从 `CLAUDE.md` 权威性**（`CLAUDE.md` 是团队 Agent 规则的唯一权威源）。

详见 `docs/agents/superpowers.md`。
