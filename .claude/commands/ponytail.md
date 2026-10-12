---
description: 加载本仓共享 ponytail 技能
argument-hint: "[lite|full|ultra|off|default <档位>]"
---

读取并执行 `.agents/skills/ponytail/SKILL.md`，参数为 `$ARGUMENTS`。共享技能是唯一正文来源，Claude 技能映射继续使用 `.claude/skills`。

当前档位由项目生命周期 Hook 管理。按 Hook 报告执行对应档位，只有显式 default 操作改变下次会话默认值。
