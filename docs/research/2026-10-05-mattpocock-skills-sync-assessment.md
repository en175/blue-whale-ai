# mattpocock skills 更新与本地适配评估

上游最新正式版 1.3.1 修正 bug 修复后的复盘路由，主分支随后改写说明页面并新增实验性 `chief-of-staff`。本轮按用户确定的范围更新 `ask-matt`，恢复官方 `handoff` 并将启动功能拆成独立技能，修正 Gitee 初始化模板，移除已撤下的冲突技能。其余 6 个同名定制技能分别评估，本轮没有修改其架构或工程质量方法。

## 上游最新更新了什么

核验日期为 2026-10-05，日期与时间均按北京时间。最新正式版本是 **v1.3.1**，对应提交 `24fe0ef7737efae15c87225755e9f6f5965e4888`，于 10 月 4 日 20:48 合入。核验时 `main` 已推进至 `4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d`，提交时间为 10 月 5 日 19:17。本次将正式补丁与随后主分支的文档、实验内容分开评估。

| 更新 | 优化或收敛 | 对本仓的影响 |
| --- | --- | --- |
| 1.3.1 修正 `ask-matt` 的 bug 后续路由 | 修复后建议在同会话运行 `/retro`，讨论怎样预防同类问题；缺少合适测试接缝时，再由用户发起 `/improve-codebase-architecture` | 只需替换 `ask-matt/SKILL.md` 一行，本地无定制冲突 |
| 删除说明中的旧自动交接 | `diagnosing-bugs` 已移除该交接，路由此前仍声称会发生；现在说明与实际流程一致 | `diagnosing-bugs/SKILL.md` 本次没有上游变化，本地 CBM 适配保留 |
| 10 月 5 日改写 28 个说明页面 | 拆开长句、减少修辞、改用直接表达，保留标题、链接与术语 | 改动位于上游 `docs/`，不是技能执行正文；无需复制到本仓技能目录 |
| 10 月 5 日新增 `chief-of-staff` | 单会话长期目标编排，主代理负责策略，工作交给子代理，通过资料指针交换信息，并可建议周期任务 | 位于 `skills/in-progress`，未进入正式插件清单；建议先试用，不纳入团队默认工作流 |

以上来自 [1.3.1 变更记录](https://github.com/mattpocock/skills/blob/24fe0ef7737efae15c87225755e9f6f5965e4888/CHANGELOG.md)、[路由修复提交](https://github.com/mattpocock/skills/commit/c5b98691982c4f0d3a5e40ab09566b3b84721e00)、[说明页面改写提交](https://github.com/mattpocock/skills/commit/dfe75499f43eb453375adff6c5dce61e58569543)及 [chief-of-staff 正文](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/in-progress/chief-of-staff/SKILL.md)。

1.3.0 的变更记录也在此次版本整理中出现，包括 `implement-spec`、`pr`、`retro` 转正，`CONTEXT` 更名为 `GLOSSARY`，以及撤下 `resolving-merge-conflicts`。这些技能内容已包含在本仓旧同步点 `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`，不能把新出现的版本记录算成这次新增的技能行为。撤下技能的本地遗留另见下文。

## 本地与远程的全量对比

本次将上游两层目录 `skills/<类别>/<名称>/` 映射到本仓 `.agents/skills/<名称>/`，对全部普通文件逐字节比较，包含隐藏文件、引用资料、脚本和客户端元数据。以旧同步点 `d81f3a1` 作共同基准，区分本地定制、上游补丁及双边变化。

| 项目 | 数量与结果 |
| --- | --- |
| 本地技能包 | 54 个 |
| 上游技能包 | 38 个，其中正式 Engineering/Productivity 合计 27 个，其余分布于其他类别 |
| 双方同名技能 | 37 个，处理后 31 个整包相同，6 个保留本地定制 |
| 上游有、本地没有 | 1 个，实验性 `chief-of-staff`，含正文和客户端元数据两个文件 |
| 本地有、上游没有 | 17 个，包含其他来源、自研技能和新拆出的 `handoff-start`，已移除上游撤下的历史技能 |

上游从旧同步点至最新 `main`，现有技能包只改了 `ask-matt/SKILL.md`。其他技能文件没有上游变化，双边同时修改的文件为 0。

本次更新后，双方同名的 37 个技能中，31 个整包与最新上游相同，6 个有意保留本地差异。正式 27 个技能中，21 个整包相同，6 个有本地定制。重新 fetch 后，上游 `main` 仍为本报告固定的 `4588b32`。

## 本地定制需要怎样处理

### 代码发现与实施验证

| 技能 | 已确认的本地适配 | 建议 |
| --- | --- | --- |
| `code-review` | 追加 `Repository code discovery`，审查前读取 `agent-rules/code-discovery.md`，向子代理交接图谱与覆盖证据 | 工程方法与上游一致，双轴并行审查和代码异味基线完整保留。规则入口合理，但重复嵌入技能增加同步差异，建议后续验证根路由足够后恢复正文一致 |
| `diagnosing-bugs` | 同一 CBM 入口与证据要求 | 六阶段诊断、真实失败反馈、回归测试和清理要求均保留上游。CBM 只负责取证，不能替代真实复现；也不能把结构调查当成提前形成根因结论的理由 |
| `grilling` | 同一 CBM 入口，事实调查需带图谱证据 | 上游按设计树逐轮提问、事实由 Agent 调查、决策由用户回答的设计完整保留。代码调查入口合理，普通非代码讨论不应额外加载 CBM |
| `implement` | CBM 入口；将上游全量测试收口改为本仓分层验证；经本仓提交入口生成干净 HEAD 并验证 | 提交入口是本地流程，可以保留。分层验证替代最终全量测试是质量取舍，不能仅按流程例外认定等价；本轮只评估，未改技能或验证策略 |

这些指针与根 `CLAUDE.md` 的代码探索、验证路由一致。此处评估的是规则文本兼容性，没有运行上述技能执行真实业务任务。

### Gitee 与跨客户端交接

| 技能 | 已确认的本地适配 | 建议 |
| --- | --- | --- |
| `setup-matt-pocock-skills` | 识别 Gitee remote，提供 Gitee 选项与独有 `issue-tracker-gitee.md`；补 Wayfinding 的字段与标签约定 | 适配必要，初始化顺序和用户确认仍保留上游。本轮修正旧模板，并要求对既有配置只补缺失部分，保留权威字段与状态机 |
| `pr` | 模板标题、占位符与结构标签中文化；`agents/openai.yaml` 也有本地差异；正文指导及 `CREDITS.md` 保留上游 | 保留中文模板与客户端元数据。该差异有仓内结构测试守护 |

Gitee 模板是本地文件，上游本次没有修改。下表所列本地兼容问题已按用户授权修正。

| 模板现状 | 与当前仓库规则的差异 | 修改建议 |
| --- | --- | --- |
| 声明 MCP 不可用时可使用网页 fallback | 本仓全部工单与 PR 读写只走企业版 MCP；Agent 不可切换浏览器或 REST | 已删除回退入口，缺 MCP 时只继续独立本地工作，按仓库渠道规则核验失败结果 |
| 子工单继承父项 `issue_type_id` | 当前规则要求子工单统一为任务型，使用 `1292680` | 已改为任务型，父子归属继续继承与回读 |
| 根工单创建示例未完整列出项目与负责人要求 | 当前规则要求非 0 `program_id`、`assignee_id`，并按是否点名负责人保留协作者 | 已补项目、负责人、协作者及创建后回读，既有配置的细节仍保留权威源 |
| 仓库不可见时指示重新创建工单 | 当前规则禁止用重放 create 核验未知结果，要求先 get/list 查实 | 已改为先核验并修正既有工单，无法确认时停止依赖写入 |

依据为当前 [渠道规则](../../agent-rules/gitee-mcp-only.md)与 [工单约定](../agents/issue-tracker.md)。模板同时取消“已完成必然 closed”和“创建时有负责人就必然已认领”的通用假设，依赖完成与 frontier 继续读取仓库配置，不替团队改写既有状态机。实际工单文档、规则文件和 Gitee 工单均未修改。

### handoff 与 handoff start 分离

`handoff` 整个技能包已恢复为固定上游提交的逐字节版本，仅生成临时交接文档，不再识别本地 `start` 分支。原 `references/start.md` 从包内移除。

启动接手任务的扩展放在独立 `.agents/skills/handoff-start/`。显示名为用户指定的 `handoff start`，目录、注册名和调用名为 `handoff-start`，避免空格被解析成官方 `handoff` 的参数。正文自包含，保留摘要、成果引用、脱敏、工作树信息、图谱证据、宿主任务创建、句柄核验及私有临时文件回退。它只接受用户显式调用，客户端元数据也关闭隐式调用。

这次拆分没有创建真实接手任务。独立只读模拟覆盖普通交接请求、宿主无创建能力、创建超时且查询失败三个场景，补充了取得标识后仍须核验状态，以及未知结果下停止重复创建并保存摘要的要求。新技能的客户端发现与实际启动仍需后续真实调用验收。

### 工程质量取舍与后续兼容建议

`code-review`、`diagnosing-bugs`、`grilling` 的上游正文没有删减，新增内容只是规则指针。不能把 CBM 优先解读为上游双轴审查、真实复现或逐轮决策方法已被替换。四处相同 CBM 入口已由根路由统一约束，后续可以评估移除重复追加段，但须先验证各客户端及子代理能得到权威规则。本轮不删除它们，也不修改根规则。

`implement` 的 TDD、预先约定测试接缝、定向反馈与收口审查仍保留。真正需要决定的是上游最后一次全量测试是否可由本地分层验证替代。当前本地策略对产品运行时、共享契约、数据库和鉴权等路径升级为 `full`；普通变化走对应 `scoped` 或 `docs`。这是规则文本事实，尚不能证明分类覆盖所有跨模块回归。本轮未运行产品回归或审计选择器代码。

建议下一步先对典型跨模块变更核验影响面分类和回归证据，再决定采用上游的最后一次全量测试，或在外部规则保留等效的范围验证。不要仅为了同步减少测试，也不要先声称当前范围验证与全量等价。提交入口、验证凭证及发布授权属于本地流程，可继续由仓库规则控制。

`pr` 只本地化模板骨架和客户端说明，上游的最小图示、前后证据、可逆性与影响范围要求完整保留，定制合理。后续以固定上游正文为基准，仅保留可枚举的中文化补丁；测试中引用本地测试文件的元数据将来可评估下沉至仓库规则，减少技能与项目路径的耦合。本轮未改。

建议后续同步统一采用固定上游提交、共同基准和本地差异三方比较。架构与工程质量先读上游变化及其理由，再决定适配；仓库渠道、工作树、提交、发布和状态机由外部权威规则承载，技能仅保留必要入口。此处为建议，不是新增规则或同步工具。

### implement spec 的适配已经移到仓库规则

`implement-spec` 的正文与客户端元数据均与旧同步点及最新上游逐字节一致。适配没有消失，其权威位置为 [集成分支工作流](../agents/integration-branch-workflow.md)，根 `CLAUDE.md` 和 Git 工作流都有入口。

| 上游正文 | 本仓适配 | 本轮建议 |
| --- | --- | --- |
| 首次子任务合回后创建 draft PR | 全部集成、整包评审完成后，经授权一次创建非 draft PR | 保留外部规则，不把定制重新塞回技能正文 |
| implementer 自行合入集成分支 tip | merger 作为唯一写入者，经受控入口合回 | 保留本仓入口与证据链 |
| 标 ready、关闭工单并清理工作树 | 按仓库状态机、PR 回读及清理证明执行，集成区保留用于审查修订 | 后续调用继续按根路由读取本仓规则 |

本次未修改这些规则，也未执行 `implement-spec` 的业务流程。

## 实验技能与已撤下技能

### 是否引入 chief of staff

建议暂不安装到团队权威目录。上游仍标为 `in-progress`，正式插件清单没有该技能。它要求所有工作交给子代理，适用于长期编排，但本仓已有 `implement-spec` 的任务图、merger 与集成分支协议。

如决定试用，建议先限定为只读长期研究或规划。之后再明确资料保存位置、子代理的工作树归属、失败恢复和完成标准。周期任务仍由用户明确授权，不能因技能写了可建议 schedule 就自动创建；推送和 PR 发布继续按仓库授权入口处理。这些是本地适配建议，不是上游已经提供的能力。

### 是否清理 resolving merge conflicts

已按用户指令移除 `resolving-merge-conflicts` 的正文和客户端元数据。上游在 1.3.0 已撤下该技能，理由是 Agent 可以直接处理冲突，不需要单独技能。在核对的 `.agents`、`.claude`、`agent-rules` 与 `docs/agents` 文本范围内，没有发现其他流程显式依赖它。

这属于之前版本的收敛遗留，不是 1.3.1 新删除，也不是本仓独创技能。冲突处理继续遵循当前仓库同步与恢复入口，不受旧技能“永不 abort”等指令约束。

## 其他技能的完整归类

以下是更新后与最新上游整包一致的 31 个技能，按用途分组。是否仍为实验或其他类别，以各自上游位置为准，整包相同不等于全部已经转正。

| 分组 | 技能 |
| --- | --- |
| 需求与调度 | `ask-matt`、`grill-me`、`grill-with-docs`、`to-spec`、`to-tickets`、`triage`、`wayfinder` |
| 实施与验证 | `implement-spec`、`tdd`、`prototype`、`research`、`retro` |
| 设计与文档 | `codebase-design`、`domain-modeling`、`improve-codebase-architecture`、`writing-for-agents`、`writing-beats`、`writing-fragments`、`writing-shape` |
| 交接与学习 | `handoff`、`claude-handoff`、`loop-me`、`teach`、`to-questionnaire`、`wait-what`、`wizard` |
| 工具与初始化 | `git-guardrails-claude-code`、`migrate-to-shoehorn`、`scaffold-exercises`、`setup-pre-commit`、`setup-ts-deep-modules` |

本地独有的 17 个技能完整清单如下，均不纳入 mattpocock 上游覆盖式同步。

| 分组 | 技能 | 处理 |
| --- | --- | --- |
| 项目交付与运行 | `codex`、`deploy-blue-whale-api`、`start-local-services`、`weekly-team-report` | 保留 |
| 前端与导航 | `frontend-delivery`、`frontend-styling`、`graphify` | 保留 |
| 其他审查与写作来源 | `receiving-code-review`、`requesting-code-review`、`unslop` | 保留 |
| 简化工作流 | `ponytail`、`ponytail-audit`、`ponytail-debt`、`ponytail-gain`、`ponytail-help`、`ponytail-review` | 保留 |
| 独立交接启动 | `handoff-start`，显示名 `handoff start` | 与官方 `handoff` 分开维护 |

## agents 与 Claude 同步结果

`.agents/skills` 是实体权威目录；`.claude/skills` 是 Git 跟踪的符号链接，模式为 `120000`，内容为 `../.agents/skills`。发布线工作树和本次任务工作树均确认该关系。修改任务区 `.agents` 后，该任务区 `.claude` 立即读取同一份补丁，无需复制。

`python3 scripts/check-project-skills.py` 通过，识别 54 个项目技能。它还列出个人目录中的同名技能；这不代表团队文件不同步。若客户端加载个人版本，实际调用仍可能绕开项目技能，应按实际来源定位。这次没有变更个人技能。

本轮验证范围是文件交付、目录引用、全包差异和仓库要求的收口检查。没有启动各客户端重新注册或实际调用该路由，因此不把文件一致声称为所有客户端运行时验收通过。

首轮全包断言确认 30 个技能与上游一致、7 个本地定制与更新前一致。本轮断言确认 31 个整包一致、6 个同名定制，其中 5 个只评估并保留原字节，另 1 个 setup 按授权修订；新技能的 YAML、手动调用属性、显示名、54 个总量及 Claude 同目录读取均通过检查。通用 `skill-creator` 的 `quick_validate.py` 不接受上游自带的 `disable-model-invocation` 字段，对本地与上游原版均报告相同的 schema 不兼容；不据此删除用户手动调用属性。收口通过与否以绑定最终 HEAD 的仓库验证凭证为准。

## 本轮交付与下一步

累计改动包括 `ask-matt` 一行、`handoff` 恢复与独立 `handoff-start`、Gitee setup 模板和保留配置指令、旧冲突技能移除，以及本评估报告。更新在 `chore/同步上游技能补丁` 的独立任务区，起点为 `f9d1610e3e8020caca723623042aa75d92c6def4`，目标发布线为 `release/2026.09.29`。没有写入原 release 检出区，团队发布线尚未收到本次补丁。

建议下一步先判断 `implement` 的收口测试策略。其余上游架构与工程方法保持同步，本地流程适配保留；`chief-of-staff` 继续不安装。发布或创建 PR 尚未获得本轮授权。
