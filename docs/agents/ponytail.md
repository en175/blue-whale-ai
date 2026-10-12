# Ponytail 安装与维护

先拉取本任务交付的仓库版本，确认非交互进程能执行 `node --version`。这份说明适用于仓库固定的 v5.1.0，来源提交为 `9cc65d03aa2da1db7121b912d03596409ee340b8`。完整导入清单、补丁与 MIT 见[来源记录](../../.agents/skills/ponytail/references/upstream.md)。

## Codex 与 Claude Code

1. 在当前工作树运行 `node --version`。Node 必须在 Hook 启动的非交互 PATH 中可用，不能只依赖交互式 shell 的别名。脚本只用 Node 标准库。
2. Codex 在项目 `.codex` 层受信任后加载 `.codex/hooks.json`。CLI 用 `/hooks` 审查并信任当前 Hook 定义；定义更新后重新信任。项目层同时保留 inline `[hooks]` 和 `hooks.json` 会重复加载并提示警告，每层只选一种表示。桌面端按其 Hook 信任界面完成相同操作。
3. Claude Code 从 `.claude/settings.json` 加载项目 Hook。保留 `.claude/skills -> ../.agents/skills` 的 Git 符号链接；平台未保留映射时先修复技能安装，不用备用规则代替验收。
4. 更新后重载客户端或开启新会话。在新会话核对实际上下文正文、切档、关闭、裸命令恢复和支持的子代理注入。配置链脚本成功不等于实机上下文验收。

Codex 用 `$ponytail`，Claude Code 用 `/ponytail`。六个共享技能位于 `.agents/skills`；六个 Claude 命令只指向共享正文。review、audit、debt、gain、help 是一次性任务，不写运行档位。质量审查增加正确性、安全、负载、测试、性能和简化检查，仍需执行团队 Standards/Spec 审查与测试凭证流程。

新会话默认值按 `PONYTAIL_DEFAULT_MODE`、用户配置、full 顺序解析。用户配置定位规则由 `ponytail-config.js` 维护。`ponytail default <档位>` 只改变下次启动默认值；普通切档只改变当前客户端、当前工作树的档位。启动、resume、clear、compact 重新应用默认值。

## 共享运行边界

适配代码只负责当前客户端的载荷和输出协议，复用 `.claude/hooks/ponytail-config.js` 的档位策略、`ponytail-instructions.js` 的正文过滤以及 `ponytail-runtime.js` 的状态管理。

| 边界 | 契约 |
|------|------|
| 客户端身份 | `PONYTAIL_CLIENT` 明确区分 codex、claude 及后续适配器，优先于继承的宿主探测变量。未传时保留上游其他宿主探测兼容。 |
| 项目定位 | `PONYTAIL_PROJECT_DIR` 优先，随后 `CLAUDE_PROJECT_DIR`，最后当前目录。使用 Git 实际工作树根与真实路径；不按 Git common dir 合并工作树。载荷中的 cwd 由适配器定位后传入。 |
| 运行状态 | 以客户端和实际工作树的组合隔离。默认落在 Ponytail 用户配置目录下，`PONYTAIL_STATE_DIR` 可为薄适配器指定私有根。不得把状态提交仓库。旧共享标记不会作为新隔离状态读取，旧 review 不能形成持久档位。 |
| 上下文 | `getPonytailInstructions(mode)` 从当前工作树 `.agents/skills/ponytail/SKILL.md` 读取对应档位正文。缺失时明确提示升级验收未通过，备用约束保留中文、CBM、测试和注释规则。 |
| 输出 | Codex 经 `hookSpecificOutput.additionalContext` 注入，包含正确事件名，不发旧 systemMessage。Claude 启动与输入保留纯正文协议，SubagentStart 使用其 JSON 上下文协议。 |

同一客户端、同一工作树的并发会话共享最后写入档位；新会话启动也会影响该范围。当前没有完整会话隔离。不同客户端、不同项目、主检出区和任务工作树相互隔离。

Codex 的三类 Ponytail 处理器设置有限的 `additionalContextLimit=6000`，为完整中文正文和默认最多 2000 字符的辅助概览留空间。保持概览有界，不用零阈值无限注入。概览采用启发式名称提取，会遗漏动态定义和嵌套定义；结构探索继续使用 CBM 并核对覆盖。

## 状态栏

Claude 状态栏是可选项。Hook 只提示一次，不写用户 settings.json、不覆盖已有 statusLine，也不复制私有脚本。仓库内 `.claude/hooks/ponytail-statusline.js` 读取客户端传来的 workspace/cwd，显示当前工作树档位；关闭时不显示。`.sh` 与 `.ps1` 是 Node 薄入口。仓库更新会更新脚本。

需要时在 Claude 用户设置配置以下命令。已经有状态栏时，在原命令中组合这一输出，保留原设置：

```json
{
  "statusLine": {
    "type": "command",
    "command": "PONYTAIL_CLIENT=claude node \"$(git rev-parse --show-toplevel)/.claude/hooks/ponytail-statusline.js\""
  }
}
```

上述命令面向 macOS、Linux 和 Git Bash。Windows PowerShell 可用仓库中的 `.claude/hooks/ponytail-statusline.ps1`，按真实工作树路径配置，Node 仍需在 PATH 中。本票脚本测试在 macOS 执行，PowerShell 实机未验收。不要将旧全局插件缓存中的状态栏路径继续作为当前版本依赖。

## 重复加载排查与卸载

项目 Hook 与全局 Ponytail 插件同时生效时，一轮可能收到两份规则。先通过客户端 Hook 列表确认每个来源，禁用已确认重复的全局 Ponytail 条目；归属不明时保留并报告。不触碰其他插件、安全 Hook 或个人设置。

项目配置由 Git 维护。需要停用时先设置默认 off 或当前范围执行 ponytail off。卸载项目 Ponytail 时只移除 SessionStart、UserPromptSubmit、SubagentStart 中的 Ponytail command 处理器以及自己添加的状态栏段，保留其他 Hook。Kimi 与 ZCode 的受管理安装、迁移和卸载由后续适配票提供，本票没有执行成员本机迁移。

## 验证边界

本票验证命令：

```bash
python3 -m unittest scripts.tests.test_codex_ponytail_hooks -v
python3 -m unittest discover -s scripts/tests -p 'test_*ponytail*.py' -v
python3 scripts/check-hook-contracts.py
bash scripts/test-hooks.sh
```

Python 要求能读取现有 Kimi TOML 的版本；本仓验证环境使用 Python 3.12。统一配置链接缝的 `PonytailConfigHarness` 位于 `scripts/tests/test_codex_ponytail_hooks.py`，负责隔离用户目录、安装真实共享技能、读取实际配置并执行 subprocess。后续客户端的场景放独立测试文件，复用此接缝，不复制安全 Gate 策略。

当前配置链覆盖两端正文、完整档位生命周期、默认设置、一次性命令、不同项目与 linked worktree、子代理、缺技能、概览、债务旧标记和状态栏。Codex CLI、Codex 桌面端、Claude、Kimi、ZCode 的真实上下文验收仍由最终验收票逐项记录客户端版本、来源、场景和结果。脚本 PASS 不关闭实机待办。

信任与输出边界依据 [Codex Hook 文档](https://learn.chatgpt.com/docs/hooks)、[Codex 项目配置](https://learn.chatgpt.com/docs/config-file/config-advanced#hooks)、[Claude Hook 文档](https://code.claude.com/docs/en/hooks)和 [Claude 状态栏文档](https://code.claude.com/docs/en/statusline)。
