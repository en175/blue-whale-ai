# 编排决策清单（Grilling 产出）

> 日期：2026-07-10
> 来源：一次 `/grilling` session 对 Blue-Whale Agent Canvas 编排设计的逐点拷问
> 状态：候选图消歧（决策 21）已合并 master（ba401c0），本分支 `docs/补编排决策到规则` 基于 ba401c0 落 10 条决策
> 性质：PM 产品行为 + 给后端/前端的实现约束

## 背景

针对编排设计里的优先级冲突、跨 branch 状态转换、确认门边界、asset 理解时机等漏洞，逐条拷问得出 10 条决策。核心哲学贯穿始终：

- **PM 定「用户做什么动作 → 系统怎么响应」**；数据模型 / branch 路由 / 状态机归后端
- **用户掌控、结果回画布**：生成不打断、结果回画布用户决定去留
- **明确动作触发理解**：不偷偷扫画布，靠用户点选/上传/@ 触发视觉理解
- **少摩擦、相信用户**：低成本 stage 弱继续直接推进，高成本 stage 才二次确认

## 决策总览

| # | 决策 | 类型 | 落点文档 |
|---|---|---|---|
| 1 | Brief 未确认时换产品：半成品 Brief 文本不保留、不进 previous；上传图 asset 保留画布；visible_reasoning 声明废弃不弹确认 | PM 行为 | `skill/rules/product_switch_p0.md` 第 2 类 |
| 2 | 画布全展示不折叠；用户靠看图点选不靠 title | PM 行为 | `skill/rules/canvas_state_rules.md` / `skill/references/frontend_canvas_interaction_contract.md` |
| 3 | asset 归属 product_context（系统记，用户不看） | 后端约束 | `skill/references/backend_implementation_contract.md` |
| 4 | understanding 触发：生图意图 + 未明确指向 → 提示点选/上传/@ → 明确动作才调视觉模型；非生图不触发 | PM 行为 | `skill/workflows/image_understanding.md` 触发节 |
| 5 | 未引用态 asset 只有上传元信息；已理解态带 understanding | 后端约束 | `skill/references/backend_implementation_contract.md` |
| 6 | 内容相同的上传图视为同一 asset，去重 + understanding 复用（看内容不看文件名） | 后端约束 | `skill/references/backend_implementation_contract.md` / `skill/rules/canvas_state_rules.md` |
| 7 | 生成链路不可打断：不取消、不打断、结果回画布；generation_in_progress 分支细分收窄 | PM 行为 | `skill/rules/decision_layer.md` / `skill/workers/director_agent.md` |
| 8 | 生成中用户意图跨 turn 记最后一个，生成完主动提醒接上 | PM 行为 | `skill/workers/director_agent.md` |
| 9 | prompt_only 后说「生成」→ 走生成链路，已优化 prompt 传参数不重优化 | PM 行为 | `skill/rules/generation_route_decision.md` |
| 10 | 确认门弱继续按 stage 风险：低成本直接推进，视频生成二次确认 | PM 行为 | `skill/rules/confirmation_gate.md` / `skill/workflows/video_agent_canvas.md` |

## 决策详情

### 1. Brief 未确认时同项目换产品

**场景**：Full Canvas Stage 1 Brief 确认门（Brief 未 confirmed），用户说「不做了，换成咖啡机」（同品类，第 2 类）。

**问题**：当前 `product_switch_p0.md` 第 2 类「将当前 active_product_context 移入 previous_product_context」——但当前 Brief 是半成品，移入 previous 后用户切回拿到未确认 Brief，状态污染。

**决策**：
- 半成品 Brief 文本**不保留**，不进 `previous_product_context`（不构成可恢复产品方向）
- Brief 阶段已上传的图片 asset **保留在当前画布**，可复用
- 模型在 `visible_reasoning` 声明废弃 + 下一步，**不弹确认**
- 新产品从 Stage 1 Brief 重新收集
- 已 confirmed 的生成结果保留（沿用第 2 类「旧内容不删除」）

**给后端约束**：`previous_product_context` 不含未确认 Brief；移入 previous 的 Brief 必须是 confirmed 状态。

**落点**：`skill/rules/product_switch_p0.md` 第 2 类补段 + 「与确认门的关系」节。

### 2. 画布全展示 + 用户靠看图点选

**决策**：
- 画布**全展示**，不折叠、不设历史区（既定设计）
- 用户靠**看图点选**认素材，不靠 node title 区分产品
- node title 是辅助（无障碍 / 搜索），不是用户区分产品的主依据

**落点**：`skill/rules/canvas_state_rules.md` Node title 三位一体节补注 + `skill/references/frontend_canvas_interaction_contract.md`。

### 3. asset 归属 product_context

**决策**：每个 asset 记归属 `product_context`。

**给后端约束**：asset 必须带 `product_context` 归属字段，供 revise 节点定位、引用匹配、前端选中态透传时按产品过滤。

**落点**：`skill/references/backend_implementation_contract.md`。

### 4. understanding 触发时机

**决策**：
- **生图意图 + 用户未明确指向素材时**，系统主动提示用户点选/上传/@
- 用户做明确动作（点选 / 上传 / @）后才调视觉模型
- 非生图场景不触发 understanding
- 对齐决策 21 候选图消歧（count≥2 反问带候选）

**落点**：`skill/workflows/image_understanding.md` 触发条件节明确「生图意图 + 未明确指向 → 提示点选/上传/@」。

### 5. asset 信息两态

**决策**：

| 状态 | 模型能拿到 | 何时进入 |
|---|---|---|
| 未引用态 | 上传元信息：`asset_id` / 文件名 / title / 尺寸类型 | 上传后、未被引用 |
| 已理解态 | 上述 + `asset_understanding`（subject / 内容摘要） | 第一次被选中/@/进生成引用时算 |

**给后端约束**：`previous_product_context` 的 asset 按此分层——被引用过的带 understanding，只上传没引用的只有元信息。

**落点**：`skill/references/backend_implementation_contract.md` + `skill/workflows/image_understanding.md`。

### 6. 内容相同去重

**决策**：内容相同的上传图视为同一 asset，不重复展示、不重复做 understanding，复用已有 understanding。

| 情况 | 判定 |
|---|---|
| 同图改文件名（像素一致） | 同一 asset，去重 |
| 不同图（内容有差异，即便相似） | 不同 asset，都保留 |

**给后端约束**：去重看内容不看文件名（哈希 / 感知哈希由后端选）；同图 understanding 复用不重算。

**落点**：`skill/references/backend_implementation_contract.md` + `skill/rules/canvas_state_rules.md`。

### 7. 生成链路不可打断

**决策**：
- 用户发起生图后，**默认不取消、不打断生成链路**，结果生成完返回画布成品
- 用户在画布确认门决定去留（保留 / 重做 / 换 prompt）
- `generation_in_progress` 分支细分收窄为：

| 用户说 | 模型回应 |
|---|---|
| 好了吗 / 还在吗 | 提示生成中 |
| 怎么样了 | 读状态 / preview（有则展示） |
| 取消 / 不要了 | **不取消**，诚实说「生成已启动会跑完，结果出来你在画布决定」 |
| 换 prompt 重来 | 不打断，记下意图，结果出来在确认门 revise |
| 做另一个 | 不并行，记下排队，结果出来再接 |

- 生成失败（Provider 自己报错）不算「取消」，走 `generation_failed` 分支（重试 / 修改 / 取消，已有）
- P0 不支持并行启新 Job

**落点**：`skill/rules/decision_layer.md` generation_in_progress 分支 + `skill/workers/director_agent.md` switch 表。

### 8. 生成中意图接上

**决策**：
- 模型跨 turn 记住生成中用户表达的**最后一个**意图
- 生成完 `turn_done` 时主动提醒接上（如「成品回来了。你刚才说要换 prompt，要基于这版改还是重做？」）
- 多个意图只记最后一个

**给后端约束**：模型需跨 turn 记忆生成中用户的修改/新需求意图（对话记忆，非画布状态），在生成完成 turn 提醒。

**落点**：`skill/workers/director_agent.md` generation_in_progress 分支。

### 9. prompt_only 转生成

**决策**：
- 用户在 `prompt_only` 后说「生成」→ **走生成链路**
- 已优化的 prompt 作为参数传给生图/视频模型，**不重新走 Optimizer**
- 生成链路内部「要不要走 Optimizer」由后端判断（有优化好的就用，没有才走 Optimizer）

**给后端约束**：`optimized_prompt_preview` 要能复用为 GenerationJob 的 input，不重优化。

**落点**：`skill/rules/generation_route_decision.md` prompt_only 节。

### 10. 确认门弱继续按 stage 风险

**决策**：

| stage | 弱继续处理 |
|---|---|
| 低成本（Brief / 首批视觉） | 弱继续 → **直接推进** |
| 高成本（视频生成） | 弱继续 → **二次确认** |
| 明确确认 + has_ready_node | 一律推进（不变） |
| 修改意图 | 进 revise（不变） |

**理由**：生成哲学「不打断」针对已启动生成；确认门防误推进到烧资源 stage。视频生成成本远高于生图，误推进代价大，值得二次确认。

**落点**：`skill/rules/confirmation_gate.md` 弱继续节 + `skill/workflows/video_agent_canvas.md` 硬停标注成本等级。

## 后端约束汇总（给后端对齐用）

1. `previous_product_context` 不含未确认 Brief；移入 previous 的 Brief 必须 confirmed
2. asset 带归属 `product_context` 字段
3. asset 两态：未引用态只有上传元信息，已理解态带 understanding
4. `previous_product_context` 的 asset 按引用状态分层带 understanding
5. 内容相同上传图去重（看内容不看文件名），understanding 复用不重算
6. `optimized_prompt_preview` 可复用为 GenerationJob input，不重优化
7. 模型跨 turn 记忆生成中用户最后一个修改/新需求意图，生成完成时提醒
