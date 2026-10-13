# ZCode 的 Ponytail 安装与维护

在 ZCode 中添加当前工作树的 `.zcode/plugins` 本地市场，安装并启用 `blue-whale-ponytail`。本仓插件版本为 `1.0.0`，规则使用共享的 Ponytail v5.1.0，固定来源提交为 `9cc65d03aa2da1db7121b912d03596409ee340b8`。共享来源、MIT 许可证和档位契约见 [Ponytail 维护说明](ponytail.md)。

截至 2026-10-12 查阅的 [ZCode Hook 官方文档](https://zcode.z.ai/cn/docs/hooks)，项目 `.zcode/config.json` 中的 Hook 会被忽略，日志记录 `config_project_hooks_ignored`。本仓保留该文件中的 Ponytail 条目用于历史配置及协议回归；当前支持入口是插件，不能用项目配置链测试证明客户端已经加载。

## 安装

1. 打开需要使用 Ponytail 的 Git 工作树，确认非交互 PATH 可以执行 `node --version`。该工作树的 `.zcode/ponytail.json` 必须为 `{"enabled": true}`。插件按事件载荷中的 `cwd` 定位实际工作树，其他项目静默。
2. 在「设置 → 插件 → 创建 → 添加插件市场」选择当前工作树的 `.zcode/plugins` 目录。该目录包含 `marketplace.json`，条目用相对路径指向 `ponytail` 插件。按 [ZCode 插件官方说明](https://zcode.z.ai/cn/docs/plugin)添加本地市场后，在个人市场中安装 `blue-whale-ponytail`，确认版本 `1.0.0` 并启用。
3. 在「设置 → Hooks」核对插件来源以及 `SessionStart`、`UserPromptSubmit` 两个事件。处理器为同步 Node process，超时为 5000 毫秒。标准 `hooks/hooks.json` 自动加载，manifest 不再重复声明该文件。已有全局 Ponytail Hook 或插件时先停用重复入口，保留其他 Hook。
4. 在「设置 → 技能 → 导入」中选取当前工作树共享的六个技能，选择软链、当前项目并启用。名称为 `ponytail`、`ponytail-review`、`ponytail-audit`、`ponytail-debt`、`ponytail-gain`、`ponytail-help`。来源应指向当前 `.agents/skills`，Claude 来源的 `.claude/skills` 映射也指向同一目录。导入方式与项目作用域见 [ZCode 技能官方说明](https://zcode.z.ai/cn/docs/skill)。Hook 插件本身不提供这六个技能，不能把安装 Hook 当作技能已可发现。
5. 新建会话。在 `$` 或 `/` 的技能分组检查六个名称，使用下表核验实际上下文。更换工作树后重新核对项目技能链接，避免仍指向旧工作树。

安装由成员本人在客户端完成。本票没有修改真实用户配置、自动安装插件或替成员确认信任。插件也不包含 Ponytail 规则正文。

## 新会话核验

记录客户端名称、客户端版本、插件版本、实际工作树、规则来源提交和每项结果。以下命令使用 `$ponytail`；共享解析也保留 `/ponytail` 与 `@ponytail` 形式。

| 场景 | 操作与预期结果 |
|------|----------------|
| 默认档位 | 分别以 off、lite、full、ultra 启动新会话。活动档位上下文包含真实共享正文及该档位规则；off 不注入规则。默认值解析见共享维护说明。 |
| 切档与默认值 | 输入 `$ponytail lite`、`$ponytail ultra`、`$ponytail full`，每次收到对应正文。`$ponytail default lite` 只修改后续启动默认值，当前档位不变。 |
| 关闭与恢复 | 输入 `$ponytail off` 后发送普通开发请求，不能自行恢复。输入裸 `$ponytail` 恢复默认档位；默认为 off 时恢复 full。`stop ponytail` 与 `normal mode` 也关闭。 |
| 非法参数与一次性任务 | `$ponytail bogus`、`$ponytail full extra`、`$ponytail default review` 不改档。review、audit、debt、gain、help 五个技能执行前后，裸 `$ponytail` 报告的档位相同，关闭时也不重新激活。 |
| 隔离与子代理 | 在另一个项目、linked worktree、Codex、Claude Code、Kimi 中独立切档，不影响 ZCode 当前档位。ZCode 不注册 SubagentStart，子代理必须按下方要求派单。 |

子代理派单明确给出父会话当前档位，并要求读取当前工作树 `.agents/skills/ponytail/SKILL.md`、应用该档位和团队规则。父会话为 off 时明确关闭 Ponytail。父会话的 Hook 注入不等于子代理自动收到规则。

同一工作树、同一客户端的并发会话共享最后写入档位；新会话重置该范围。当前没有完整的会话隔离。运行状态位于共享 Ponytail 配置目录的 `zcode` 子目录，`PONYTAIL_STATE_DIR` 可覆盖状态根，客户端身份及实际 Git 工作树根仍参与隔离。普通切档不修改其他客户端的运行状态；显式 default 设置沿用共享用户默认配置。

## 维护与验证边界

上游曾在 [1564efeb](https://github.com/DietrichGebert/ponytail/commit/1564efeb9234829a776a1f4d5f56a71a1ef09f3b)加入 ZCode JSON 输出，后在 [e807c558](https://github.com/DietrichGebert/ponytail/commit/e807c558ff1dd627712e5097a9403a2025d7c322)因作者无法测试而移除支持。本仓负责插件路由、JSON 薄适配和 ZCode 配置链测试的维护，不能把 v5.1.0 上游版本视为 ZCode 兼容保证。

插件的 `hooks/route.js` 只核对当前 Git 工作树的显式启用设置，并执行该工作树 `.claude/hooks/ponytail-zcode.js`。适配器复用共享 activate、mode-tracker、config、instructions、runtime，不复制正文或档位解析。stdout 始终输出一个 JSON 对象；有上下文时使用 `hookSpecificOutput.hookEventName` 和 `additionalContext`，无上下文时输出 `{}`。安全 Gate、发布授权与审计契约继续由既有入口维护。

更新插件包内文件时，同时更新 manifest 和市场条目的版本，再在市场源面板刷新并更新插件。共享规则和工作树适配更新后，路由自动使用当前工作树文件。卸载在「管理已安装」中移除本插件；项目技能软链在技能设置中单独移除，其他插件、技能和 Hook 保持原有设置。

统一配置链入口：

```bash
python3 -m unittest discover -s scripts/tests -p 'test_*ponytail*.py' -v
python3 scripts/check-hook-contracts.py
```

命令要求 Node、Git 和 Python 3.11+。测试把真实共享正文、依赖和配置放入临时项目，把插件按实际市场条目复制到项目外的安装目录，再执行声明的 Node 处理器。测试隔离 HOME 和配置，不写成员真实用户目录。

| 证据 | 能证明的行为 |
|------|--------------|
| JSON 模拟 | 给适配器输入事件载荷，验证输出可解析及正文。不能证明客户端加载。 |
| 配置链集成 | 从真实历史项目配置及插件标准配置执行处理器，验证默认值、切档、关闭、恢复、非法参数、一次性任务、项目及工作树隔离。不能证明 GUI 安装、信任或模型实际上下文。 |
| 客户端实机 | 成员安装启用插件及项目技能后，取得客户端版本、Hook 来源、上下文和技能发现证据。此项单独验收。 |

本轮在 macOS 执行 Node/Python 配置链测试。只读应用元数据确认已安装 ZCode 桌面端 3.14.5、build 3.14.5.7961，PATH 上未找到 `zcode` CLI。安装探针不能证明插件启用、技能导入或上下文注入；这些实机项目及其他系统仍未验收，详见[整包验收记录](../projects/IKL54X/ponytail-acceptance.md)。出现 `config_project_hooks_ignored` 时使用插件入口；出现 `hook.run.failed` 时核对 Node PATH、工作树启用设置及共享脚本是否存在，stdout 中的备用约束或脚本 exit 0 都不能替代真实正文验收。
