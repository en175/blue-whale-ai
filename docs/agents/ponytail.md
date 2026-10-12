# Ponytail 安装与维护

先拉取本任务交付的仓库版本，确认非交互进程能执行 `node --version`。这份说明适用于仓库固定的 v5.1.0，来源提交为 `9cc65d03aa2da1db7121b912d03596409ee340b8`。完整导入清单、补丁与 MIT 见[来源记录](../../.agents/skills/ponytail/references/upstream.md)。

## 四端入口

| 客户端 | Hook 与技能来源 | 安装及子代理边界 |
|------|-----------------|------------------|
| Codex CLI 与桌面端 | 当前工作树 `.codex/hooks.json` 调用共享脚本，技能位于 `.agents/skills`。调用 `$ponytail` 系列。 | 按下节分别完成 Hook 信任并重开会话。支持 SubagentStart；CLI 与桌面端分别验收。 |
| Claude Code | `.claude/settings.json` 调用共享脚本，`.claude/skills` 映射共享技能，`.claude/commands` 指向共享正文。调用 `/ponytail` 系列。 | 支持 SubagentStart。更新后重开会话并核对项目配置。 |
| Kimi Code | 用户受管理配置调用 Node 路由，再加载当前工作树 `.claude/hooks/ponytail-kimi.js`；技能来自 `.agents/skills`。调用 `/skill:ponytail` 系列。 | 安装、精确迁移与卸载见 [Kimi 说明](ponytail-kimi.md)。启动静默，用户输入注入；子代理需显式派单加载。 |
| ZCode | 本地市场插件 `blue-whale-ponytail` 1.0.0 路由当前工作树的 JSON 适配器；六技能需另行导入项目软链。调用 `$ponytail` 系列。 | 安装与技能导入见 [ZCode 说明](ponytail-zcode.md)。当前官方项目 config Hook 被忽略，使用插件入口。没有 SubagentStart，子代理需显式派单加载。 |

共享六技能和档位策略只有一份。Kimi、ZCode 的路由与输出适配不包含第二份正文。其他智能体可先复用 `.agents/skills`，新增平台适配须单独验证载荷、输出协议、发现方式与信任；保留的宿主探测代码不代表完整兼容承诺。

安装版本、只读来源排查和各项实机状态见[验收记录](../projects/IKL54X/ponytail-acceptance.md)。记录中的版本只证明本轮环境，不承诺其他版本或系统兼容。

## 固定版本与本地来源核对

在准备使用的工作树确认 `python3 --version` 为 3.11+，再运行以下只读命令，保存仓库 HEAD、未提交变化、来源记录及共享映射。正文经过中文与团队规则适配，与上游逐字节比较不能代替本仓审查。

```bash
git rev-parse HEAD
git status --short
cat .agents/skills/ponytail/references/upstream.md
python3 - <<'PY'
from hashlib import sha256
from pathlib import Path

root = Path.cwd()
names = ['ponytail', 'ponytail-review', 'ponytail-audit',
         'ponytail-debt', 'ponytail-gain', 'ponytail-help']
for name in names:
    shared = root / '.agents/skills' / name / 'SKILL.md'
    alias = root / '.claude/skills' / name / 'SKILL.md'
    command = root / '.claude/commands' / (name + '.md')
    assert shared.resolve() == alias.resolve(), name + ' 技能映射不一致'
    assert '.agents/skills/' + name + '/SKILL.md' in command.read_text(), name + ' 命令来源不一致'
    print(name, sha256(shared.read_bytes()).hexdigest(), shared.relative_to(root))
PY
python3 scripts/check-hook-contracts.py
```

来源记录应为 v5.1.0 及上述完整提交。六行散列用于与同一交付 HEAD 的其他机器比较。契约检查核对仓库配置，不读取个人配置，也不证明当前客户端实际加载。再从客户端 Hook 列表核对来源是否与上表一致；ZCode 同时核对安装的市场源、插件版本和六技能软链目标。

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
| 客户端身份 | `PONYTAIL_CLIENT` 明确区分 codex、claude、kimi、zcode，优先于继承的宿主探测变量。未传时保留上游其他宿主探测兼容。 |
| 项目定位 | `PONYTAIL_PROJECT_DIR` 优先，随后 `CLAUDE_PROJECT_DIR`，最后当前目录。使用 Git 实际工作树根与真实路径；不按 Git common dir 合并工作树。载荷中的 cwd 由适配器定位后传入。 |
| 运行状态 | 以客户端和实际工作树的组合隔离。默认落在 Ponytail 用户配置目录下，`PONYTAIL_STATE_DIR` 可为薄适配器指定私有根。不得把状态提交仓库。旧共享标记不会作为新隔离状态读取，旧 review 不能形成持久档位。 |
| 上下文 | `getPonytailInstructions(mode)` 从当前工作树 `.agents/skills/ponytail/SKILL.md` 读取对应档位正文。缺失时明确提示升级验收未通过，备用约束保留中文、CBM、测试和注释规则。 |
| 输出 | Codex 经 `hookSpecificOutput.additionalContext` 注入，包含正确事件名，不发旧 systemMessage。Claude 启动与输入保留纯正文协议，SubagentStart 使用其 JSON 上下文协议。 |

同一客户端、同一工作树的并发会话共享最后写入档位；新会话启动也会影响该范围。当前没有完整会话隔离。不同客户端、不同项目、主检出区和任务工作树相互隔离。

运行档位隔离，显式 `ponytail default <档位>` 则修改共享用户默认配置，会影响以后启动的其他客户端。Codex、Claude、ZCode 在启动及切档时交付正文，普通输入不重复交付；活动状态的裸命令报告档位。Kimi 在每次用户输入时交付当前正文，切档当轮只交付一次。

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

项目 Hook 与全局 Ponytail 插件同时生效时，一轮可能收到两份规则。按以下顺序核对。

1. Codex 在 `/hooks` 中核对项目、用户、系统和启用插件的来源。用户 `~/.codex/hooks.json`、用户与项目 config.toml 的 inline hooks、项目 hooks.json 和插件均可能同时加载。同层 inline 与 JSON 只保留一个表示。成员本人停用已确认重复的 Ponytail 来源并重新审查信任。
2. Claude 在 `/hooks` 与插件设置中核对项目 `.claude/settings.json`、个人 settings、项目 settings.local.json 和启用插件。保留本仓三类生命周期处理器，停用已确认注入相同正文的旧 Ponytail 来源；原状态栏单独保留或组合。
3. Kimi 按[精确迁移说明](ponytail-kimi.md)核对用户 config.toml。安装器迁移已确认的旧两条入口，报告未知条目；成员本人核对报告后再处理重复来源。
4. ZCode 在「设置 → Hooks」核对用户 `~/.zcode/cli/config.json` 和插件来源。插件启用前核对旧用户 `ponytail-zcode-hook.js` 两条生命周期入口；确认冲突后停用旧 Ponytail 来源，保留其他 Hook。标准 hooks/hooks.json 自动加载，manifest 保持单次声明。
5. 重开会话，保存每个事件的来源与执行记录，并核对当轮正文来源。配置中出现两个来源只表示潜在重复，客户端记录才能证明实际重复执行。

归属不明的配置保留并报告。排查输出只记录 Ponytail 来源、事件和结果，屏蔽令牌、环境变量值及无关个人设置。本轮已确认的旧来源与尚未取得的运行证据见[验收记录](../projects/IKL54X/ponytail-acceptance.md)。

项目配置由 Git 维护。需要停用时先设置默认 off 或当前范围执行 ponytail off。卸载 Codex、Claude 项目 Ponytail 时只移除三类生命周期事件中的 Ponytail command 处理器以及自己添加的状态栏段，保留其他 Hook。Kimi 使用 `bash scripts/install-kimi-hooks.sh --uninstall-ponytail`，仅移除受管理块内的两条 Ponytail Hook，保留 17 条安全 Hook、安全 shim 及未知来源。成功移除条目且剩余 Hook 全部为既有配置片段声明的标准安全 Hook 时，才删除 Ponytail shim。任何未知 Hook，包括无关个人命令，都会保留 shim 并报告；没有管理块或未识别到受管理 Ponytail 条目时也保留。保留文件不会重新注册 Ponytail 事件，成员按报告核对未知来源及间接依赖。原 `--uninstall` 仍移除整包本仓受管理 Hook，包括安全 Hook 和两个 shim。ZCode 在已安装插件中卸载本插件，项目技能链接单独移除。具体范围见两端说明。本轮没有迁移成员真实个人配置。

## 验证边界

统一配置链与既有安全 Hook 验证命令：

```bash
python3 -m unittest scripts.tests.test_codex_ponytail_hooks -v
python3 -m unittest discover -s scripts/tests -p 'test_*ponytail*.py' -v
python3 scripts/check-hook-contracts.py
bash scripts/test-hooks.sh
```

Python 要求 3.11+；本轮使用 Python 3.12.14 与 Node 24.18.0，在 macOS arm64 执行。统一配置链接缝的 `PonytailConfigHarness` 位于 `scripts/tests/test_codex_ponytail_hooks.py`，负责隔离用户目录、安装真实共享技能、读取实际配置并执行 subprocess。Kimi、ZCode 场景在各自测试文件，复用此接缝，不复制安全 Gate 策略。

配置链覆盖四端正文、完整档位生命周期、默认设置、一次性命令、不同项目与 linked worktree、支持的子代理、缺技能、概览、债务旧标记、状态栏及同时四端的隔离。Kimi 的安装、重复执行、更新、迁移和卸载使用临时用户目录。ZCode 当前插件链与历史项目配置链分别执行。真实模型上下文、技能发现和操作顺序单独记录在[验收记录](../projects/IKL54X/ponytail-acceptance.md)，脚本 PASS 不关闭实机待办。

信任与输出边界依据 [Codex Hook 文档](https://learn.chatgpt.com/docs/hooks)、[Codex 项目配置](https://learn.chatgpt.com/docs/config-file/config-advanced#hooks)、[Claude Hook 文档](https://code.claude.com/docs/en/hooks)和 [Claude 状态栏文档](https://code.claude.com/docs/en/statusline)。
