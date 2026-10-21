# Issue tracker: Gitee

仓库 `git@gitee.com:hangzhou-xuanfu_1/blue-whale-ai.git`。工单和 PR 的操作渠道、故障与重试流程统一见 [Gitee MCP 渠道规则](../../agent-rules/gitee-mcp-only.md)，调用前必读。本文只定义 MCP 参数、ID、归属、负责人、查询与回读。状态语义与流转条件的唯一权威是 [Agent 工作流手册](gitee-workflow-agent.md)，任何开工、恢复、返工、部署确认、提测、生产验证与收口前必读。

工作项版本、业务父需求和验收职责按 [蓝鲸产研协作规则](bluewhale-product-sop.md) 执行。正文变更先核对编辑模式，保留富文本并增量修改，保存后重进编辑态核验；无法同时满足富文本保护及 MCP 专用渠道时停止并报告。改状态、标签或负责人不带正文。

## ID 解析约定（通用，先于任何 `mcp__gitee-ent__*` 调用读）

> 本节是**所有**企业版 MCP 调用（issue / PR / 仓库 / 标签……）的通用约定，不限于 issue 创建。

本仓日常直接使用 `CLAUDE.md`「Gitee ID 兜底常量」中的值；只向工具传其 schema 要求的 ID 参数。遇到 401 或疑似变更，先核对 token，再用对应的 `list` API 核对 ID。网页 URL 中的项目路由数字不能充当 `enterprise_id` 或 `project_id`。

Gitee 的两类标识符是脱节的，这是最易踩的陷阱：

| 标识符 | 出现在哪 | 能否直接用于 API |
|---|---|---|
| 网页路由 ID（如 URL `projects/883843` 的 `883843`） | 网页 URL | ❌ **绝不可**——既非 enterprise_id 也非 project_id |
| `enterprise_id` | `list_enterprises` 返回 | ✅ |
| `project_id` | `list_enterprise_repositories` 返回 | ✅ |
| PR 编号（URL `pulls/93` 的 `93`） | 网页 URL | ✅ URL 里**唯一**可直接抄的数字 |
| issue ident（如 `IJZYUL`） | 网页 URL / 工单标题 | ✅ 字符串标识，非数字 ID |

**误传 ID 的症状具有误导性**：把网页路由 ID 当 `enterprise_id` 传入，Gitee 可能返回 `401 企业未授权此应用进行访问`。这是 ID 错误的已知症状；同一状态码也可能涉及 token 或权限，按以下顺序核对：

```
步骤 1  调 get_user_info()
          ├─ 成功 → token 有效 → 进入步骤 2
          └─ 401  → 排查 token 失效或类型不符（普通版 REST 报 "Access token is wrong type"）
步骤 2  用 list_enterprises() / list_enterprise_repositories() 核对请求中的 ID
          ├─ 不一致 → 改用查询所得 ID
          └─ 一致   → 继续核对目标资源和访问权限
```

**一键解析**：`scripts/gitee-resolve-ids.sh resolve <PR/issue URL>` 输出企业 path、仓库 path、资源编号，并标注 URL 中哪个数字是陷阱、给出可直接执行的 MCP 查询模板。`check-id` 子命令校验单个 ID 值，`diagnose-401` 打印上面的决策树。新同事拿到一条 URL，第一步就跑它。

## 定位

企业版 MCP（`mcp__gitee-ent__*`）用以下 ID 定位，**非 owner/repo**：

- **enterprise_id**：需动态核对时用 `list_enterprises`，按 `path == "hangzhou-xuanfu_1"` 取 `id`。
- **project_id**（仓库 ID）：需动态核对时用 `list_enterprise_repositories`。创建 issue **必传**——不传则工单只进企业工作项、仓库 Issues 页不可见，PreToolUse hook `block-issue-without-repo.sh` 硬拦。
- **program_id**（项目 ID）：疑似变更时用 `list_programs` 查（按 `name`/`search` 命中 Blue-Whale-AI 项目）。根 issue 创建**必传**且非 0。不传（=0）会使工单游离于企业「项目管理」之外，同一 hook 会拦截。
- **label 数字 ID**：`list_enterprise_labels` 查；`label_ids` 传逗号分隔的数字 ID（非名称）。标签长度 2–20、非特殊字符。

## 父子工单类型映射

提出工程拆分方案前，通过 MCP 读取父单实际 `issue_type.id`，按下表确定子单参数。创建、规格拆单和 wayfinder 共用本表。新发现的缺陷使用下方「缺陷关系」规则，不因发现入口或挂层级改成任务类型。

| 父单实际类型 | 子单 `issue_type_id` | 子单 `category` |
| --- | --- | --- |
| 缺陷 `1292682` | 缺陷 `1292682` | `bug` |
| 需求 `1292681` | 任务 `1292680` | `task` |
| 任务 `1292680` | 任务 `1292680` | `task` |

发布前按顺序完成类型判定：

1. 父单详情必须明确返回本表内的实际 `issue_type.id`，才可选子单类型。标题、正文、标签、粗状态和自然语言中的"任务"均不构成类型证据。
2. 字段缺失或 ID 不在表中时，通过 MCP 补查父单详情和类型枚举。枚举只证明哪些类型可用，不能证明父单属于哪一种。
3. 补查后仍无明确父单类型 ID，报告阻塞并停止发布。已有发布授权也不改变这一前置，不发送试探创建请求，不根据正文套用默认值。
4. 类型明确后，按同表同时设置 `issue_type_id` 和 `category`。创建所需数字 ID 按 MCP schema 传数字，不传数字字符串；列表工具要求字符串的筛选字段仍按其 schema 传值。类型枚举和创建参数的 `category` 分别核对，不能将需求枚举中的 `feature` 直接当作创建参数。

用户仍需确认拆分粒度、真实依赖和发布内容。已确认并授权发布后，直接按映射创建、补标签、回读并交付链接；选择已知映射不再请求"类型例外"，不重复开展无关源码研究或加载仍有效的材料。确需改变业务分类、父单类型或交付范围时，才请用户决定。不得为适配子单修改、关闭或重建父单，不能将一次平台报错泛化为所有父子项必须使用相同类型 ID。创建结果未知时按渠道规则先查询，不重放创建。

## 操作约定

- **工单正文**：本仓新建工单默认采用 [to-tickets](../../.agents/skills/to-tickets/SKILL.md) 的中文模板和发布前检查，包含 `unslop` 改写及信息核对，无需用户再次点名技能。正文格式以该技能为唯一权威。
- **工作项标题**：所有新需求、开发／测试／工程任务及缺陷按共同 SOP 的版本格式命名。目标版本由产品或项目负责人确认，未定先标待确认，业务开发前须明确；不猜测版本，不批量改历史标题。
- **缺陷关系**：新发现的问题使用缺陷类型 `1292682`、`category=bug`，直接关联实际业务父需求，并关联发现、修复或复测的相关子任务。同一问题只建一条；创建后核对实际类型、父子层级与直接关联。平台能力不足时报告缺口，不用正文编号或任务类型代替关系。
- **创建**：`create_enterprise_issue(enterprise_id, title, description, project_id=..., program_id=...)`。根 issue 的 `project_id`（仓库）和 `program_id`（项目）都**必传**且非 0，缺任一则 hook 拦截（见上「定位」）。企业私有仓库会静默忽略 create 时传入的 `labels`，紧跟一次 `update_enterprise_issue(label_ids=...)` 补上。入参名以工具 schema 为准，不凭印象。
- **创建归属标注**（2026-10-03 定规）：`assignee_id` **必传**，缺则 hook 拦截。根工单与子工单同一套规则；创建人身份一律取 `get_user_info` 返回的当前 token 用户 id，不硬编码。
  - 发单时**点名了负责人** → `list_enterprise_members(search=<名字>)` 解析成 id 作 `assignee_id`，创建人并入 `collaborator_ids`；解析不到或多人同名 → **停下问发单人**，不静默兜底。
  - **未点名** → 创建人即负责人（`assignee_id`=创建人 id），`collaborator_ids` 可空。
  - 点名负责人**且另有协作者** → 创建人也必须并入 `collaborator_ids`（Gitee 支持多协作者）。
- **创建后核验**：用 `get_enterprise_issue_detail(new_ident)` 核对 `description` 非空、`project_id` 和 `program_id` 均与请求值一致、`assignee`/`collaborators` 与「创建归属标注」判定一致；子 issue 还要核对 `parent_id` 与父项 `id` 一致。再用 `list_enterprise_issues(project_id=<请求的仓库 ID>, search=new_ident)` 反查，确认目标仓库可见。字段不符或反查不到时，先修正并再次核验，全部通过后才交付。错名参数（如把描述传到 `body`）会被静默忽略，已踩坑建成空描述工单（IK5THP）；PR / Release 创建后也须回读关键字段。查询/回读一律用 get/list 类工具，**禁止为「确认结果」重放 create 类调用**——Gitee 对同名 PR 去重才未产生第二张（!964 实证），属侥幸不构成保证。
- **创建子 issue（交 Agent）**：先 `get_enterprise_issue_detail(parent_ident)` 读父项，子项使用 `parent_id=父项.id`，继承 `project_id`/`program_id`，工程拆分按[父子工单类型映射](#父子工单类型映射)选择 `issue_type_id` 和 `category`；新发现的缺陷按「缺陷关系」处理。任务标题用 `V版本号【<前端|后端>】<任务标题>`，例如 `V版本号【后端】画布视频节点提取音频（media_extract）`，`前端|后端` 标明改动归属端。跨端改动拆成前端/后端两个子项。create 后 `update_enterprise_issue` 补 `ready-for-agent` label_ids，再按「创建后核验」检查实际类型、父子关系、归属和仓库可见性；查不到则不交 Agent。
  - 产品需求下的工程交付不建子需求，实际类型按同一映射选择。父需求的业务验收归对应测试或产品负责；Agent 记录自己的工程交付，按状态权威核对父提测与逐票收口授权。
  - **父工单正文的标题前缀（如「改造/维护/优化/修复」）不覆盖本条**：若父项要求分类前缀，仍在版本号后标明「端」（`V版本号【前端】/【后端】`），分类写进正文；不要为了迁就父项格式把 `issue_type` 改成需求型。
- **读取**：`get_enterprise_issue_detail` 取详情；`list_enterprise_issue_comments(enterprise_id, issue_id)` 取评论。
- **列出**：`list_enterprise_issues`，`state` 过滤（open/closed/rejected/progressing），`label_ids` 过滤（数字 ID）。粗状态仅用于检索分组，不用于业务阶段、完成或依赖解锁判断。
- **查子工单（按父找子）**：list 无 parent_id 参数；`search=<父单号>` 查不到子工单，子工单标题是 `V版本号【前端|后端】<标题>`，不含父单号，空搜索结果不代表无子；父单详情 `parent_id=0` 只说明它无父，推不出无子。正确姿势：分别查询 open、progressing、closed、rejected 的全部分页，客户端按 `parent_id == <父单数字 id>` 筛选并按数值 ID 去重。未完成分页不能声明集合完整。接手规格父单（implement-spec / implement / triage 认领）第一步必查：子工单即任务图节点，按其 body 的“前置工单”声明定串行依赖与 frontier，兼容旧工单的 `Blocked by`，不按父单正文自行切阶段（IKH3ZE 实证：search 空结果误判无子票开工，实际已切三票）。
- **评论**：`comment_enterprise_issue(enterprise_id, issue_id, body)`。
- **标签**：`update_enterprise_issue(label_ids=...)`，数字 ID。Triage 五标签：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix，详见 `docs/agents/triage-labels.md`。
- **创建 PR**：`create_enterprise_repo_pull` **必传数字 `project_id`**——工具描述写「Project ID or PathWithNamespace」，**实际传 PathWithNamespace（如 `hangzhou-xuanfu_1/blue-whale-ai`）会 404「仓库不存在」**，勿被误导。
- **合并 PR**：`merge_enterprise_pull` 的 PR 编号参数名是 `pull_request_id`（无 `pull_number` 入参，传错报「pull_request_id required」）；传 `merge_method=merge`（或不传）；工具**无 `prune_source_branch` 参数**，Gitee merge 默认不删源分支，事后跑 `scripts/cleanup-task-worktree.sh`。
- **关闭**：`update_enterprise_issue(issue_state_id=...)`，**非 `state`**（工具无此入参）。状态枚举随工作项类型变——先 `list_issue_type_states(enterprise_id, issue_type_id)` 查，有效枚举与流转条件见 [Agent 工作流手册](gitee-workflow-agent.md)。已上线表示完成，已关闭表示作废；业务判断使用细状态。

## 状态读取与写入

先读 [Agent 工作流手册](gitee-workflow-agent.md) 判断事件、证据、角色与授权，再按本文执行 MCP 操作。状态表只在该手册维护。

1. `get_enterprise_issue_detail` 读取 ident、数值 id、实际类型、归属、负责人、协作者、标签和正文。读取相关评论、验收安排及前置证据。
2. 响应有细状态时读取 `issue_state.id/title`。缺字段时，用 `list_enterprise_issues(project_id, search=<ident>, issue_state_ids=<候选细状态 ID>)` 精确筛选，并核对唯一 ident、数值 id、project_id 与 program_id。候选取实际类型的有效枚举，不能从粗状态推断。零条只排除该候选；分页未完成、重复身份、结果冲突或无法唯一确定均视为状态未知，停止依赖写入。
3. 需要修改状态时调用 `update_enterprise_issue(issue_state_id=<目标>)`，只传必要字段，状态更新不携带 `description`。已处目标态时跳过该状态写入，仍核对本轮部署、验收和交接条件。
4. 通过 detail 与仓库限定 list 回读目标字段和归属。细状态仍缺失时复用第 2 步精确筛选。核对正文、标签、协作者等未请求字段保持原值。正文维护另行按共同 SOP 的富文本保护执行，接口回读不能替代编辑态验证。
5. 失败或结果未知时按 [渠道规则](../../agent-rules/gitee-mcp-only.md) 查询结果，禁止盲目重放。枚举错误重新读取实际类型的状态池，不能换另一个进度状态绕过条件。未同步成功时置顶报告「⚠️ 工单状态未同步」，列工单、目标状态名和 ID；只继续不依赖该结果的本地工作。

### 开工认领

worktree 成功只是开工事件，能否流转或恢复由状态权威判定。满足条件后，状态与负责人在同一次最少字段更新中写入：

- 执行人取 `get_user_info` 当前 token 用户 id，作 `assignee_id`。
- 新协作者 = 既有协作者 ∪ {原负责人} − {执行人}。原负责人存在且不是执行人时追加，既有协作者保留；计算结果与现状一致时不传 `collaborator_ids`。
- 归属、并发或交接不明时停止依赖写入，不因 token 或负责人相同直接认领恢复。

### PR 标签与工程记录

PR 创建成功后，保留业务状态，记录 PR 链接与验证证据，补 `ready-for-review`。用 `list_enterprise_labels` 核对标签 ID，先读现有标签，再合并 `label_ids` 整体写回并回读。合并 PR 同样只记录工程结果，后续按状态权威判断部署和验收。历史标签保留，不批量清理。

## 规格与拆单适配

`to-spec`、`to-tickets`、`implement-spec` 的通用完成指令在本仓按下列职责执行，技能原文保持不变。

- 新功能规格的新父单为需求型，新缺陷规格的新父单为缺陷型；既有单保持已核对的实际类型与归属。子单按[父子工单类型映射](#父子工单类型映射)创建。发布规格和拆单属于规划交付，新单保留类型初始态，不走免业务测试路线结束产品父单。
- 父规格的测试决策写整体用户行为、验收环境、验收负责人、默认随父验收安排和生产复验要求。
- 子单在现有「验收标准」中写自身工程验证条件、对应父规格交付行为、业务验收归属。默认随父验收；独立验收例外明确范围与真实入口条件。
- 「前置工单」写编号、标题、链接与解锁要求，兼容旧 `Blocked by`。同包工程、外部必须先入 release、验收或环境前置按 [集成分支工作流](integration-branch-workflow.md#工程依赖与任务图) 判断。
- implement-spec 的 resolve、合回和任务图解锁表示工程交付，按集成规则保留现有 Git 入口和证据；业务阶段、父提测及逐票收口按状态权威判断。

## 术语映射

- **publish to the issue tracker** → 见上「创建」。
- **fetch the relevant ticket** → `get_enterprise_issue_detail` + `list_enterprise_issue_comments`。
- **request surface**：外部 PR 不作功能请求入口。

## 子 issue 迁移

子项在企业工作台父项下可见，但仓库 Issues 页 / `list_enterprise_issues(project_id, search=ident)` 查不到时：

1. 读父项详情，确认 `id`/`project_id`/`program_id`/`issue_type.id`。
2. 每个子项 `update_enterprise_issue` 补 `parent_id`/`project_id`/`program_id`。
3. 每子项更新后即 `list_enterprise_issues(project_id=父项 project_id, search=子项 ident)` 验证仓库可见。
4. Gitee 若不许后改归属：重建仓库可见子 issue（复制标题/正文/父子/标签），旧项评论“已迁移”并关闭。

## Wayfinding operations

供 `/wayfinder` 用。**map** = 单个 Gitee issue，**child** = map 的子 issue。语义见 `/wayfinder` SKILL.md，本节只定义 Gitee 物理实现。

- **标签命名（Gitee 不支持冒号）**：`/wayfinder` 文本写 `wayfinder:map` / `wayfinder:<type>`（GitHub 习惯），Gitee 实测不支持冒号，本仓用连字符——map 标签 `wayfinder-map`；type 标签 `wayfinder-<type>` ∈ `wayfinder-research` / `wayfinder-prototype` / `wayfinder-grilling` / `wayfinder-task`。先在 Gitee「标签管理」建齐 5 个。
- **Map**：`create_enterprise_issue(title=<map 名>, project_id=<仓库 id>, program_id=<项目 id>)`，紧跟 `update_enterprise_issue(label_ids=<wayfinder-map 数字 id>)`（labels 静默忽略）。body 填 Destination / Notes / Decisions-so-far / Not yet specified / Out of scope（模板见 `/wayfinder` SKILL.md）。
- **Child ticket**：`create_enterprise_issue(parent_id=<map issue id>, project_id=<继承 map>, program_id=<继承 map>, issue_type_id=<按父子工单类型映射>, category=<同表对应值>)`，紧跟 `update_enterprise_issue(label_ids=<对应 type 标签数字 id>)`。`<type>` ∈ research / prototype / grilling / task，仅表示 wayfinder 标签分类，不决定工作项实际类型。继承流程见上「创建子 issue」。
- **Blocking**：Gitee MCP 没有原生阻塞关系；`create_enterprise_issue` 的 `link_issue_id` 只建立弱关联，创建时可传，update 没有对应参数。依赖写入正文“前置工单”章节，每项包含标题、编号和链接；兼容旧工单的 `Blocked by` 章节或 `Blocked by:` 行。逐项按 [工程依赖与任务图](integration-branch-workflow.md#工程依赖与任务图) 核对成果及解锁要求，不能以粗状态 `closed` 作为统一解锁条件；`link_issue_id=<blocker ident>` 可作为辅助关联。
- **Frontier query**：按父查子，查询方法见“操作约定·查子工单”。排除归属未明确交接及任一声明前置未满足的子工单；兼容上述新旧依赖声明，按创建顺序取首个。
- **Claim**：`update_enterprise_issue(issue_id=<ticket>, assignee_id=<自己 user id>)`。user id 用 `get_user_info` 查。开放未分配 = 未认领。**实质工作前先 claim**，避并发抢同一 ticket。
- **Resolve**：① `comment_enterprise_issue(issue_id=<ticket>, body=<answer>)` 发结论；② 记录本票工程验证及交付指针，保持业务状态，按依赖要求判断后续可用性；免业务测试成果只有满足状态权威的 C 条件才收口；③ 向 map 正文的 `## Decisions so far` 追加 `- [<标题>](<url>) — <gist>`，先读取最新正文并核对编辑模式，按共同 SOP 保留富文本后增量修改、验证，不经普通 `description` 整体写回。
