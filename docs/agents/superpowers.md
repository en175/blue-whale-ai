# Superpowers 团队共享技能

> [obra/superpowers](https://github.com/obra/superpowers) 在本仓库的入库共享安装说明。本文件是运行时配置锚点（与 `docs/agents/` 下其他文件同层），权威规则以 `CLAUDE.md` 为准。

## 版本

| 项 | 值 |
|---|---|
| superpowers | 6.1.1 |
| 上游 tag | `v6.1.1` |
| 上游 SHA | `c984ea2e7aeffdcc865784fd6c5e3ab75da0209a` |
| 锁定日期 | 2026-07-13 |
| 协议 | MIT（见 `.superpowers/LICENSE`） |

版本与 SHA 记录在 `.superpowers/VERSION`。

## 三端安装策略

| Harness | 来源 | 入库 | SessionStart 注入 |
|---------|------|------|------------------|
| **Claude Code** | `.claude/skills/`（同步自权威源） | ✅ | `.claude/hooks/superpowers-session-start.sh` |
| **ZCode** | `.zcode/skills/`（同步自权威源） | ✅ | 同上（`.zcode/config.json` 注册） |
| **Codex** | 各自本地官方插件 | ❌ | 由本地插件 SessionStart 钩子处理 |

### 为什么 Codex 不入库

Codex 已通过官方插件市场安装并启用（`~/.codex/config.toml` → `[plugins."superpowers@claude-plugins-official"] enabled=true`，缓存在 `~/.codex/plugins/cache/claude-plugins-official/superpowers`）。各成员本地自行维护，不走仓库副本。

### 为什么 Claude Code 改入库（而非继续用本地插件）

之前 Claude Code 也用本地插件（`~/.claude/plugins/cache/claude-plugins-official/superpowers`，`enabledPlugins` 曾为 `true`）。改为入库共享后：

- 新成员 clone 即得，无需本地装插件。
- 全团队技能版本统一，不依赖各人本地插件版本。
- `.claude/settings.json` 的 `enabledPlugins."superpowers@claude-plugins-official"` 已设为 `false`（保留键，便于回溯）。本地插件若仍存在不会被加载，可手动卸载。

## 目录布局（刻意对齐上游）

```
.superpowers/                 # 唯一权威源
├── skills/                   # 14 个 skill（与上游同名）
├── hooks/
│   ├── session-start         # 官方 SessionStart 脚本（PLUGIN_ROOT 自解析）
│   └── run-hook.cmd          # polyglot 分发器（Windows 兼容）
├── VERSION                   # 版本 + 上游 SHA
├── LICENSE                   # 上游 MIT
└── README.md                 # 维护契约

.claude/skills/<14 skills>    # Claude Code 运行时副本（同步自权威源）
.zcode/skills/<14 skills>     # ZCode 运行时副本（同步自权威源）
```

`hooks/` 与 `skills/` 保持同级——`hooks/session-start` 用 `PLUGIN_ROOT=$(脚本父目录)` 自解析路径，读 `../skills/using-superpowers/SKILL.md`。**改动此布局会破坏钩子。**

## 14 个 skill 清单

`brainstorming` · `dispatching-parallel-agents` · `executing-plans` · `finishing-a-development-branch` · `receiving-code-review` · `requesting-code-review` · `subagent-driven-development` · `systematic-debugging` · `test-driven-development` · `using-git-worktrees` · `using-superpowers` · `verification-before-completion` · `writing-plans` · `writing-skills`

> 名称与本项目 mattpocock skills（`tdd` / `code-review` / `diagnosing-bugs` / `grilling` 等）**零冲突**。

### `.claude/skills/` 与 `.zcode/skills/` 物理一致

两端各 41 个 skill 目录 = 14 个 superpowers（本节）+ 27 个 mattpocock。mattpocock skill 的权威源是 `.claude/skills/`（已含 Gitee 适配，git 跟踪、团队共享），需同步到 `.zcode/skills/` 以保证 ZCode 客户端可发现——`.agents/skills/` 被 `.gitignore` 忽略、仅为本地副本，不作发现依据。

> 维护提示：新增或修改 mattpocock skill 后，需手动同步 `.claude/skills/` → `.zcode/skills/`（本仓库尚无 mattpocock 专用同步脚本，不像 superpowers 有 `sync-superpowers-skills.sh`）。

## 维护契约

### 唯一权威源 = `.superpowers/`

任何 skill 内容修订都先改 `.superpowers/skills/<name>/`，再跑同步脚本推到 `.claude/skills/` 与 `.zcode/skills/`。**禁止直接改两端副本**——下次同步会覆盖。

### 同步

```bash
scripts/sync-superpowers-skills.sh           # 真实同步
scripts/sync-superpowers-skills.sh --dry-run # 仅报告差异，不写入
```

脚本只同步白名单内的 14 个 skill 名，**不触碰** mattpocock skills（如 `tdd`、`grilling`）。带 VERSION 一致性校验。

### 升级上游

1. 更新 `.superpowers/`（`skills/` + `hooks/` + `VERSION` + `LICENSE`）从新版本 tag。
2. 跑同步推到两端：`scripts/sync-superpowers-skills.sh`。
3. 提交全部改动（走 `scripts/commit-task-for-review.sh`）。

## SessionStart 钩子

`.claude/hooks/superpowers-session-start.sh` 在 Claude Code 与 ZCode 的 SessionStart 事件（`startup|clear|compact|resume`）注入 `using-superpowers` 引导文本。

- 复用官方 `using-superpowers/SKILL.md` 全文。
- 输出平文（与本仓现有 `cbm-session-reminder.sh` 风格一致；官方插件版的 JSON 输出格式不适用于本仓的平文注入约定）。
- 注入文本含前置声明：服从 CLAUDE.md、`using-git-worktrees` 的 declared preference = `scripts/start-task-worktree.sh`。
- 上游 SKILL.md 本身声明「User instructions (CLAUDE.md, AGENTS.md...) take precedence over skills」——天然与本仓兼容。

## 与 CLAUDE.md 的关系

superpowers 是**可选方法论技能**，不替代 CLAUDE.md 的 git/issue 工作流硬规则。关键约束：

- **`using-git-worktrees`**：declared preference = `scripts/start-task-worktree.sh`（满足该 skill Step 1a）。本 skill 检测到 declared preference 后跳过自带 `git worktree add` 兜底（Step 1b 在本项目永不执行），所有可写任务仍走 CLAUDE.md 红线 #4 入口。
- **`using-superpowers` 的「任何回应前先调 skill」**：服从 CLAUDE.md「先完整读 CLAUDE.md」与红线 #4。CLAUDE.md 保持团队 Agent 规则唯一权威源。
