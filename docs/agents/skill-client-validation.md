# 工程技能客户端验收

## Qoder

2026-09-28 在新建的 IKIQR7 Git 工作树验证。Qoder CN IDE 内置桥接入口为 `/Applications/Qoder CN IDE.app/Contents/Resources/app/bin/qodercn`，`--version` 返回 `1.1.45`。该工作树的 `.qoder/` 只有已跟踪的 `settings.json`，项目技能直接来自 `.agents/skills`，无须新增 Qoder 专用目录。

在工作树根目录运行 `'/Applications/Qoder CN IDE.app/Contents/Resources/app/bin/qodercn' skills list`，权威目录中有 `SKILL.md` 的 48 个技能名均出现在列表中，`gitee-collab` 不在列表中，同名条目没有重复。46 个条目的最终 `Location` 指向本工作树的 `.agents/skills`；`graphify` 和 `write-rules` 也被发现，但本机个人目录中的同名技能覆盖了项目版本。该冲突来自个人配置，仓库没有修改个人目录。因此，本机最终生效来源并非全部 48 个项目文件。

运行上述 CLI 入口并传入 `--print --no-session-persistence --cwd <本工作树> '/implement-spec 只读取本技能，不执行步骤，也不调用任何工具。请用一句中文指出该技能要求建立哪种分支。'`，CLI 输出 `Skill **implement-spec** activated.`，随后模型服务返回 `Access to model denied`。这证明显式命令激活了项目技能；模型未生成回答，完整调用结果仍待可用模型复验。

失败场景使用临时 Git 仓库：同时放入 `.agents/skills/implement-spec/SKILL.md` 和旧的 `.qoder/skills/implement-spec/SKILL.md`，并在旧目录放入未知文件 `keep-unknown.txt`。`skills list` 退出码为 0，但明确报告旧 Qoder 文件覆盖 Agent 同名技能，最终 `Location` 指向旧副本。调用前后未知文件的 SHA-256 一致。测试结束后临时仓库自动清理，未触碰成员个人技能目录。已有被忽略的旧副本会破坏单一来源，迁移时须先报告并保全未知内容。
