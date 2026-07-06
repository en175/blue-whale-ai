# Workflow Decisions

## 已确定决策

1. 这个工作台先做 Agent 编排资产，不先写后端工程代码。
2. 编排采用 CEO 路由器模式，参考 douyin-workspace 的组织方式。
3. 核心是多 Agent 协作 + 渐进式披露 + Canvas 确认门。
4. Canvas 是事实来源，对话只是意图来源。
5. 每个关键阶段必须等待用户确认。

## 待后续细化

- Skill 库的具体分类和命名。
- 每类视频 Skill 的模板。
- Canvas 节点字段是否要转成后端 schema。
- 是否需要增加真实 Provider 接入说明。
- 是否需要为前端画布写交互规范。
