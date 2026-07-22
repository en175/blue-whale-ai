# 同对话多产品历史 PRD（P0）

> 把 `FRONTEND-INTEGRATION-ROADMAP.md` §模块10 的 `content_versions`（结构化产品记忆）从 P1 提到 P0，解决单对话多产品「切不回」问题。对话压缩、版本索引保持 P1。
> 版本：P0 · 日期：2026-07-13

## 0. 怎么读 + 关联文档

实现前**必读**：

- `AGENT-CONVERSATION-PRD.md` —— Agent turn 契约、每轮硬状态代码（§产品上下文）。
- `skill/rules/product_switch_p0.md` —— 运行时产品切换规则（**已同步**：两槽位 → N 槽位 `content_versions` + active 指针 + 阈值引导，见 §11）。
- `skill/references/backend_implementation_contract.md` —— 字段权威定义层，本文不重定义字段，只引用。
- `PRD/ORCHESTRATION-DECISIONS.md` 决策 1 —— 半成品 Brief 不保留口径，本文沿用。

本文定义：模块10 里哪些 P1 项提到 P0、产品行为规格、给后端的约束边界。不替后端选实现。

---

## 1. 背景问题

三个约束叠加，导致「同对话切回之前产品」做不了：

1. **无新建对话出口** —— 当前编排不支持「新开对话 / 重置」，所有产品需求挤在同一个 Agent 对话窗口（三份 PRD 零相关设计）。用户心智默认「对话能记住」。
2. **LLM 长会话丢上下文** —— 对话足够长，早期 messages 被 context 物理截断。
3. **P0 设计为两槽位,会挤掉最旧产品** —— skill 设计层(见 `AGENT-CONVERSATION-PRD.md` 硬状态代码)是 `active_product_context` + `previous_product_context` 两槽位,切到第三个产品最早方向被覆盖找不回。**2026-07-21 后端扫描**:agent turn / product_context 整条零实现(后端实体只有 Project/Canvas/Asset/Job/Skill/UserSkill/TemplateCard,无 product_context / messages / agent_events),两槽位尚未落地——本 PRD 的 `content_versions` 是从零设计,不替换既有实现。

结果：用户在一段对话里做过多个产品，想切回之前某个，**切不回或被覆盖**。

---

## 2. 目标 / 非目标

### 目标（P0）

- 同一 Agent 对话内，**可恢复的多产品历史**：用户能切回任意历史产品方向，按上次断点继续做。
- 产品记忆**不依赖 LLM 上下文**：靠后端结构化 `content_versions` 每轮重喂 LLM。LLM 压缩做不做都不影响产品记忆。
- **容忍但有界**：不鼓励无限单对话堆产品，到阈值引导用户新开 project，分流到 project 层。

### 非目标（P0 不做）

- 对话压缩 / 历史摘要（`conversation_summary`）—— P1 评估。
- 版本索引（`version_index`）—— P1 评估。
- `messages` 与 `agent_events` 分离的完整历史系统 —— P1。
- 跨 project 切换替代本需求 —— project 列表 UI 另管（见 §4）。
- 常驻产品列表 UI 组件 —— 见 §5.2。
- 半成品 Brief 保留 / 草稿位 —— 见 §5.5。

---

## 3. 核心方案：产品记忆与对话压缩解耦

### 调研结论

Codex / Claude Code / OpenCode 三者的压缩机制本质相同：**整段对话历史 → LLM 生成摘要 → 用摘要开新会话**。差异只在裁剪策略（Codex 单层 handoff；Claude Code 三层渐进：工具结果裁剪 → prompt 压缩 → 全量 handoff；OpenCode 隐藏 system agent 自动压）。

三者**都有损**，且都因「没有结构化事实来源」只能靠压对话硬扛。这是公认痛点，催生了一堆第三方持久记忆插件。

### 本产品的分层

本产品有 Canvas（事实来源）+ `content_versions`（产品方向结构化状态），不需要学它们把产品记忆塞进对话压缩：

| 层 | 负责什么 | 载体 | P0 |
|---|---|---|---|
| **产品记忆层** | 记住「做过哪些产品、各做到哪」 | 后端 `content_versions`，每轮重喂 LLM | **做** |
| **对话压缩层** | 解决 token 溢出，让 Agent 能一直聊 | 抄三者压缩（P1 选型） | 不做 |

**产品记忆永远不靠 LLM 压缩** —— 压缩丢它的，画布和 `content_versions` 在后端纹丝不动，每轮原样注入 Agent turn。

### 上下文保留承诺（诚实边界）

- **能保证保留**：产品上下文（硬状态）—— 做过哪些产品、各 Brief / skill / stage / 画布节点 / 资产理解。走 `content_versions` 每轮重喂，不依赖 LLM 记。
- **不能 100% 保留**：对话流细节（软上下文）—— 当时怎么聊、随口偏好、没沉淀进字段的商量过程。不做压缩，对话足够长后这部分会丢。靠 §5.4 阈值引导控制单对话长度缓解。

---

## 4. 概念分层

| 概念 | 定义 | 切换载体 |
|---|---|---|
| **project** | 可见容器，有列表 / 命名 / 切换 UI。一个 project = 一段连续对话（messages 持久化到 project） | project 列表 UI（跨对话） |
| **product（产品方向）** | 一个创作主体（保温杯 / 咖啡机 …），存为一条 `content_version` | Agent 语言指代（对话内） |
| **content_version** | 一个 Brief confirmed 的产品方向的完整结构化状态 | —— |
| **对话压缩** | messages 历史 token 压缩 | P1，不管产品记忆 |

**用户痛点落在 product 层、对话内**，不是 project 层、不是跨对话。用户心智是「一段对话里来回切产品」，不是「跨 project」。

---

## 5. 产品行为规格

### 5.1 用户操作集合

- **切到新产品** —— 当前 active 进 history，新产品变 active。
- **切回历史产品** —— 历史某条变 active，当前进 history。
- **跨产品引用** —— 在 A 下引用 B 的资产生成新节点，不切 active（沿用 P0 规则第 5 类，previous 单槽 → N 槽）。
- **局部修改** —— 不切产品，沿用 active（见 `rules/revise_canvas.md`）。

### 5.2 用户怎么指代（消歧）

- **主通道：自然语言 + 画布素材**。画布全量显示所有产品节点，用户看着画布说「切回保温杯那个」「继续做咖啡机」，Agent 用 `subject_summary` 做 name / keyword 匹配。
- **失败兜底：临时文字列表**。语言匹配不上（歧义 / 用户记不清），Agent **在对话流里临时文字列出**当前对话的产品方向供选（"你这段对话做过：1.保温杯 2.咖啡机 3.耳机，要切哪个？"）。**只读、非常驻组件**，命中即不弹。
- **不做常驻 UI 组件**。画布已是产品素材的可视化，无需额外列表。PRD 不写前端新组件需求。

### 5.3 切回后的行为（关键）

- 切回**只换 active 产品方向，不主动推进**。
- 用户需求不清时 Agent **追问**（"你想接着分镜往下，还是改 Brief，还是引用重新生成？"），搞明白才推进。不替用户决定干啥。
- **不重过确认门** —— 切回的产品 Brief / Skill 已 confirmed 存在 `content_version`，不重新问，除非用户明说「重新做」。
- **画布全量不过滤** —— 切回产品 A，B / C 的节点仍显示（画布是 project 级事实来源）。「当前主线是 A」是 LLM context 层的事，靠 `content_versions` 喂模型，不靠画布过滤。

> 以上为产品行为意图（grilling 已锁）；具体追问时机与字段、画布状态恢复实现由工程落地定。

### 5.4 阈值引导（容忍但有界）

- **意向阈值 = 3**：`content_versions` 里 `status ≠ superseded` 的方向数到 3，Agent 软提示一次。
- **软提示，不强制**：用户坚持留在当前对话，`content_versions` 继续 append，不强拦。
- **品类跳跃强推新 project**：完全不同品类 / 目标（保温杯广告 → 招聘宣传片），从现状「问一下」升级为**明确建议新 project** —— 这不是同对话多产品，是另一个创作任务。
- **具体阈值数值与触发实现由工程评估**（意向值 3，P1 按真实用户行为校准）。

### 5.5 写入门槛

- 一条 `content_version` 在 **Brief confirmed 时**写入。
- 半成品 Brief（未 confirmed）**不进** `content_versions`（沿用 `ORCHESTRATION-DECISIONS.md` 决策 1）。已上传图片 asset 留画布可复用。
- 探索阶段（传图未确认 Brief）不占历史位 —— 探索不算正式产品方向，丢了重说成本低。

> 产品意图已锁（confirmed 才进、半成品不保留）；Brief 状态机哪个节点判定为 confirmed、写入触发机制由工程落地定。

---

## 6. 给后端的约束（不替后端选实现，给边界）

1. **字段** —— `content_versions` 字段沿用 ROADMAP §模块10 设计：`project_id` / `subject_summary` / `product_asset_ids` / `brief` / `selected_skill` / `stage_plan` / `storyboard` / `status(active|inactive|superseded)` / `created_from`。`product_context` 完整字段（`product_name` / `asset_understanding` / `last_stage` / `canvas_node_ids` 等）进每条 version。
2. **每轮 Agent turn 必须收到** —— 当前 active `content_version`（全量字段）+ 全量 history 摘要（每条 version 的 `subject_summary` + status，非全量字段）。这是产品记忆不丢的机制保证，与 LLM 压缩无关。
3. **写入门槛** —— `content_versions` 只在 Brief confirmed 时写入；半成品 Brief 不进。
4. **画布全量** —— 画布展示 project 全部 canvas nodes，不按产品过滤。`canvas_node` 打 product 归属标签（后端定实现），用于跨产品引用时取资产。
5. **阈值计数** —— 后端提供 `content_versions` 里 `status ≠ superseded` 的计数；阈值引导的判定与软提示由 Agent 做，后端不强拦。
6. **数据模型演进** —— 现有 `active_product_context` + `previous_product_context` 两槽位 → `content_versions` 列表 + active 指针。演进路径由工程定。

---

## 7. 用户可见话术（不暴露内部词）

**允许**：产品 / 产品方向 / 之前那个产品 / 继续 / 新开项目
**禁止**：替换 / 覆盖 / workflow / stage / run / superseded / content_version / version

阈值引导话术（示例）：
> 这段对话已经做了几个不同产品方向，新产品要不要新开一个项目单独做？更好管理。

切回追问话术（示例）：
> 好的，我会继续按这个产品方向来。你想接着上次的进度往下，还是有新的调整？

---

## 8. 不做（P0 边界清单）

- 无限单对话堆产品（阈值 3 分流到 project 层）
- 常驻产品列表 UI 组件
- 半成品 Brief 保留 / 草稿位
- 对话压缩 / `conversation_summary` / `version_index`（P1）
- `messages` / `agent_events` 分离完整历史（P1）
- 跨 project 切换替代本需求

---

## 9. P1 评估项

- **对话压缩方案选型** —— Codex 单层 handoff / Claude Code 三层渐进 / OpenCode 隐藏 agent。三者都有损，需评估本产品 token 成本与软上下文丢失容忍度。
- **阈值数值校准** —— 意向 3，按真实用户行为调。
- **superseded 淘汰策略** —— `content_versions` 何时从 inactive 转 superseded、是否物理保留。
- **软上下文结构化** —— 用户随口偏好 / 品牌约束是否进 `content_version` 字段，降低对压缩的依赖。

---

## 10. 待工程评估（本次不定）

- 阈值触发实现（计数来源、提示时机、是否记会话避免重复提示）
- 两槽位 → `content_versions` 数据模型演进路径
- `canvas_node` product 归属标签实现
- 每轮 history 摘要的 token 预算（N 条 `subject_summary` 喂模型的开销）

---

## 11. 关联文档同步（已完成）

- `skill/rules/product_switch_p0.md` —— 已从两槽位（active / previous）改为 N 槽位（active + `product_history`），6 类判断重写，含阈值引导（第 6 类）+ 写入门槛（Brief confirmed）。
- `PRD/FRONTEND-INTEGRATION-ROADMAP.md` §模块10 —— `content_versions` / 历史资产引用 / 恢复版本 已提 P0（行 96 / 105–107 / 128）；`conversation_summary` / `version_index` 保持 P1。
- `PRD/AGENT-CONVERSATION-PRD.md` 硬状态代码 —— `previous_product_context` 已升级为 `product_history_summary`（行 90）。

---

## 附录：决策来源（grilling 收口，2026-07-13）

9 条锁定决策：

| # | 决策 | 归属 |
|---|---|---|
| 1 | 多产品历史是刚需 —— 单对话承载所有产品，新建对话出口缺失 | P0 |
| 2 | 记忆走后端 `content_versions` 结构化，**不走 LLM 压缩**（调研证三者压缩都有损） | P0 |
| 3 | project 保留为可见容器，痛点在 **project 内**，非跨 project | — |
| 4 | 同一对话内多产品（用户心智是产品级并行） | P0 |
| 5 | 纯自然语言指代 + 画布素材辅助 + 失败临时列表兜底，**不加常驻 UI** | P0 |
| 6 | 阈值引导（意向 3 软提示 + 品类跳跃强推新 project）；具体数值 / 实现工程评估 | P0 |
| 7 | `content_versions` 写入时机 = **Brief confirmed**；半成品不保留（沿用决策 1） | P0 |
| 8 | 画布全量不过滤 / 切回不主动推进要追问 / 跨产品引用扩 N 槽不切 active | P0 |
| 9 | 对话压缩 + 阈值数值校准 + superseded 淘汰策略 + 软上下文结构化 | P1 评估 |
