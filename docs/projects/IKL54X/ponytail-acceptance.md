# Ponytail 四端验收记录

先在 Codex CLI 打开交付工作树，输入 `/hooks` 核对项目 Ponytail 三类生命周期处理器。需要信任时由成员本人审查，完成后新建会话。后续按本文场景保存实际来源与上下文证据。

2026-10-12，IKL54X 三个实现票已合入本地集成分支；固定上游为 v5.1.0，提交 `9cc65d03aa2da1db7121b912d03596409ee340b8`。共享规则、安装与只读来源核对见[维护说明](../../agents/ponytail.md)。本记录将配置链证据与实机证据分开。四端真实证据尚未齐全，IKL5IU 与父需求保持开发中。

## 自动验证证据

统一入口在隔离 HOME、用户配置、临时 Git 项目和 linked worktree 中读取真实配置、安装完整共享正文及依赖，再执行配置声明的处理器。测试不写成员个人配置，也不通过状态文件名判断档位。

```bash
python3 -m unittest discover -s scripts/tests -p 'test_*ponytail*.py' -v
python3 scripts/check-hook-contracts.py
bash scripts/test-hooks.sh
```

| 证据 | 本轮结果与范围 |
|------|----------------|
| 已合回配置链 | 三个实现票集成后 28/28 PASS、无跳过。包括 Codex、Claude、Kimi、ZCode 插件及历史项目配置链。该记录绑定集成提交 `196e8a7fb4bdfcf6ee554174762384cffc7b39f6`，不是后续 HEAD 的发布凭证。 |
| IU 四端组合场景 | 包含新增组合场景的配置链 29/29 PASS，73.454 秒、无跳过。同一临时工作树同时从 Codex、Claude、Kimi 配置和 ZCode 市场安装后的标准插件配置执行。观察切档正文、支持的子代理正文与档位报告，验证四端独立切档、关闭和恢复。未改变生产实现。 |
| 共享规则与命令 | 完整正文包含中文、CBM、已有测试框架和普通注释禁令；六个 Claude 映射和命令指向共享正文。概览为辅助线索。债务技能的实际扫描命令读取历史 `ponytail:` 与 `shortcut:` 两类标记。 |
| 安装与安全回归 | 实现票的临时 Kimi 用户配置验证首次与重复安装、更新、精确迁移、未知配置保留和整包卸载。评审修订增加 Ponytail 独立卸载接缝，检查 17 条安全 Hook 与安全 shim 原样保留、管理块内外未知来源保留、重复卸载无漂移、重新安装恢复两条 Ponytail Hook，以及损坏配置拒绝删除 shim。余留 Hook 引用的 shim 保留，并从真实配置执行验证共享正文；没有管理块时，自定义同名入口的字节及执行行为保留。实现票各自的安全 Hook 722/722 与工程测试通过；父级整包当前 HEAD 须另取正式凭证。 |
| 环境 | macOS arm64，Python 3.12.14、Node 24.18.0。PowerShell 与其他系统实机未执行。没有重试或跳过可被计为通过。 |

四端组合测试初稿误把普通输入当成 Codex、Claude、ZCode 重复交付正文的场景，出现断言失败。按真实协议调整观察后再执行。该测试编写误差不属于生产行为回归，也不作为缺陷修复证据。

支持自动子代理注入的 Codex、Claude 以 SubagentStart 正文观察档位。ZCode 活动状态的裸命令报告档位，启动和切档交付正文。Kimi 启动静默，在普通输入中观察当前正文。客户端实机仍需证明处理器执行与模型接收的顺序。

## 实际安装与只读探针

以下探针来自本轮真实机器，只证明安装、版本或配置存在。各行模型上下文均为 `NOT_RUN`。

| 客户端 | 版本与证据来源 | 真实上下文 |
|------|----------------|------------|
| Codex 独立 CLI | PATH 上的 CLI `--version` 返回 0.146.0。 | NOT_RUN，项目 Hook 信任、执行与技能发现尚无实机记录。 |
| Codex 桌面端 | 只读进程探针确认 ChatGPT.app 宿主，Info.plist 版本 26.1007.30912、build 20156；其捆绑 CodexCLI `--version` 为 0.162.0-alpha.17.2。宿主版本、捆绑 CLI 与独立 CLI 分别记录。 | NOT_RUN，不能从当前 Agent 会话或版本推断 Ponytail 注入。 |
| Claude Code | `--version` 返回 2.1.283。只读帮助显示非交互 print 会跳过 workspace trust dialog；本轮没有据此运行模型验收。 | NOT_RUN，项目配置加载、六命令发现、上下文与子代理待验。 |
| Kimi Code | `--version` 返回 0.42.0。临时 KIMI_CODE_HOME 的 `doctor` 输出配置合法。 | NOT_RUN，doctor 不证明规则进入模型或技能展开顺序。 |
| ZCode 桌面端 | 应用 Info.plist 版本 3.14.5、build 3.14.5.7961。PATH 未找到 CLI，桌面应用已安装。 | NOT_RUN，插件启用、项目技能软链和 JSON 实际注入待验。 |

成员可在当前非交互 Hook 环境复核 `node --version`，在终端复核 `codex --version`、`claude --version`、`kimi --version`。桌面客户端从应用版本界面确认宿主和构建号，记录当前实际使用的可执行来源。终端 Node 可用不单独证明 GUI 的 PATH 可用，需要 Hook 执行记录补证。

本轮没有自动信任 Hook、启用插件、迁移真实个人配置或强制升级客户端。真实客户端验收从本人掌握的交互会话开始，保留既有安全流程。

## 重复来源排查

来源存在与实际重复执行分开记录。本轮只读提取 Ponytail 元数据，仓库不保存个人配置、凭据或机器绝对路径。

| 客户端 | 已确认来源或待查项目 | 消除步骤与当前结果 |
|------|----------------------|-------------------|
| Codex | 仓库三类项目生命周期处理器已确认。个人 inline hooks、用户 hooks.json、系统与插件来源尚待客户端 `/hooks` 核对。 | 成员本人逐项查看来源，停用已确认重复的旧 Ponytail Hook。个人配置和信任未改，实际重复未证实。 |
| Claude Code | 仓库三类项目生命周期处理器及六条命令映射已确认。个人、settings.local 与全局插件的运行来源待 `/hooks` 及插件界面核对。 | 保留安全 Hook 和已有状态栏，停用已确认重复的 Ponytail 来源。实际重复未证实。 |
| Kimi Code | 用户 config.toml 有 SessionStart、UserPromptSubmit 旧条目，两条均调用 `node "$HOME/.config/ponytail/kimi-hook.js" <事件>`、timeout=5。 | [受管理安装器](../../agents/ponytail-kimi.md)已在临时用户配置证明精确迁移。成员本人在真实用户配置运行并核对报告；本轮未执行迁移。 |
| ZCode | 用户 `~/.zcode/cli/config.json` 的 hooks.enabled=true；两个生命周期事件有旧 `~/.zcode/hooks/ponytail-zcode-hook.js` 来源，末尾分别带 `ponytail-zcode-activate`、`ponytail-zcode-tracker` 标记。 | 新插件启用前，成员本人核对并停用已确认冲突的旧 Ponytail 来源。其他 Hook 与归属不明配置保留。旧来源实际执行与重复正文未证实。 |

下一轮先使用[维护说明的来源核对](../../agents/ponytail.md#固定版本与本地来源核对)，再从客户端界面记录每个事件的 Hook 来源与执行结果。单凭配置条目数、脚本 exit 0 或模型自述不能判定没有重复加载。

## 待完成的真实会话验收

同一来源提交下，Codex CLI 与桌面端分别填记录；另填 Claude、Kimi、ZCode。每个客户端先按维护说明完成本人安装或信任，再开新会话。

1. 保存实际版本、仓库 HEAD、上游提交、Hook 来源及六技能或命令的发现列表。Kimi 按[安装说明](../../agents/ponytail-kimi.md)迁移，ZCode 按[插件与技能说明](../../agents/ponytail-zcode.md)分别启用。记录未知来源的处理结果。
2. 以默认 full 启动，保存客户端可检查的上下文或调试记录，证实当前共享正文进入模型。默认 off、lite、ultra 分别新建会话核对。CLI 与 GUI 的 PATH 结果分别记录。
3. 使用本端前缀切换 lite、ultra、full，关闭后输入普通请求，再用裸命令恢复。核对非法参数与 default 的行为，以及 review、audit、debt、gain、help 执行前后档位一致。一次性任务同时确认技能真正可发现。
4. 用另一个项目、linked worktree 和另一客户端核对隔离。Codex、Claude 保存子代理上下文；Kimi、ZCode 明确派单要求读取当前工作树共享技能、应用父档位，并保存实际读取记录。ZCode 不报告自动子代理注入。
5. 记录来源与正文份数。Kimi 切档当轮只有一份正文；其他三端核对启动与切档正文，以及普通输入延续当前档位。缺可检查的上下文证据时填 NOT_RUN 或证据缺失，继续保留待办。

同客户端、同工作树并发会话共享最后写入档位，新会话也重置该范围。显式 default 修改共享用户默认值，后续会话会采用该值。验收期间先记录原默认设置，再由成员本人恢复。

每份实机记录使用以下字段，附脱敏原始证据。Hook stdout 可证明处理器交付内容；还需客户端上下文、调试或事件记录证明宿主接收及使用。Agent 自述仅作为线索。

```text
日期 / 执行者：
客户端 / 版本 / 可执行或宿主来源：
仓库 HEAD / 工作树标识：
上游：v5.1.0 / 9cc65d03aa2da1db7121b912d03596409ee340b8
Hook 来源 / 插件版本 / 信任状态：
六技能或命令发现证据：
场景 / 输入 / 预期 / 实际：
上下文或事件证据位置 / 正文份数：
子代理证据或明确派单读取记录：
结果：PASS / FAIL / NOT_RUN
缺口 / 处理结果：
```

完成条件为四端真实记录全部齐全，含 Codex CLI 与桌面端的独立记录，以及支持的子代理证据。父级当前 HEAD 的整包审查与正式验证也须通过。现阶段继续本地集成与审查；实机证据未齐时不转本票或父需求为完成态。

下一步打开交付工作树的 Codex CLI，输入 `/hooks`，保存脱敏来源列表。
