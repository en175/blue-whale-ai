# Gitee 企业版能力边界查证

> 调研：评估 destination「企业项目管理工具（企业「项目」/工作项看板）作唯一 issue 入口，仓库 Issue 页废弃/只读」的 Gitee 平台可行性。
> 触发工单：[IK0CPI](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK0CPI)（wayfinder-research）。所属 map：[IK0CP7「统一 Issue 入口：企业项目管理工具为唯一系统」](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK0CP7)。
> 来源：Gitee 官方帮助中心（help.gitee.com）、OpenAPI V5 Swagger、官方套餐页 + 本仓已落地基础设施（ADR / hook / 实测）。置信度逐条标注。

## 结论（TL;DR）

1. **「禁用 / 只读仓库 Issue 页」系统层面不可行**（置信度：高）。Gitee 无 "Issues on/off" 开关（不像 GitHub）；唯一能让 Issue 只读的「关闭仓库」会连带锁死代码 Push/PR。仓库存在且开启 → Issue 入口永远可新建。只能退化为**流程约定**（团队不去仓库页建单），无系统强制。
2. **企业工作项可脱离 repo 独立存在且不镜像仓库页**（置信度：高）。`project_id=0` 是 Gitee 平台「无关联」哨兵，工作项只进企业工作项看板、仓库 Issues 页不可见（ADR-0007 + 事件 IJZ5WA 实证）。**当前阻断全在本项目自建设施**（`block-issue-without-repo.sh` hook + ADR-0007/0008 + issue-tracker 规则），非 Gitee 平台限制——删/改这些即解锁。
3. **企业工作项 API 每日创建上限「官方未公开、实测存在」**（置信度：政策未找到 / 阈值高）。官方文档查不到「企业工作项每日创建配额」，OpenAPI 仅给通用 5000 次/小时频率限制；但本仓实测 `create_enterprise_issue`（`/enterprises` API）单日建 ~10 个即返回「今天发布的 issue 已到达上限」。**这是未公开配额**，与客服「issue 无限制」口径冲突——该口径仅指仓库 issue（`/v5/repos/` API，另一套系统）。
4. **工作项与仓库 issue 是两套独立实体、两套配额**（置信度：高），非同一份数据、无双向同步，仅 commit/PR「关联引用」。label/type/state 三套模型各自独立不互通。

**对 destination 的影响**：方向（企业工作项为中心）符合 Gitee 企业版产品导向，**平台层支持工作项作主入口**（可独立存在不镜像）；但「仓库 Issue 页废弃/只读」这一条**系统层面做不到**，只能退化为流程约定 + 双轨数据人工去重。确定 destination 前必须先经 Gitee 企业版客服/工单确认两件事：(a) 企业工作项每日创建配额的阈值/套餐/提额；(b) 仓库 Issue 是否有付费版隐藏开关或 roadmap。**不要基于「issue 创建无限制」做容量规划**——该口径官方查无实据。

---

## Q1. 仓库 Issue 页能否禁用 / 隐藏 / 设为只读？

**结论：不能。Gitee 无 "Issues on/off" 开关**（置信度：高）。

Gitee 仓库状态功能影响范围（官方原文表）：

| 功能模块 | 功能点 | 开启 | 暂停 | 关闭 |
|---|---|---|---|---|
| Issue | 新建、编辑、评论、指派、状态流转、关联仓库 | ✅ | ✅ | ❌ |
| 代码 | 删除代码、Push | ✅ | ❌ | ❌ |
| PR | 新建、合并、回退、关闭、编辑、指派 | ✅ | ❌ | ❌ |

- 「暂停」：Issue 全部操作仍 ✅ → 对禁用 Issue 无效。
- 「关闭」：Issue 全 ❌（等同只读），但代码/PR 也全只读 → **代价过大，不能用作「只禁 Issue」**。官方原文：「关闭状态的仓库将进一步限制仓库功能，仅保留查看/Pull 代码、访问仓库、修改仓库状态」。
- 仓库设置菜单（仅有项，无 Issue 开关）：存储库 GC、百度统计、仓库镜像、仓库状态、仓库转移、删除仓库。
- 路径：仓库主页 →「管理」→「仓库设置」→「仓库状态」。企业版新版本功能（旧版本无）。

来源：
- https://help.gitee.com/repository/settings/status
- https://help.gitee.com/repository/settings

## Q2. 企业「项目」(program) 工作项与仓库 Issue 的数据关系

**结论：两套独立实体，非同一份数据，无双向同步**（置信度：中-高；官方未公开底层模型，但从编号/权限/删除行为可确证）。

- **编号体系不同**：仓库 issue = `I` 开头仓库级编号（如 `I1U9MB`）；企业工作项 = 项目内编号，归企业项目。
- **官方用「关联」非「同步」**：工作项入门列「关联工作项/测试用例/PR/文档」；Commit 关联 Issue 文档区分「个人版只能关联本仓库任务；企业版可关联企业所有任务」——是引用，非状态同步。
- **删除行为证明独立**：官方「删除项目仅删项目本身，不删项目下仓库；但项目下所有工作项随项目删除」→ 工作项随项目删，仓库 issue 不受影响，二者数据独立。
- **仓库页「关联项目」=跳转入口**，非把工作项复制进仓库 Issue 页。

推断（官方无逐字原文）：企业工具删工作项 → 仓库 Issue 页本就无此条，仅 commit/PR 里的关联引用可能变失效链接；反之亦然。

来源：
- https://help.gitee.com/enterprise/project/issue/issue-intro/issue-intro
- https://help.gitee.com/enterprise/code-manage/代码评审/Pull%20Request/开发协作/Commit%20关联%20Issue
- https://help.gitee.com/enterprise/project/questions

## Q3. 企业工作项能否脱离 repo 独立存在（不绑 project_id），且不留仓库页镜像？

**结论：能。平台层完全支持**（置信度：高）。当前阻断是本项目自加约束。

证据链（本仓已落地基础设施）：

1. **API 层**：`create_enterprise_issue` 的 `project_id` 在 MCP schema 里**非 required**（required 仅 `enterprise_id` + `title`）。Gitee 用 `project_id=0` 表示「无关联」哨兵——ADR-0007 D3 原文：「`0` 是 Gitee 的『无关联』哨兵」。
2. **实测可见性**（事件 IJZ5WA，ADR-0007 触发事件）：`project_id=0` 的 issue 在企业工作项列表可见，**仓库 Issues 页找不到**。hook 源码注释：「不关联仓库的 issue 只出现在企业工作项列表，仓库 Issues 页看不到」。
3. **即「不留镜像」= destination 想要的形态**：工作项独立存在于企业工作项看板，仓库 Issue 页零镜像。

**当前三层阻断（全在本项目，非 Gitee 平台）**：

| 层 | 文件/决策 | 作用 |
|---|---|---|
| Hook | `.claude/hooks/block-issue-without-repo.sh` | PreToolUse 硬拦（exit 2）：`create` 缺 `project_id` / `=0`，或子项带 `parent_id` 缺 `project_id`/`program_id` |
| ADR | [ADR-0007](../adr/0007-issue-must-link-repo.md)（issue 必须关联仓库）、[ADR-0008](../adr/0008-sub-issues-must-inherit-repo.md)（子 issue 必须继承） | 决策：「Blue-Whale 的所有 issue 都归属 blue-whale-ai 仓库，不存在也不打算要『企业级、无仓库』工单」 |
| 规则 | `docs/agents/issue-tracker.md`「创建 issue **必传** project_id」 | 操作规范 |

**destination 反转路径明确**：删/改 hook + 反转 ADR-0007/0008 + 改 issue-tracker.md「必传 project_id」→ 工作项可 `project_id=0` 独立存在不镜像仓库页。这是 map「基础设施反转」(IK0CPO) 的核心动作之一。

> 注：ADR-0007 D1 曾显式否决「企业级工单逃生口」（YAGNI），destination 恰是要推翻该 YAGNI 判断——属决策层，非技术阻断。

## Q4. label / issue_type / state 模型

**结论：三套各自独立，企业工作项与仓库 issue 不共享**（置信度：高）。

- **Label 两套**：企业标签（「企业管理→功能管理→标签设置」，用于工作项 + PR，企业级跨仓共享）vs 仓库标签（「仓库→标签管理」，用于该仓库 Issue + PR，仓库级）。管理入口/作用域均不同 → 互不通用。
- **issue_type**：企业工作项独有（系统默认需求/任务/缺陷，可细化 Epic/Story/子类型）；仓库 issue **无 type 概念**（只有 label + milestone）。社区版 ❌ / 企业版 ✅ 的分水岭。
- **State 两套状态机**：企业工作项自定义四属性（待办/进行中/已完成/已拒绝），支持自定义工作流/流转角色/审批流（尊享版）；仓库 issue 固定 open/closed。企业工作项「已完成」≠ 仓库 issue「closed」。

**迁移成本**：destination 全进企业工作项 → 现有仓库 issue 的 label 体系无法复用，需在企业级重建。本仓 AI Agent triage 五标签（needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix）现挂仓库 issue label，迁企业工作项需重建为企业标签（`list_enterprise_labels` 体系）。

来源：
- https://help.gitee.com/enterprise/management/functions/labels
- https://help.gitee.com/base/issue/labels
- https://help.gitee.com/enterprise/management/functions/issues
- https://help.gitee.com/enterprise/project/issue/issue-settings/status-setting

## Q5. MCP（`mcp__gitee-ent__*`）对企业工作项的支持完整度

**结论：CRUD + 元数据基本完整，三个缺口**（置信度：高，基于工具 schema + `docs/agents/issue-tracker.md` 操作手册）。

支持完整：

| 操作 | 工具 |
|---|---|
| 创建 | `create_enterprise_issue` |
| 读取 | `get_enterprise_issue_detail` |
| 列出 | `list_enterprise_issues`（state/label_ids/project_id/program_id 过滤） |
| 更新（标题/正文/assignee/branch/deadline/priority 等） | `update_enterprise_issue` |
| 关闭 | `update_enterprise_issue(issue_state_id=...)`（终态，非 `state`） |
| 评论 | `comment_enterprise_issue` / `list_enterprise_issue_comments` |
| 元数据 | `list_issue_types` / `list_issue_type_states` / `list_enterprise_labels` |
| 归属 | `parent_id` / `program_id` / `project_id` / `assignee_id` 均可设 |

缺口：

1. **无 delete**：工具列表无 `delete_enterprise_issue`。工作项只能「关闭」（置终态），不能删。误建工作项只能关闭+评论说明，无法清除。
2. **无 native blocking**：`update_enterprise_issue(link_issue_id=...)` 只建弱关联（UI 可见，非阻塞）。wayfinder 阻塞关系回退 body 约定（ticket body 写 `Blocked by: <标题> (<ident>)`，逐个 `get` 查 `state=="closed"` 判 unblocked）。
3. **list 无 parent_id 参数**：`list_enterprise_issues` 不能按父项过滤，需客户端筛 `parent.id == <map id>`。
4. **label 不能 create 时落**：企业私有仓库 `create` 的 `labels` 静默忽略，必须紧跟 `update_enterprise_issue(label_ids=...)` 补（数字 ID）。

**对 destination**：MCP 对企业工作项 CRUD 足够支撑 AI agent 工作流（create/list/get/comment/close 全链路）。缺 delete 不阻断（关闭即可）；无 native blocking 是既有限制（已回退 body 约定跑通）。

## Q6. 企业工作项 API 每日创建上限（重点）

**结论：官方文档未公开「企业工作项每日创建配额」；实测存在（~10/日）；「issue 无限制」官方查无实据**（置信度：政策未找到 / 阈值高 / 风险高）。

### 实测（本仓，2026-07-11 charting map IK0CP7）

- `create_enterprise_issue` MCP 走 `https://api.gitee.com/enterprises`（**企业工作项 API**），单日建 ~10 个后返回「**今天发布的 issue 已到达上限，请明天再试**」。
- grep 确认文案系 API 透传、非 MCP（`@gitee/mcp-gitee-ent`）本地逻辑；重试仍顶 = 日计数；次日重置；`update_enterprise_issue` **不占配额**。
- 客服口径「issue 创建无限制」**仅指仓库 issue**（`/v5/repos/` API，另一套系统、另一套配额）。

### 官方文档（agent 查证）

- **OpenAPI 速率限制**（通用，非工作项专属，置信度高）：未授权 60 次/小时、单用户单 IP 120 次/小时、**已授权 5000 次/小时**。这是接口调用频率，非「每天能建多少工作项」的业务配额。
- **官方公开配额维度**：人数、仓库容量、单文件大小、附件/知识库容量、GiteeGo 时长、**项目数量**、代码推拉并发、仓库副本数。**无一页面提及 issue/工作项的每日或总量创建上限**。
- **「无限制」口径只覆盖**：仓库数量（套餐容量内不限）、项目数量（标准版+ 不限）。**不含 issue/工作项创建数**——「issue 创建无限制」在官方文档**找不到明确出处**。
- **套餐差异**：免费版项目限 10；标准版/尊享版项目不限。工作项随项目走。「工作项创建数」随套餐的差异表官方未列。
- **提额途径**：尊享版「定制化资源配额」；专业版（私有部署）联系销售。均未明确覆盖工作项创建配额。OpenAPI 频率无公开提额渠道。

来源：
- https://gitee.com/api/v5/swagger （速率限制）
- https://help.gitee.com/enterprise/billing/service-package （套餐配额全表）
- https://help.gitee.com/enterprise/quickstart/enterprise-FAQ
- https://help.gitee.com/enterprise/project/questions

### 张力

实测 ~10/日 与官方「5000 次/小时」差两个数量级 → **存在未公开的业务层每日创建配额**（API 频率限制之外）。官方文档不承认、客服口径矛盾。这是 destination「全进企业工作项」的最大不确定性。

---

## 对 destination（企业项目管理工具作唯一入口）的影响

**1. 「仓库 Issue 页废弃/只读」系统层面不可行（Q1，硬伤）。**
Gitee 无 Issue 开关，唯一只读途径=关闭仓库=锁死代码。仓库存在且开启 → Issue 入口永远可新建。destination 这一条只能退化为**流程约定 + 同事培训**（map 已有 ticket IK0CPJ「同事走两路的真实根因调研」+ IK0CPL「单一网页入口指引 + 培训」），无系统强制。双轨数据（工作项 + 仓库 issue）需人工去重或明确分工。

**2. 「企业工作项作主入口」平台层可行（Q3，正面）。**
工作项可 `project_id=0` 独立存在不镜像仓库页。阻断全在本项目自建设施（hook + ADR-0007/0008 + 规则），反转即解锁。这是 map「基础设施反转」(IK0CPO) 的核心。

**3. 每日创建上限是最大风险（Q6，未公开配额）。**
destination「全进企业工作项」意味着所有 issue（含 AI agent 批量建单）走 enterprises API。实测 ~10/日 的未公开配额，在团队日常 issue 量下**可能被卡**——尤其 wayfinder charting 一次性建多个 ticket 时（本 map charting 已撞顶，深层 ticket 留次日补建）。**确定 destination 前必须经 Gitee 企业版工单/销售拿到书面口径**：阈值、套餐差异、提额途径。若阈值确为 ~10/日 且无提额，destination 需重新评估（可能保留仓库 issue 作 AI agent 高频建单通道，企业工作项作人工管理入口）。

**4. label/state 迁移有成本（Q4）。**
全进企业工作项 → triage 五标签需重建为企业标签，state 流转重设计。非阻断，但属「重定分类与 label 与流转规范」工作量（map destination 已列）。

**5. MCP 支持足够（Q5，正面）。**
企业工作项 create/list/get/comment/close 全链路 MCP 可跑，AI agent 工作流不阻断。缺 delete / native blocking 是既有限制，已回退方案跑通。

### 建议（供 map 决策）

- destination 方向成立，但**「废弃/只读仓库 Issue 页」需从 destination 措辞中下调为「流程上不以仓库 Issue 页为入口」**——系统做不到强制只读。
- **destination 锁定前，阻塞项 = Q6 工单确认**（配额阈值/套餐/提额）。这是 IK0CPI 给 map 的关键信号：若配额卡死，destination 要分流（AI agent 高频建单留仓库 issue，人工管理进企业工作项），而非「全进」。
- 短期可接受双轨：企业工作项=研发管理主入口，仓库 Issue 页=代码侧轻量入口，commit/PR 关联打通。
