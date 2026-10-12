# Kimi Code 的 Ponytail 安装与迁移

在当前仓库工作树运行：

```bash
bash scripts/install-kimi-hooks.sh
```

安装前确认非交互 PATH 能执行 `node --version` 和 Python 3.11 以上的 `python3`。安装器使用 Python 标准库 `tomllib` 读取 TOML，不下载依赖、不升级 Kimi。入口沿用 Bash 与 POSIX shell 的用户配置形式；本票在 macOS 验证，Windows 实机未验收。共享规则固定为 Ponytail v5.1.0，来源提交 `9cc65d03aa2da1db7121b912d03596409ee340b8`，版本与本仓差异见[来源记录](../../.agents/skills/ponytail/references/upstream.md)。

## 安装与更新

1. 从仓库运行上述入口。它更新 `$KIMI_CODE_HOME/config.toml` 中已有的受管理片段，默认目录为 `~/.kimi-code`。既有安全 Hook 继续使用原 Bash 入口，Ponytail 使用独立的 Node 入口。
2. 开启新的 Kimi 会话。安装器重复运行不会增加 Hook；仓库更新后重跑入口，同步用户薄适配与受管理配置。
3. 在会话中核对六个 `/skill:ponytail` 系列技能。Kimi 从项目 `.agents/skills` 发现共享正文，用户入口通过载荷 `cwd` 和 Git 工作树根定位当前项目。不会把某个成员的绝对路径或全局正文写入仓库。[Kimi 技能目录与调用方式](https://moonshotai.github.io/kimi-code/en/customization/skills)

用户入口位于 `.kimi-code/hooks/ponytail-hook.js`，安装后复制到用户 Hook 目录；它只路由项目。项目 `.claude/hooks/ponytail-kimi.js` 规范 `/skill:ponytail` 调用前缀，复用共享 tracker、runtime 和 instructions，不保存第二套规则或档位策略。未提供项目配置及项目适配器的其他仓库保持静默。

## 档位与使用

新会话的 SessionStart 只重置档位，不输出上下文。UserPromptSubmit 输出当前档位的完整共享规则，采用 Kimi 的文本协议。仅注册这两个 Ponytail 事件。配置只使用 `event`、`command`、`timeout` 字段，保留其他 Hook 原有的 `matcher`。[Kimi Hook 协议](https://moonshotai.github.io/kimi-code/en/customization/hooks)

| 操作 | 结果 |
| --- | --- |
| `/skill:ponytail lite`、`full`、`ultra` | 切换当前 Kimi 工作树档位，当轮与后续输入均加载对应正文。 |
| `/skill:ponytail off`、`stop ponytail`、`normal mode` | 关闭当前范围，后续普通输入保持关闭。 |
| `/skill:ponytail` | 已激活时报告当前档位；关闭时恢复配置默认值，默认 off 时恢复 full。 |
| `/skill:ponytail default lite` | 只改变后续新会话默认值，当前档位保持不变。支持 off、lite、full、ultra。 |
| `/skill:ponytail-review`、`audit`、`debt`、`gain`、`help` | 运行对应一次性技能，当前持久档位保持不变。完整命令分别为 `/skill:ponytail-audit` 等。 |

默认值按 `PONYTAIL_DEFAULT_MODE`、共享用户配置、full 顺序解析。非法参数保持原档位。运行状态按客户端和真实 Git 工作树隔离，Kimi、Codex、Claude 及 linked worktree 不相互串档。同一客户端、同一工作树的并发会话仍共享最后写入档位，新会话重置也会影响该范围。对子代理派单时明确要求读取当前共享 Ponytail 技能，本适配没有自动子代理注入证据。

## 旧全局条目与卸载

安装器仅迁移已确认的两个旧条目。它们分别属于 SessionStart、UserPromptSubmit，`timeout = 5`，且 command 精确为下列形式：

```text
node "$HOME/.config/ponytail/kimi-hook.js" SessionStart
node "$HOME/.config/ponytail/kimi-hook.js" UserPromptSubmit
```

迁移只移除这些 Hook 配置，不删除旧全局脚本或用户数据。未知 Ponytail 条目保留并报告。出现报告时核对其来源；确认重复后再停用对应来源，不能把归属不明的个人 Hook 当成旧安装。不要同时启用会注入同一规则的原生插件；本票保留持久档位适配，没有迁移到上游不保存档位的原生插件。

卸载本仓受管理的 Kimi Hook：

```bash
bash scripts/install-kimi-hooks.sh --uninstall
```

该入口沿用既有卸载范围，移除本仓受管理配置块、用户安全 shim 与用户 Ponytail shim。其他个人设置和未管理 Hook 保留；共享技能、旧全局脚本和运行状态保留。只需暂停 Ponytail 时用 off，保留安全 Hook。

## 验证记录与实机步骤

2026-10-12，本机 `kimi --version` 为 0.42.0。临时 `KIMI_CODE_HOME` 下的 `kimi doctor` 接受完整受管理配置。统一配置链通过 subprocess 验证真实正文、四档、切换、关闭、裸命令恢复、default、一次性命令、跨客户端与项目及工作树隔离、首次与重复安装、更新、精确迁移、整轮一次正文注入和卸载。测试隔离 HOME 与配置，不读取真实个人状态。

```bash
python3 -m unittest discover -s scripts/tests -p 'test_*ponytail*.py' -v
```

上述结果证明脚本和配置链行为。真实 Kimi 模型上下文、技能展开与 Hook 执行顺序尚未验收；其他客户端版本也未由本票证明兼容。当前官方文档不自动证明 0.42.0 的全部运行行为。

1. 在成员选择的项目运行安装器，开启新会话，记录 Kimi 版本、加载路径与共享来源提交。
2. 提交普通开发输入，检查实际上下文含当前项目完整 full 正文，并保留上下文或调试证据。
3. 执行 `/skill:ponytail lite`，检查当轮及下一次普通输入只加载一份 lite 正文；逐项核对关闭、裸命令恢复与五个一次性技能。
4. 开启另一个项目或 linked worktree，验证独立档位；在未启用本适配的仓库验证没有 Ponytail 注入。
5. 在验收记录中单列结果和缺口。没有模型上下文证据时保留未验收状态，不用 doctor 或脚本 PASS 替代。
