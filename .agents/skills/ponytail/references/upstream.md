# Ponytail 固定来源

本仓共享正文与原有多端适配来自 [Ponytail v5.1.0](https://github.com/DietrichGebert/ponytail/releases/tag/v5.1.0)，完整提交 `9cc65d03aa2da1db7121b912d03596409ee340b8`。Codex 单独对齐 [v5.3.2](https://github.com/DietrichGebert/ponytail/releases/tag/v5.3.2)，完整提交 `16352ac229eb08a9598dcae48fe9f2b342567d86`。2026-10-17 已核对远端 main 与 v5.3.2 标签均指向该提交。更新固定版本并审查，不跟随 main。

Codex 补入压缩上下文保档、退出前同步输出、概览路径与符号过滤、跳过符号链接，以及概览子进程的一秒超时。正文继续读取当前工作树的中文共享技能，成功加载时输出 `upstream: v5.3.2` 标记；缺正文时仍报告备用规则。新增行为仅由 Codex 路径启用，其他客户端保留原有行为与安装。

v5.1.0 到 v5.3.2 的 Codex 相关上游差异均已核对：review、audit 正文、instructions 与 subagent 实现未变；debt 与 gain 的一次性语义已由本地正文覆盖，债务扫描使用遵守忽略规则的 rg。主技能新增 off 参数提示已由本地正文支持。help 的 Band 内容仅适用于 Claude，config 的 Qoder 目录支持和 Node 12 插件启动器不适用于本仓直接 Node 入口。保留中文、CBM、现有测试框架、注释禁令和桌面精确技能引用解析。

同客户端、同工作树仍共享档位，没有会话 ID 隔离；上游 v5.3.2 也保留此限制。Codex 的 startup、resume、clear 使用默认值，compact 保留当前档位及关闭状态。CLI 与桌面真实 Hook 接收另行验收，配置链通过不代表实机通过。

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
