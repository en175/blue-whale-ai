# Superpowers 团队共享技能

> [obra/superpowers](https://github.com/obra/superpowers) 在本仓库的入库共享安装说明。本文件是运行时配置锚点（与 `docs/agents/` 下其他文件同层），权威规则以 `CLAUDE.md` 为准。

## 版本

| 项 | 值 |
|---|---|
| superpowers | 6.4.1 |
| 上游 tag | `v6.4.1` |
| 上游 SHA | `5bf4e78011075bcfc0dc295f0724994cd123ee71` |
| 锁定日期 | 2026-09-19 |
| 协议 | MIT（见 `.superpowers/LICENSE`） |

版本与 SHA 记录在 `.superpowers/VERSION`。

## 精简记录（2026-09-23）

- 由 14 个 skill 精简为 2 个：`receiving-code-review`、`requesting-code-review`。其余 12 个（brainstorming、`dispatching-parallel-agents`、`executing-plans`、`finishing-a-development-branch`、`subagent-driven-development`、`systematic-debugging`、`test-driven-development`、`using-git-worktrees`、`using-superpowers`、`verification-before-completion`、`writing-plans`、`writing-skills`）按需求移除。
- 保留的 2 个 skill 与上游 `v6.4.1`（当前 main 最新提交）零差异，无待拉更新。
- `requesting-code-review` 的 SKILL.md 有一处描述性提及 "subagent-driven development"（任务完成时机说明），非功能依赖，删除 `subagent-driven-development` 不影响其运行。
- SessionStart 注入钩子随 `using-superpowers` 退役：`.superpowers/hooks/`、`.claude/hooks/superpowers-session-start.sh` 及 `.claude/settings.json` / `.zcode/config.json` 两处注册已删除。
- 同步脚本 `scripts/sync-superpowers-skills.sh` 白名单同步缩为 2 个 skill 名。

## 三端安装策略

| Harness | 来源 | 入库 |
|---------|------|------|
| **Claude Code** | `.claude/skills/`（同步自权威源） | ✅ |
| **ZCode** | `.zcode/skills/`（同步自权威源） | ✅ |
| **Codex** | 各自本地官方插件 | ❌ |

### 为什么 Codex 不入库

Codex 已通过官方插件市场安装并启用（`~/.codex/config.toml` → `[plugins."superpowers@claude-plugins-official"] enabled=true`，缓存在 `~/.codex/plugins/cache/claude-plugins-official/superpowers`）。各成员本地自行维护，不走仓库副本。

### 为什么 Claude Code 改入库（而非继续用本地插件）

之前 Claude Code 也用本地插件（`~/.claude/plugins/cache/claude-plugins-official/superpowers`，`enabledPlugins` 曾为 `true`）。改为入库共享后：

- 新成员 clone 即得，无需本地装插件。
- 全团队技能版本统一，不依赖各人本地插件版本。
- `.claude/settings.json` 的 `enabledPlugins."superpowers@claude-plugins-official"` 已设为 `false`（保留键，便于回溯）。本地插件若仍存在不会被加载，可手动卸载。

## 目录布局

```
.superpowers/                 # 唯一权威源
├── skills/                   # 2 个 skill（receiving-code-review、requesting-code-review）
├── VERSION                   # 版本 + 上游 SHA
├── LICENSE                   # 上游 MIT
└── README.md                 # 维护契约

.claude/skills/<2 skills>     # Claude Code 运行时副本（同步自权威源）
.zcode/skills/<2 skills>      # ZCode 运行时副本（同步自权威源）
```

## skill 清单

`receiving-code-review` · `requesting-code-review`

> 名称与本项目 mattpocock skills（`tdd` / `code-review` / `diagnosing-bugs` / `grilling` 等）**零冲突**。

### `.claude/skills/` 与 `.zcode/skills/` 物理一致

mattpocock skill 的权威源是 `.claude/skills/`，团队副本位于 `.zcode/skills/`。Codex 和 Kimi Code 从项目 `.agents/skills/` 发现技能，Qoder 从 `.qoder/skills/` 发现技能。这两个目录保持 Git 忽略，不写入用户全局技能目录。其他 mattpocock 技能仍需按使用端手动同步完整目录。

### implement-spec 的五端同步

修改 `.claude/skills/implement-spec/` 后，在当前任务 worktree 执行：

```bash
python3 scripts/sync-implement-spec-skill.py
python3 scripts/sync-implement-spec-skill.py --check
```

入口只同步 `implement-spec`，包含 `SKILL.md`、`references/` 和 `agents/openai.yaml`。目标为 `.zcode/skills/implement-spec/`、`.agents/skills/implement-spec/` 和 `.qoder/skills/implement-spec/`。已有 `.kimi-code/skills/implement-spec/` 时也同步该副本，避免 Kimi 优先读取旧内容。`--dry-run` 只列差异，`--check` 在缺失或内容不一致时返回非零。目标中的额外文件或符号链接须先核查，入口保留它们并停止，不删除未知内容。

新建 worktree 后，需要使用本技能的 Codex、Kimi Code、Qoder 客户端先在该 worktree 运行同步入口。修改合入发布线后，再在需要使用技能的其他 worktree 同步各自已检出的版本；不将尚未合入的技能复制到发布线工作树。此入口不自动遍历其他工作树，也不调用模型或发布 PR。

客户端发现目录的依据见 [Codex 技能文档](https://developers.openai.com/codex/skills)、[Kimi Code 技能文档](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html) 和 [Qoder 技能文档](https://docs.qoder.com/cli/Skills)。同步后核对各客户端的技能列表、来源路径及显式调用设置；复制成功本身不证明客户端已加载。已有会话未刷新时新建会话或重启客户端。五端读取相同的英文正文，客户端特有的调用限制由原有 frontmatter 和 `agents/openai.yaml` 保留。

## 维护契约

### 唯一权威源 = `.superpowers/`

任何 skill 内容修订都先改 `.superpowers/skills/<name>/`，再跑同步脚本推到 `.claude/skills/` 与 `.zcode/skills/`。**禁止直接改两端副本**——下次同步会覆盖。

### 同步

```bash
scripts/sync-superpowers-skills.sh           # 真实同步
scripts/sync-superpowers-skills.sh --dry-run # 仅报告差异，不写入
```

脚本只同步白名单内的 2 个 skill 名，**不触碰** mattpocock skills（如 `tdd`、`grilling`）。带 VERSION 一致性校验。

### 升级上游

1. 从新版本 tag 更新 `.superpowers/skills/`（只取保留的 2 个 skill）与 `VERSION`。
2. 跑同步推到两端：`scripts/sync-superpowers-skills.sh`。
3. 提交全部改动（走 `scripts/commit-task-for-review.sh`）。

## 与 CLAUDE.md 的关系

superpowers 是**可选技能**，不替代 CLAUDE.md 的 git/issue 工作流硬规则。CLAUDE.md 保持团队 Agent 规则唯一权威源。
