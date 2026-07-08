# Workflow Decisions

## 已确定决策

1. 这个工作台先做 Agent 编排资产，不先写后端工程代码。
2. 编排采用 CEO 路由器模式，参考 douyin-workspace 的组织方式。
3. 核心是多 Agent 协作 + 渐进式披露 + Canvas 确认门。
4. Canvas 是事实来源，对话只是意图来源。
5. 每个关键阶段必须等待用户确认。
6. 判定分层(2026-07-06,决策 16-20):硬状态→后端代码(铁闸);意图方向+路由→L1 轻量 classifier(haiku 级,软建议);确认门四分类+输出+调度→主 Agent。后端每轮算 `decision_context`(硬事实 + L1 软建议 + 组合 `decision_branch`)喂主 Agent,主 Agent `switch(decision_branch)` 收口。废除 Full Canvas 内部 L2,全场景统一 `decision_branch`。`advance_stage` 独立校验 `has_ready_node`(confirm_pending 铁闸)。权威见 `skill/rules/decision_layer.md`。

## 待后续细化

- Skill 库的具体分类和命名。
- 每类视频 Skill 的模板。
- Canvas 节点字段是否要转成后端 schema。
- 是否需要增加真实 Provider 接入说明。
- 是否需要为前端画布写交互规范。
