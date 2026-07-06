# Foundry Style Orchestration Notes

本文件记录从 Microsoft Foundry Skill 结构中借鉴的编排方法。

目标不是复制 Azure / Foundry 的工程细节，而是借鉴它的 Skill 组织方式，让 Blue-Whale Agent Workspace 更像一个可维护、可执行、可落地的多 Agent 编排系统。

## 借鉴什么

### 1. 主 Skill 只做路由

主入口不承载所有细节，只负责：

- 判断用户意图
- 选择子 workflow
- 指示必须读取的子文档
- 定义全局规则

Blue-Whale 对应：

```text
用户输入
  -> generation_route_decision
  -> direct_generation / image_generation_prompt / image_understanding / video_agent_canvas
```

### 2. 子 Workflow 必须先读

进入任何具体流程前，必须先读取对应 workflow 文件。

例如：

- 直接生成视频：读 `workflows/direct_generation.md`
- 做产品图：读 `workflows/image_generation_prompt.md`
- 图片转视频：读 `workflows/image_understanding.md` + `workflows/direct_generation.md`
- 完整广告视频：读 `workflows/video_agent_canvas.md`

不能只凭主 Skill 的概述执行。

### 3. User Intent -> Workflow 表

用清晰表格把用户意图映射到 workflow，避免所有请求都走同一个大流程。

Blue-Whale 当前映射：

| 用户意图 | Workflow |
|---|---|
| 直接生成图片 | `image_generation_prompt.md` |
| 直接生成轻量视频 | `direct_generation.md` |
| 让上传图动起来 | `image_understanding.md` + `direct_generation.md` |
| 复杂广告/UGC/短剧视频 | `video_agent_canvas.md` |
| 只优化提示词 | `prompt_optimization_chain.md` |

### 4. 状态契约

Foundry 用 `.foundry/` 管理 agent metadata、eval suite、dataset 等状态。

Blue-Whale 后端落地时应有等价状态层：

```text
canvas
workflow_run
stage
node
agent_turn
asset_understanding
optimized_prompt
trace_event
```

对应文件：

- `backend_implementation_contract.md`
- `canvas_state_rules.md`

### 5. Observe / Optimize 分离

提示词优化不是随便润色，而是一个独立流程：

```text
draft prompt
  -> optimizer
  -> optimized prompt
  -> provider
```

优化层只能做模型适配，不能改用户确认过的创意策略。

对应文件：

- `prompt_optimization_chain.md`
- `prompt_optimizer_agent.md`

## 不借鉴什么

以下内容属于 Foundry/Azure 工程部署范畴，不迁移到 Blue-Whale 编排工作台：

- Azure RBAC
- quota / region / capacity
- azd deploy
- Foundry MCP 工具调用
- hosted agent adapter
- Dockerfile / agent.yaml 部署规范
- Azure credential 生命周期

这些只有未来真实部署到 Foundry 或 Azure 时才需要。

## 对当前工作台的要求

1. 主 `SKILL.md` 必须保持路由清晰。
2. worker 必须是角色化、可执行文档，不只是职责列表。
3. workflow 必须说明触发条件、阶段、产物、阻断条件。
4. references 必须承接复杂细节，避免主入口膨胀。
5. tests/scenarios 应该验证路由和禁止事项。
