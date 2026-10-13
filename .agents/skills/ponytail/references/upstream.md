# Ponytail 固定来源

本仓来源为 [Ponytail v5.1.0](https://github.com/DietrichGebert/ponytail/releases/tag/v5.1.0)，完整提交 `9cc65d03aa2da1db7121b912d03596409ee340b8`。导入时通过 Git tag 和精确提交归档交叉核验。更新必须重新固定版本并审查，不跟随 main。

[MIT 许可证](../LICENSE.md)保留上游原文。六个共享技能均标明 MIT。

| 上游内容 | 本仓内容与补丁 |
|----------|----------------|
| `skills/ponytail*/SKILL.md` 六技能 | `.agents/skills/ponytail*/SKILL.md`，采用新版完整任务、质量审查、双债务标记和基准。译为中文，保留 CBM、测试框架、普通注释禁令和团队审查规则。 |
| `commands/ponytail*.toml` 六命令 | `.claude/commands/ponytail*.md`，按 Claude 命令格式映射到共享正文，不复制正文。 |
| activate、config、instructions、mode-tracker、runtime、subagent 六脚本 | `.claude/hooks/ponytail*.js`，清理普通注释。保留上游停用、默认解析、裸命令恢复、一次性 review、Codex 协议修复和子代理正则超时。 |
| `hooks/ponytail-map.js` | 同名脚本，概览提示改为中文，强调 CBM 优先。只提供有界辅助线索。 |
| `hooks/ponytail-statusline.sh` 与 `.ps1` | 同名薄入口加 `ponytail-statusline.js`，使用当前工作树的共享运行状态，不读取全局最后档位，不自动写用户设置或个人脚本。 |

本地生命周期补丁采用显式客户端身份、实际工作树根目录和私有状态根目录，客户端与工作树隔离。显式切档给 Codex、Claude 都注入新档位完整正文；非法额外参数不改档。共享正文缺失时只交付带未验收提示的最小备用约束。旧 review 不再是运行档位。

保留 `.claude/skills -> ../.agents/skills` 的 Git 映射与 `.agents/skills` 发现入口。Ponytail 配置不改变原安全 Hook、授权或审计策略。

安装与能力边界见 [维护说明](../../../../docs/agents/ponytail.md)。
