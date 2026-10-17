# IKL2X8 规则适配核验

核验日期：2026-10-18。依据为 Gitee 工单 IKL2X8 评论 51546104 的已确认规格 `IKL2X8-SPEC-20261012`。任务起点为 `058f8784b3cd70a4dae7eaf07406af90577b1694`，目标为 `release/2026.09.29`。本记录随任务提交保存，最终工程凭证绑定交付 HEAD，按 `verify-change-scope.mjs check --json` 核对。

## 实时查询与静态配置

| 核验 | 结果与边界 |
| --- | --- |
| 三类实时枚举 | PASS。适配后通过 Gitee MCP 重新查询，需求 10 项、任务 9 项、缺陷 9 项，与唯一权威表的 ID、标题和类型适用性逐项相同 |
| 工单细状态及保留字段 | PASS。实施前待排期精确筛选唯一命中；认领后开发中唯一命中，旧待排期筛选为空。detail 回读正文原值、bug 与 ready-for-agent、类型及归属保持，负责人为执行人 |
| 父子集合 | PASS。四类粗状态共 2000 项、22 页，按 parent_id=34575884 筛选无子项，不据父编号搜索判断 |
| 读取路由与模板 | PASS。根规则和操作、集成、人类说明、Hook、初始化模板均指向状态权威；执行路径无退役 ID，历史说明集中可辨。Agent 与 Claude 模板路径读取同一内容 |
| 配置与语法 | PASS。Hook 四端配置结构检查、Bash 语法、JavaScript 语法及注释规则检查通过。配置结构检查使用已安装 Python 3.12，系统 Python 3.9 缺少 tomllib，不修改项目依赖 |

## Hook 真实子进程边界

`python3 -m unittest discover -s scripts/tests -p test_remind_issue_state.py` 的 13 项测试通过。测试通过 stdin 喂真实脚本并读取 stdout 和退出码，覆盖独立开工、PR 创建与合并、失败、未知、畸形输入、无工单、Kimi 文本及 Codex wrapper。

新增行为均有失败到通过的记录。PR 创建与合并只提醒工程记录和保持业务状态；开工需实际成功证明。含引号的脚本与工单可识别，仅打印命令、复合命令、嵌套 shell、语法检查、版本查询或入口帮助均静默。实现只支持可确认执行的独立脚本或 shell 加脚本形态，其他形态由 Agent 按标准入口和手册核验，不扩大提醒的成功推断。

`node --test tests/agent-rules.test.mjs` 的 17 项检查通过。该结果验证规则结构和路由，不能替代下面的行为演练或真实客户端验收。

## 规则执行离线演练

Spec 审查代理读取原规格及当前规则，对受控输入给出下一步、拟 MCP 参数和保留字段。父代理按已确认规格核对结果。演练没有新增状态执行器，也未向 Gitee 写入演练数据。

| 必验时序 | 观察到的决策 | 结果 |
| --- | --- | --- |
| 同包前置已验证合回，无关兄弟未完成 | 后续基线含成果且全部声明前置满足即可开工，前置保持开发中 | PASS |
| F/S 已部署，所需 W 尚为旧版 | 父提测阻止，子项逐票按覆盖判断 A，不批量就绪 | PASS |
| 父仅打回 A，A/B 均待发布 | 仅授权范围内 A 接回开发中，B 保留，重验受影响共享行为 | PASS |
| 父已上线，新关联子未部署 | 暂停子收口，报告验收与生产范围差异，不自动回退父 | PASS |
| 同负责人中断，交接与工作区未知 | 停止认领和依赖写入，先核验原授权、执行者停止及交接 | PASS |

其余 7 项受控输入均通过：正常认领将负责人 11、执行人 22、协作者 [22,33] 合并为负责人 22、协作者 [11,33]；状态请求不附带正文或标签，回读保留字段。PR 标签 [101,102] 与目标 103 合并整体写回。枚举拒绝不换状态或盲重试，超时且回读失败停止依赖写入；只对明确未执行的临时失败最多重试一次。规划发布、未合并说明和未验运行配置均不能提前走 C；B 需实际生产覆盖及代发版授权，父结论缺子行为覆盖不能收口。分页不全或身份归属冲突不作状态判断。

## 审查与剩余边界

Standards 和 Spec 分别独立审查固定起点以来的完整 diff。审查发现的复合命令成功误判，以及人类摘要中待发布和回退语义冲突均已修正并复核，无未解决发现。

CBM 项目为 `IKL2X8-implementation`，目录为任务区 `fix-ikl2x8`，初始索引就绪。Hook 图查询零命中，coverage 确认 .claude、scripts、docs 及相关测试被 fast 索引排除，已定向读取全部相关源码与文档补证，未据空图作不存在结论。

## 发布前真实客户端兼容

本轮责任人为本任务执行 Agent。以下兼容核验属于发布前工程验证；未测端保留边界，不移入部署后验收。

| 客户端或接缝 | 环境、证据与结果 | 缺失原因与下一步 |
| --- | --- | --- |
| Claude 规则读取 | PASS。Claude Code 2.1.283，真实只读会话 `a32e9b4d-2ae3-44c3-8dee-9f2c5997c0cc`。`claude -p` 使用 Read/Bash、dontAsk 和空 MCP 配置。实际 Read 工具 `call_e8e3c738ff9d4f338395ab5d` 读取 `docs/agents/gitee-workflow-agent.md`，结论为 PR 合并但未部署时保持开发中，不提测、不走 A | 代表性客户端已验；不据此宣称四端实机通过 |
| Claude Hook stdin | PASS。真实会话 `3c10aaeb-3b36-4ec7-9928-9e2c6fcb8d06`，以单次 CLI 附加 settings 观察 `PostToolUse` 和 `PostToolUseFailure`，未改客户端全局配置。分别实际执行 `printf IKL2X8_POST_SUCCESS` 和 `false`，成功工具 ID `call_669aa724d2304b79ae2f9ef5`，失败工具 ID `call_a5d1b314824942a4b3cd3696` | 原始取证仅在本机 `/tmp/IKL2X8-claude-post-inputs.jsonl`；下面保存关键载荷形状及复现测试 |
| 真实载荷受控回放 | PASS。将上述两次原始 stdin 的 command 替换为标准 worktree 入口，分别回放 `.claude/hooks/remind-issue-state.sh` 和 `.codex/hooks/run-claude-pretool.sh remind-issue-state.sh`。四次均退出 0；成功包含工单提醒，失败输出为空。回放没有实际创建 worktree 或写入 Gitee | 定向测试 `python3.12 -m unittest discover -s scripts/tests -p test_remind_issue_state.py` 保存同形回归，先失败后通过；中断、缺字段、显式非零退出继续静默 |
| Codex 实机 | BLOCKED。codex-cli 0.146.0；`codex exec -s read-only --ephemeral --json` 在会话启动前报 catalog JSON 缺 `base_instructions`，位置 line 136 column 5 | 既有用户配置阻塞；未改全局配置。用户配置修复后由客户端维护者重跑只读读取验收 |
| ZCode / Kimi 实机 | NOT_RUN。四端配置链静态检查已通过；Kimi 输出与 Codex wrapper 子进程契约已测 | 本轮未执行两端真实会话；由对应客户端维护者补验读取路由和事件兼容 |

成功事件的关键真实形状为 `hook_event_name=PostToolUse`、`tool_name=Bash`、`tool_response={stdout: "IKL2X8_POST_SUCCESS", stderr: "", interrupted: false, isImage: false, noOutputExpected: false}`，没有 `exit_code` 或 `isError`。原实现因此错误静默，新增回归先失败再修复通过。兼容判断要求显式成功事件、Bash、字符串 stdout/stderr 和 interrupted 严格为 false；显式错误或非零退出优先拒绝。失败事件为 `PostToolUseFailure`，没有 tool_response，携带 `error="Exit code 1"`、`is_interrupt=false`，保持静默。

除本工单合法开工认领及回读外，退役状态拒绝、未知写入和标签保留的真实 Gitee 写入演练为 NOT_RUN；相应受控演练不能当作真实写入证据。本轮不向真实工单制造无效状态或超时，真实标签合并及回读随获授权的发布动作核验。

部署及业务验收属于部署后阶段，结果为 NOT_RUN，本任务没有产品部署。后续由规则维护者按实际影响和 C 条件判断收口；当前工单保持开发中。工程完整命令、交付 HEAD 与目标基线以最终 `verify-change-scope.mjs summary --stage pr` 和发布凭证为准。
