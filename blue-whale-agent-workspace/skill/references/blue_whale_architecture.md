# Blue-Whale Agent Canvas Architecture

## 核心模型

Blue-Whale 式视频 Agent 不是单次提示词系统，而是一个画布状态驱动的多 Agent 编排系统。

```text
用户
  -> CEO / Director Agent
  -> Brief Agent
  -> Skill Selector
  -> Storyboard Agent
  -> Generation Agent
  -> Review Agent
  -> Canvas
  -> 用户确认
```

## 分层

### 1. 用户交互层

负责输入、展示、确认和修改。

### 2. CEO 路由层

负责判断当前应该做什么。

### 3. Worker Agent 层

每个 Agent 只做一个阶段。

### 4. Workflow 层

负责阶段顺序、阻断条件和确认点。

### 5. Canvas 状态层

保存事实：当前有什么结果、结果属于哪个阶段、是否 ready。

### 6. Provider 层

未来才接真实图片/视频生成模型。

## 后端落地契约

当这套编排进入工程实现时，读取 `backend_implementation_contract.md`。

它定义：

- Agent Turn 返回结构
- `visible_reasoning` 和 `trace_event` 的区别
- Canvas Node 字段
- Workflow Run / Stage 状态
- 用户确认、修改、重试动作
- 前端应该展示什么
- 后端必须验证的硬约束

前端交互实现读取 `frontend_canvas_interaction_contract.md`。

它定义：

- Agent 思考过程如何展示
- Canvas 节点如何展示
- 确认、修改、重试按钮如何发送结构化动作
- 哪些内部信息不能出现在普通用户界面

## 为什么先做编排

如果没有编排，后端接再多模型也会出现：

- 信息没问清就生成
- 生成结果无法确认
- 用户说“继续”就误推进
- 脚本、分镜、图片、视频状态混在一起
- 修改时不知道该重做哪一步

所以先把 Skill、Workflow、确认门写清楚，再让工程实现。
