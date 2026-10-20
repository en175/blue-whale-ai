# Issue tracker: Gitee

> **正文格式保护：** MCP 读取的 Markdown／HTML 不代表编辑模式；富文本正文不得用普通 `description` 整体写回。正文变更遵守共同 SOP 的“Gitee 富文本保护”，使用保留格式的编辑入口，保存后重进编辑态核验图表。改其他字段不带正文。

仓库 `git@gitee.com:hangzhou-xuanfu_1/blue-whale-ai.git`（网页 https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues）。优先 MCP 工具，不可用时回退网页。

## ID 解析约定（通用，先于任何 `mcp__gitee-ent__*` 调用读）

> 本节是**所有**企业版 MCP 调用（issue / PR / 仓库 / 标签……）的通用约定，不限于 issue 创建。

**黄金法则：`enterprise_id` 与 `project_id` 永远动态查，永不从网页 URL 抄。** 本仓三个固定 ID 的兜底值（日常直接用、免查询）见 CLAUDE.md「Gitee ID 兜底常量」；疑似变更或 401 时按本节动态查。

Gitee 的两类标识符是脱节的，这是最易踩的陷阱：

| 标识符 | 出现在哪 | 能否直接用于 API |
|---|---|---|
| 网页路由 ID（如 URL `projects/883843` 的 `883843`） | 网页 URL | ❌ **绝不可**——既非 enterprise_id 也非 project_id |
| `enterprise_id`（如 `16660949`） | 仅 `list_enterprises` 返回 | ✅ |
| `project_id`（如 `48854568`） | 仅 `list_enterprise_repositories` 返回 | ✅ |
| PR 编号（URL `pulls/93` 的 `93`） | 网页 URL | ✅ URL 里**唯一**可直接抄的数字 |
| issue ident（如 `IJZYUL`） | 网页 URL / 工单标题 | ✅ 字符串标识，非数字 ID |

**误传 ID 的症状具有误导性**：把网页路由 ID 当 `enterprise_id` 传入，Gitee 返回 `401 企业未授权此应用进行访问`——这条信息**措辞误导**，实为「该 ID 指向的企业不存在」，与 OAuth 授权无关。遇到此 401，**先判 token 再判 ID**，不要先怀疑授权：

```
步骤 1  调 get_user_info()
          ├─ 成功 → token 有效 → 进入步骤 2
          └─ 401  → token 失效/类型不符（普通版 REST 报 "Access token is wrong type"）
步骤 2  token 有效仍 401 = ID 错（最常见）
          调 list_enterprises() 核对真实 enterprise_id
```

**一键解析**：`scripts/gitee-resolve-ids.sh resolve <PR/issue URL>` 输出企业 path、仓库 path、资源编号，并标注 URL 中哪个数字是陷阱、给出可直接执行的 MCP 查询模板。`check-id` 子命令校验单个 ID 值，`diagnose-401` 打印上面的决策树。新同事拿到一条 URL，第一步就跑它。

## 定位

企业版 MCP（`mcp__gitee-ent__*`）用以下 ID 定位，**非 owner/repo**：

- **enterprise_id**：`list_enterprises` 查，按 `path == "hangzhou-xuanfu_1"` 取 `id`。
- **project_id**（仓库 ID）：`list_enterprise_repositories` 查。创建 issue **必传**——不传则工单只进企业工作项、仓库 Issues 页不可见，PreToolUse hook `block-issue-without-repo.sh` 硬拦。
- **program_id**（项目 ID）：`list_programs` 查（按 `name`/`search` 命中 Blue-Whale-AI 项目）。根 issue 创建**必传**且非 0——不传（=0）则工单游离于企业「项目管理」之外，同一 hook 硬拦。值不写死，对齐 ADR-0007 D5 动态查。
- **label 数字 ID**：`list_enterprise_labels` 查；`label_ids` 传逗号分隔的数字 ID（非名称）。标签长度 2–20、非特殊字符。

## 操作约定

- **创建**：`create_enterprise_issue(enterprise_id, title, description, project_id=..., program_id=...)`。根 issue 的 `project_id`（仓库）和 `program_id`（项目）都**必传**且非 0——缺任一则 hook 硬拦（见上「定位」）。标签不能在 create 落——企业私有仓库 `labels` 静默忽略，紧跟一次 `update_enterprise_issue(label_ids=...)` 补。**创建后必须 `get_enterprise_issue_detail` 回读确认 `description` 非空**——错名参数（如把描述传到 `body`）被静默忽略，已踩坑建成空描述工单（IK5THP）；回读验证是防静默忽略的通用要求，PR / Release 创建后同样适用；入参名以工具 schema 为准，不凭印象。
- **创建子 issue（交 Agent）**：先 `get_enterprise_issue_detail(parent_ident)` 读父项，子项继承 `parent_id`/`project_id`/`program_id`，但 `issue_type_id` **一律用「任务」(1292680)**——子工单一律任务型，不继承父需求型（2026-08-25 定规）。**标题命名：`V版本号【<前端|后端>】<任务标题>`**（例：`V目标版本【后端】画布视频节点提取音频（media_extract）`）——`前端|后端` 标明改动归属端。跨端改动拆成前端/后端两个子任务，不建「子需求」。create 后 `update_enterprise_issue` 补 `ready-for-agent` label_ids，再 `list_enterprise_issues(project_id=parent.project_id, search=new_ident)` 反查；查不到 = 发布失败，不交 Agent。
  - **子任务，不是子需求**（2026-08-25 定规）：技术侧在产品建的需求工单下记录自己的工作时，只能建**任务**（`issue_type_id=1292680`），绝不能建「需求」型子项。需求（含技术维护母工单 IKAZIG 这类需求型父项）由产品/人关闭，Agent **只完成自己的子任务**，不得把父需求置为已完成/关闭。
  - **父工单正文的标题前缀（如「改造/维护/优化/修复」）不覆盖本条**：若父项要求分类前缀，仍在已确认的版本号后标明「端」（`V版本号【前端】/【后端】`），分类写进 body；不要为了迁就父项格式把 `issue_type` 改成需求型。
- **读取**：`get_enterprise_issue_detail` 取详情；`list_enterprise_issue_comments(enterprise_id, issue_id)` 取评论。
- **列出**：`list_enterprise_issues`，`state` 过滤（open/closed/rejected/progressing），`label_ids` 过滤（数字 ID）。
- **查子工单（按父找子）**：list 无 parent_id 参数；`search=<父单号>` 查不到子工单——子工单标题是 `V版本号【前端|后端】<标题>`，不含父单号，空搜索结果不代表无子；父单详情 `parent_id=0` 只说明它无父，推不出无子。正确姿势：`list_enterprise_issues(project_id, state="open", per_page=100, sort="created_at", direction="desc")` 客户端筛 `parent_id == <父单数字 id>`（工单详情返回的 `id` 字段）。接手规格父单（implement-spec / implement / triage 认领）第一步必查：子工单即任务图节点，按其 body 的 `Blocked by` 声明定串行依赖与 frontier，不按父单正文自行切阶段（IKH3ZE 实证：search 空结果误判无子票开工，实际已切三票）。
- **评论**：`comment_enterprise_issue(enterprise_id, issue_id, body)`。
- **标签**：`update_enterprise_issue(label_ids=...)`，数字 ID。Triage 五标签：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix，详见 `docs/agents/triage-labels.md`。
- **创建 PR**：`create_enterprise_repo_pull` **必传数字 `project_id`**——工具描述写「Project ID or PathWithNamespace」，**实际传 PathWithNamespace（如 `hangzhou-xuanfu_1/blue-whale-ai`）会 404「仓库不存在」**，勿被误导。
- **合并 PR**：`merge_enterprise_pull` 传 `merge_method=merge`（或不传）；工具**无 `prune_source_branch` 参数**，Gitee merge 默认不删源分支，事后跑 `scripts/cleanup-task-worktree.sh`。
- **完成或终止**：`update_enterprise_issue(issue_state_id=...)`，非 `state`。先查询当前类型的合法状态；是否完成按下方实际交付与验收判断，不能把 PR 合并或粗状态 closed 当上线。

## 任务状态与真实交付

按 [蓝鲸产研协作规则](bluewhale-product-sop.md) 执行。先核对 PRD 评审和产品确认，再开始受影响的业务代码修改；建 worktree、提交或合并 PR 本身均不构成评审、验收或上线证据。

| 节点 | 状态与责任 |
| --- | --- |
| 开始执行 | 需求／任务进入开发中，缺陷进入修复中；须已具备规格、认领和当前操作授权 |
| 提交、创建或合并 PR | 不自动置完成态；按仓库约定更新审查标签，不能代替部署与验收 |
| 实际候选部署到测试环境 | 有部署证据后可按授权提测，进入测试-待测试 |
| 测试及发布前验收通过 | 测试确认后进入待发布；随父需求一起测的子任务也必须有对应测试结论 |
| 实际部署生产 | 按授权进入生产-待验证；部署不等于验收 |
| 生产验证与测试、产品共同验收通过 | 两环境验证均通过后，依角色权限进入已上线；不能代签验收 |
| 不通过或放弃 | 测试／生产相应打回，研发接回开发中／修复中后重新验证；已关闭用于放弃等终止情形 |

- 纯文档、调研及测试专项按实际交付目标处理，不虚构部署。子任务交付不自动完成父需求。
- 读细状态 `issue_state.title`，不可仅按粗状态 `state` 判断。写前用 `list_issue_type_states` 查询当前类型的合法 ID，不沿用退役的「已完成／已修复／已验收」状态 ID。
- 已有其他人在做、处于测试／待发布／生产待验证或已终止时，先确认接手或返工范围，不自动抢占或重开。
- 状态、标签、评论均须处于当前用户授权范围；测试结论、共同验收、优先级和发布放行由相应负责人确认。只读任务及 `--no-issue` 任务不自动流转工单。
- 改状态不带 `description`；补标签先读现有列表再合并写回。写后回读；失败先确认实际状态再决定是否重试，不盲目重复提交，未同步如实报告。

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
- **Child ticket**：`create_enterprise_issue(parent_id=<map issue id>, project_id=<继承 map>, program_id=<继承 map>, issue_type_id=<任务 1292680>)`，紧跟 `update_enterprise_issue(label_ids=<对应 type 标签数字 id>)`。`<type>` ∈ research / prototype / grilling / task。继承流程见上「创建子 issue」。
- **Blocking**：Gitee MCP 无 native dependencies——`create_enterprise_issue` 的 `link_issue_id`（创建时传入，无 update 对等项）只建弱关联（UI 可见，非阻塞）。回退 body 约定：ticket body 顶部写 `Blocked by: <标题> (<ident>)`，每行一个。unblocked 以各 blocker 的约定交付物和接收结论为准（逐个读取细状态及证据）；粗状态 closed 不足以证明依赖就绪。`link_issue_id` 可选辅助：创建子 ticket 时传 `link_issue_id=<blocker ident>`。
- **Frontier query**：按父查子（查询姿势见「操作约定·查子工单」），剔除有 `assignee`（已认领）+ body 含未闭环 `Blocked by:` 的；按创建顺序取首个。
- **Claim**：`update_enterprise_issue(issue_id=<ticket>, assignee_id=<自己 user id>)`。user id 用 `list_enterprise_members` 查。开放未分配 = 未认领。**实质工作前先 claim**，避并发抢同一 ticket。
- **Resolve**：① `comment_enterprise_issue(issue_id=<ticket>, body=<answer>)` 发结论；② 依实际目标、当前合法状态及操作授权处理任务状态，不自动关闭业务父需求；③ 往 map body 的 `## Decisions so far` 追加 `- [<标题>](<url>) — <gist>`——先回读最新正文及编辑模式，按“正文格式保护”增量更新；富文本不得经普通 `description` 拼接后整体写回。
