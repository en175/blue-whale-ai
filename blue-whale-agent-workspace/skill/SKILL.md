---
name: blue-whale-agent-canvas
description: Blue-Whale 式 AI 视频画布编排 Skill。用于把用户的视频创作需求拆解为多 Agent 协作、渐进式披露、Skill 选择、分镜规划、生成任务、画布确认门和修改重试流程。触发场景：AI 视频 Agent、Video Agent Canvas、产品视频、UGC 广告、短剧、品牌广告、分镜生成、画布确认、视频生成工作流。
---

# Blue-Whale Video Agent Canvas

> **用本 Skill 时，你就是主 Agent（Director）。** 第一步读 `workers/director_agent.md` 拿运行时决策：读 `decision_context` → `switch(decision_branch)` → 按分支动作收口。判定分层架构（硬状态后端算 / L1 轻量 classifier / 主 Agent 收口）见 `rules/decision_layer.md`。
>
> 本文件是入口与导航，主 Agent 决策权威 = `director_agent.md`，本文不重复。

这是一个编排 Skill，不是单次生成提示词。

**自包含安装**：所有依赖（workers / workflows / rules / references / library / memory）都在 `skill/` 目录内。安装 = 把整个 `skill/` 目录复制到目标 Agent 的 skills 路径；工作台的 `CLAUDE.md` / `AGENTS.md` / PRD / tests 不需要带上。

使用本 Skill 时，Agent 必须按“CEO 路由器 + 子 Agent + Workflow + Canvas 确认门”的方式工作。

## 快速执行顺序（每轮 turn）

1. 读后端算好的 `decision_context`（硬事实 + L1 软建议 + 组合 `decision_branch`）。
2. `switch(decision_branch)` 收口——动作表见 `workers/director_agent.md`。
3. 按分支路由：新任务 → workflow；确认门 → 四分类；产品切换 → `rules/product_switch_p0.md`；信息不足 → `rules/progressive_disclosure.md` 追问。
4. 关键结果写 canvas 后，按 `rules/confirmation_gate.md` 停住等确认。
5. 用户明确确认才推进。

## 资源导航

| 目标 | 读取文件 |
|---|---|
| 整体架构说明 | `references/blue_whale_architecture.md` |
| 完整视频画布流程 | `workflows/video_agent_canvas.md` |
| 直接生成轻量流程 | `workflows/direct_generation.md` |
| 生图提示词流程 | `workflows/image_generation_prompt.md` |
| 图片识别流程 | `workflows/image_understanding.md` |
| 主 Agent 唯一权威(决策+角色) | `workers/director_agent.md` |
| 需求收集 | `workers/brief_agent.md` |
| Skill 匹配 | `workers/skill_selector.md` |
| 图片识别/资产感知 | `workers/image_understanding_agent.md` |
| 生图提示词 | `workers/image_prompt_agent.md` |
| 提示词优化 | `workers/prompt_optimizer_agent.md` |
| 脚本和分镜 | `workers/storyboard_agent.md` |
| 生成任务 | `workers/generation_agent.md` |
| 质量审核 | `workers/review_agent.md` |
| 渐进式披露 | `rules/progressive_disclosure.md` |
| 确认门 | `rules/confirmation_gate.md` |
| 画布状态 | `rules/canvas_state_rules.md` |
| 用户可见思考过程 | `rules/visible_reasoning.md` |
| Skill 与生成规则优先级 | `rules/skill_generation_priority.md` |
| 判定分层架构（decision_context + switch） | `rules/decision_layer.md` |
| 生成链路路由 | `rules/generation_route_decision.md` |
| P0 产品切换 / 回到前一个产品 | `rules/product_switch_p0.md` |
| 多模态能力判断 | `rules/multimodal_capability.md` |
| 提示词优化链路 | `rules/prompt_optimization_chain.md` |
| 输出格式 | `references/output_contract.md` |
| 生图提示词格式 | `references/image_prompt_contract.md` |
| Seedance 2.0 提示词语法 | `references/seedance_prompt_optimizer.md` |
| 后端落地数据契约 | `references/backend_implementation_contract.md` |
| 前端画布交互契约 | `references/frontend_canvas_interaction_contract.md` |
| Worker 编写标准 | `references/worker_authoring_standard.md` |
| Foundry 式编排借鉴 | `references/foundry_style_orchestration_notes.md` |

## 核心原则

- CEO 只调度，不亲自完成所有创作。
- 子 Agent 只负责自己的阶段，不越权推进。
- Workflow 负责顺序和阻断条件。
- Canvas 是事实来源。
- 用户确认是推进阶段的必要条件。

## 交付标准

每次任务至少明确：

- 当前阶段
- 当前 canvas 有哪些结果
- 用户需要确认什么
- 如果用户不满意，可以怎么改
- 下一阶段会发生什么
