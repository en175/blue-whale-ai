# 工程技能客户端验收

## Qoder

2026-09-28 在新建的 IKIQR7 Git 工作树验证。Qoder CN IDE 内置桥接入口为 `/Applications/Qoder CN IDE.app/Contents/Resources/app/bin/qodercn`，`--version` 返回 `1.1.45`。该工作树的 `.qoder/` 只有已跟踪的 `settings.json`，项目技能直接来自 `.agents/skills`，无须新增 Qoder 专用目录。

在工作树根目录运行 `'/Applications/Qoder CN IDE.app/Contents/Resources/app/bin/qodercn' skills list`，权威目录中有 `SKILL.md` 的 48 个技能名均出现在列表中，`gitee-collab` 不在列表中，同名条目没有重复。46 个条目的最终 `Location` 指向本工作树的 `.agents/skills`；`graphify` 和 `write-rules` 也被发现，但本机个人目录中的同名技能覆盖了项目版本。该冲突来自个人配置，仓库没有修改个人目录。因此，本机最终生效来源并非全部 48 个项目文件。

运行上述 CLI 入口并传入 `--print --no-session-persistence --cwd <本工作树> '/implement-spec 只读取本技能，不执行步骤，也不调用任何工具。请用一句中文指出该技能要求建立哪种分支。'`，CLI 输出 `Skill **implement-spec** activated.`，随后模型服务返回 `Access to model denied`。这证明显式命令激活了项目技能；模型未生成回答，完整调用结果仍待可用模型复验。

失败场景使用临时 Git 仓库：同时放入 `.agents/skills/implement-spec/SKILL.md` 和旧的 `.qoder/skills/implement-spec/SKILL.md`，并在旧目录放入未知文件 `keep-unknown.txt`。`skills list` 退出码为 0，但明确报告旧 Qoder 文件覆盖 Agent 同名技能，最终 `Location` 指向旧副本。调用前后未知文件的 SHA-256 一致。测试结束后临时仓库自动清理，未触碰成员个人技能目录。已有被忽略的旧副本会破坏单一来源，迁移时须先报告并保全未知内容。

## IKIQRD 最终子票工作树

2026-09-28 在 `chore-ikiqrd` 新工作树核对。`python3 scripts/check-project-skills.py` 通过，发现 48 个 Git 跟踪的项目技能和指向同工作树的 Claude 链接；它还报告了个人同名技能。这是仓库配置检查，以下为独立的客户端结果。显式调用统一要求 `/implement-spec` 只回答技能要求的分支，不执行任务或工具。

| 客户端 | 项目技能发现及来源 | 显式调用 | 项目重复项 |
| --- | --- | --- | --- |
| Codex CLI 0.146.0 | 仓库入口已检查；CLI 没有取得可核对的项目技能列表，实际加载来源未验证 | `codex exec --ephemeral -s read-only` 等待 45 秒无回答，调用未验证 | 未验证 |
| Kimi Code CLI 0.42.0 | 仓库入口已检查；CLI 没有取得可核对的项目技能列表，实际加载来源未验证 | `kimi -p` 等待 45 秒无回答，调用未验证 | 未验证 |
| Claude Code 2.1.218 | `.claude/skills` 链接指向本工作树 Agent 目录，本机无个人 `implement-spec` 同名技能；显式调用回答了技能要求的集成分支 | `claude --permission-mode plan -p` 返回正确答案 | 本次没有独立技能列表核验；项目目录只有一个入口 |
| ZCode CLI 0.16.9 | `skills list --json` 列出 48 个项目技能，`source=agents`，路径均在本工作树 `.agents/skills` | `-p` 返回 `无法定位 CLI ZCode Built-in Provider Config`，未取得模型答案 | 列表中项目名称无重复 |
| Qoder CLI 1.1.45 | `skills list` 发现全部 48 个项目技能，其中 46 个生效路径在本工作树 `.agents/skills`；`graphify` 和 `write-rules` 被个人同名技能覆盖 | 本工作树的 `--print` 调用返回 `Access to model denied`，未取得模型答案；再次尝试等待 25 秒超时 | 列表中项目来源路径无重复；个人覆盖 2 项 |

上述未验证项不按通过处理。Kimi 首次试用的 `--plan` 与 `-p` 参数冲突，表中只记录改用合法 `-p` 后的结果。Codex、Kimi、ZCode 和 Qoder 的完整调用仍需在各自模型服务可用时复验；本次没有修改个人目录或客户端配置。
