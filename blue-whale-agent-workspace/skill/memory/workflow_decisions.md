# Workflow Decisions

## 已确定决策

1. 这个工作台先做 Agent 编排资产，不先写后端工程代码。
2. 编排采用 CEO 路由器模式，参考 douyin-workspace 的组织方式。
3. 核心是多 Agent 协作 + 渐进式披露 + Canvas 确认门。
4. Canvas 是事实来源，对话只是意图来源。
5. 每个关键阶段必须等待用户确认。
6. 判定分层(2026-07-06,决策 16-20):硬状态→后端代码(铁闸);意图方向+路由→L1 轻量 classifier(haiku 级,软建议);确认门四分类+输出+调度→主 Agent。后端每轮算 `decision_context`(硬事实 + L1 软建议 + 组合 `decision_branch`)喂主 Agent,主 Agent `switch(decision_branch)` 收口。废除 Full Canvas 内部 L2,全场景统一 `decision_branch`。`advance_stage` 独立校验 `has_ready_node`(confirm_pending 铁闸)。权威见 `skill/rules/decision_layer.md`。
7. 候选图消歧(2026-07-08,决策 21):画布多图 + 用户未指明时不默认扫描/不猜,在 `@` 引用解析阶段反问带候选(对齐决策 3/5,不挂 understanding workflow 内)。候选范围 = 当前 `active_product_context` 内 `ready`/`confirmed` image(不取全部图——跨产品引用必须显式,见 `product_switch_p0.md` 第 4/5 类)。判定优先级:`reference_asset_ids`(@引用)> `active_asset_id`(前端选中态透传,P0 选中即识别不追问)> 候选=1 唯一张 > 候选≥2 反问。自然语言指代「这张」在候选≥2 时不算明确,主 Agent 禁止靠「最近 ready/第一张/刚生成」猜(= 默认扫描变体)。`active_asset_id` 不定义过期(纯文生不进 understanding 自动兜底)。消歧答法三条硬路径:点选画布高亮图 / @某张 / 上传新图;不认纯编号「第3张」。多图引用(`@A @B`)保留 @ 机制,各 asset 单独 understanding,`usage_intent` 复用历史→推断→`optimized_prompt_preview` 暴露。**id 统一 asset_id**:pointed 复用请求体 `reference_asset_ids`(删 pointed_node_ids),active 用 `active_asset_id`,候选 `candidate_asset_ids`;revise 场景收 active_asset_id 反查 node(`node.asset_ref`)。前端现状 mock,`@`/上传/选中三条路现都不通,接后端 P0 必做(node_id/asset_id 全后端生成,前端不得 mint)。权威见 `skill/workflows/image_understanding.md` 候选图消歧节 + `skill/references/backend_implementation_contract.md` 硬约束 14/15。

## 待后续细化

- 前端 P0(接后端时必做,候选图消歧生效前提):建 turn 请求层 / @引用带 asset_id(`reference_asset_ids`)/ 上传 asset 进载荷 + 对话框上传入口 / `active_asset_id` 透传(选中态)/ 消歧高亮候选 UI / id 全用后端生成(前端不得 mint)。
- Skill 库的具体分类和命名。
- 每类视频 Skill 的模板。
- Canvas 节点字段是否要转成后端 schema。
- 是否需要增加真实 Provider 接入说明。
- 是否需要为前端画布写交互规范。
