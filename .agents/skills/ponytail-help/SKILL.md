---
name: ponytail-help
description: >
  查看 Ponytail 档位、一次性技能、关闭与默认值设置。
  适用于 ponytail help 或使用说明。一次性展示，不改变持久档位。
license: MIT
---

# Ponytail 使用说明

显示当前仓库的命令说明，保持运行档位，不写状态或配置。

Codex 本地共享技能用 `$ponytail`、`$ponytail-review` 等美元符号形式；Claude Code 用 `/ponytail`、`/ponytail-review` 等斜杠形式。此处不是全局插件命名空间，避免使用旧 `@ponytail` 或 `$ponytail:ponytail` 安装说明。

| 操作 | 行为 |
|------|------|
| `ponytail lite` | 实现要求，并列出更小方案。 |
| `ponytail full` | 最小完整改动，默认档位。 |
| `ponytail ultra` | 实施前质疑缺少依据的需求。 |
| 裸 `ponytail` | 激活时报告当前档位；关闭时恢复默认，默认 off 时恢复 full。 |
| `ponytail off`、`stop ponytail`、`normal mode` | 关闭当前范围，普通输入不重新激活。 |

review、audit、debt、gain、help 都是一次性命令，执行前后持久档位相同。review 检查改动；audit 检查全仓；debt 汇总存量标记；gain 展示公开基准；help 显示此说明。

新会话默认值按环境变量、用户配置、full 顺序解析，支持 off、lite、full、ultra：

```bash
export PONYTAIL_DEFAULT_MODE=ultra
```

用户配置为 `$XDG_CONFIG_HOME/ponytail/config.json`，未设置 XDG 时为 `~/.config/ponytail/config.json`，Windows 为 `%APPDATA%\ponytail\config.json`：

```json
{ "defaultMode": "lite" }
```

显式 `ponytail default lite` 设置后续会话默认值，保持当前档位。普通切档不写默认值。非法参数保持当前档位。

状态按客户端和工作树隔离，同一客户端同一工作树的并发会话共享最后写入档位。启动、恢复、清空和压缩事件重新应用默认值；不能把工作树隔离称为完整会话隔离。

本仓固定 v5.1.0，随经过团队审查的仓库更新，不自动跟随上游 main。安装、Node 可用性、Codex Hook 信任、子代理能力和实机验收边界见 [维护说明](../../../docs/agents/ponytail.md)。
