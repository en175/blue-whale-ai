# Blue-Whale Agent Workspace

这是一个用于设计 Blue-Whale 式 Video Agent Canvas 的 Agent 编排工作台。

它不是后端代码项目，也不是单个提示词，而是一套可交给 Agent、产品、前端和后端工程继续落地的编排规则系统。

## 这个工作台解决什么

目标是把用户的自然语言需求，稳定地拆成：

```text
用户输入
  -> 意图识别
  -> 选择生成链路
  -> 图片理解 / Brief / Skill 选择
  -> 提示词或分镜生成
  -> 提示词优化
  -> Provider 生成
  -> Canvas 展示
  -> 用户确认或修改
```

核心不是“直接生成”，而是让 Agent 知道：

- 当前该走哪条链路
- 什么时候需要追问
- 什么时候可以默认补全
- 什么时候必须先识别图片
- 什么时候需要选择 Skill
- 什么时候只做提示词优化
- 什么时候必须停下来等用户确认

## 当前四条生成链路

> **2026-07-06 重构**：Direct Image / Direct Video / Image-to-Video 归 **BottomDock 直生**（纯参数透传，零优化零 understanding）；**Agent 对话**只走对话编排（L1 轻量 classifier → 轻量编排 / Full Canvas），永远走 Prompt Optimizer，不裸直接生成。下述四链路的链路细节仍有效，但归属入口按重构调整。判定分层见 `skill/rules/decision_layer.md`，详见 `generation_route_decision.md`。

### 1. Direct Image（Dock 直生）

适合用户直接要图片：

```text
做一张保温杯商品图
生成一张赛博朋克城市图
给这个产品换背景
```

链路：

```text
Image Understanding（如有图）
  -> Image Prompt Agent
  -> Prompt Optimizer
  -> Image Provider
  -> Canvas image_result
  -> 用户确认
```

对应文件：

- `skill/workflows/image_generation_prompt.md`
- `skill/workers/image_prompt_agent.md`
- `skill/references/image_prompt_contract.md`

### 2. Direct Video

适合轻量直接生成视频：

```text
生成一个小猫跑步的视频
做一个女孩在雨中跳舞的视频
生成一个赛博朋克城市镜头
```

链路：

```text
Direct Generation
  -> 轻量补全
  -> Prompt Optimizer
  -> Video Provider
  -> Canvas video_result
  -> 用户确认
```

对应文件：

- `skill/workflows/direct_generation.md`
- `skill/rules/generation_route_decision.md`

### 3. Image-to-Video

适合用户上传图后让它动起来：

```text
让这张图动起来
让图片里的产品旋转
把这个人物做成 5 秒视频
```

链路：

```text
Image Understanding
  -> Direct Generation
  -> Prompt Optimizer
  -> Video Provider
  -> Canvas video_result
  -> 用户确认
```

关键规则：

- 上传图片不等于 Agent 看懂图片。
- 如果主模型没有多模态能力，必须用视觉模型或让用户补充描述。
- 没有 `asset_understanding`，不能做图生图或图转视频。

对应文件：

- `skill/workflows/image_understanding.md`
- `skill/workers/image_understanding_agent.md`
- `skill/rules/multimodal_capability.md`

### 4. Full Video Canvas

适合复杂视频项目：

```text
做一个产品广告视频
做一个 UGC 种草视频
做一条短剧广告
做一个品牌宣传片
```

链路：

```text
Brief
  -> Skill Selector
  -> Stage Plan
  -> Storyboard
  -> 首批关键视觉
  -> Prompt Optimizer
  -> Video Provider
  -> Canvas video_result
  -> 用户确认
```

对应文件：

- `skill/workflows/video_agent_canvas.md`
- `skill/workers/storyboard_agent.md`
- `skill/workers/skill_selector.md`
- `skill/library/_index.md`

## 目录结构

```text
blue-whale-agent-workspace/
  README.md
  CLAUDE.md
  skill/
    SKILL.md
    workers/
    workflows/
    rules/
    references/
    library/
    memory/
```

### 顶层文件

| 文件 | 用途 |
|---|---|
| `README.md` | 给人看的项目总览 |
| `CLAUDE.md` | workspace 顶层入口(项目级工作规则 + 入口路标) |

### skill/workers

多 Agent 分工：

| Worker | 职责 |
|---|---|
| `director_agent.md` | 主 Agent 唯一权威(决策+角色+状态机+路由) |
| `brief_agent.md` | 渐进式收集需求 |
| `skill_selector.md` | 从 Skill 库选择创作套路 |
| `image_understanding_agent.md` | 图片识别和资产理解 |
| `image_prompt_agent.md` | 生图提示词草案 |
| `prompt_optimizer_agent.md` | 生成前提示词优化 |
| `storyboard_agent.md` | 脚本和分镜 |
| `generation_agent.md` | 生成任务说明 |
| `review_agent.md` | 结果检查和修改建议 |

### skill/workflows

核心流程：

| Workflow | 用途 |
|---|---|
| `direct_generation.md` | 直接图片/视频生成轻量流程 |
| `image_generation_prompt.md` | 生图提示词流程 |
| `image_understanding.md` | 图片识别流程 |
| `video_agent_canvas.md` | 完整视频画布流程 |

### skill/rules

硬规则：

| Rule | 用途 |
|---|---|
| `generation_route_decision.md` | 判断走哪条生成链路 |
| `progressive_disclosure.md` | 渐进式披露，少问但问关键 |
| `confirmation_gate.md` | 确认门，防止误推进 |
| `canvas_state_rules.md` | 画布状态作为事实来源 |
| `visible_reasoning.md` | 用户可见思考过程 |
| `skill_generation_priority.md` | Skill 与生成模型语法的优先级 |
| `product_switch_p0.md` | P0 产品切换 / 回到前一个产品 / 引用历史产品重新生成 |
| `multimodal_capability.md` | 多模态能力判断 |
| `prompt_optimization_chain.md` | 提示词优化链路 |

### skill/references

落地参考：

| Reference | 用途 |
|---|---|
| `blue_whale_architecture.md` | 整体架构说明 |
| `output_contract.md` | 用户可见输出格式 |
| `backend_implementation_contract.md` | 后端数据契约 |
| `frontend_canvas_interaction_contract.md` | 前端交互契约 |
| `image_prompt_contract.md` | 生图提示词格式 |
| `seedance_prompt_optimizer.md` | Seedance 2.0 官方提示词参考 |
| `worker_authoring_standard.md` | Worker 角色化编写标准 |
| `foundry_style_orchestration_notes.md` | Foundry 式编排借鉴说明 |

### skill/library

Skill 库：

```text
skill/library/
  _index.md
  raw/
```

当前已接入 60 个中文 Blue-Whale Skill。Agent 先读 `_index.md`，再按需读取 1-3 个具体 Skill，不一次性加载全部内容。

## 关键设计原则

### 1. 不是所有视频都走完整视频链路

“生成一个小猫跑步的视频”应该走 Direct Video。

“做一个保温杯 UGC 广告视频”才走 Full Video Canvas。

### 2. 上传图片不等于看懂图片

如果模型没有多模态能力，必须：

- 调用独立视觉模型，或
- 让用户补充图片描述

不能假装已经识别图片。

### 3. Skill 决定创意，模型规则决定语法

Skill 负责：

- 内容结构
- 风格方向
- 卖点表达
- 创意套路

Seedance / 生图规则负责：

- 素材引用
- 主体绑定
- 运镜和构图语法
- 稳定性约束
- 防水印、防变形

两者不能互相覆盖。

### 4. 提示词优化是中间层（Agent 链路）

**Agent 链路** Provider 前必须经过 Prompt Optimizer（技术规整 + 创意优化），不把用户原话直接发 Provider。

**Dock 直生豁免**——Dock 是纯参数透传管道（用户自负责 prompt 质量），不经过 Prompt Optimizer。两条入口的区分见 `BACKEND-API-PRD.md` §6。

### 5. 用户可以看到思考过程，但不能看到内部链路

前端展示 `visible_reasoning`：

```text
我看到画布里已有一张产品图。
这个需求更适合使用电商产品图 Skill。
我会先生成 3 个商品图方向供你确认。
```

不展示：

- prompt
- worker 文件名
- tool 参数
- JSON
- 文件路径
- 模型真实推理链

### 6. 所有关键结果都要进确认门

没有 ready 结果，不能确认。

用户只说“继续”，不能自动推进。

## 后续怎么用

### 如果要继续打磨编排

优先补：

- `examples/` 端到端案例
- 更细的产品图案例
- 更细的视频案例
- Skill 选择测试样例

### 如果要测试编排

先读：

- `tests/scenarios/acceptance_criteria.md`
- `tests/scenarios/route_decision_scenarios.md`
- `tests/scenarios/confirmation_gate_scenarios.md`
- `tests/scenarios/multimodal_scenarios.md`
- `tests/scenarios/prompt_optimization_scenarios.md`
- `tests/scenarios/product_switch_p0_scenarios.md`

### 如果要进入后端实现

先读：

- `skill/references/backend_implementation_contract.md`
- `skill/rules/canvas_state_rules.md`
- `skill/rules/confirmation_gate.md`
- `skill/rules/visible_reasoning.md`

### 如果要进入前端实现

先读：

- `skill/references/frontend_canvas_interaction_contract.md`
- `skill/references/output_contract.md`

### 如果要接 Seedance

先读：

- `skill/references/seedance_prompt_optimizer.md`
- `skill/rules/prompt_optimization_chain.md`
- `skill/rules/skill_generation_priority.md`

## 当前状态

当前工作台已经具备：

- CEO 路由器
- 四条生成链路
- 多 Agent 分工
- 中文 Skill 库
- 图像识别中间层
- 生图提示词链路
- Seedance 视频提示词参考
- Prompt Optimizer 中间层
- 确认门
- 用户可见思考过程
- 后端数据契约
- 前端交互契约
- Foundry 式主入口路由和子 workflow 思路
- 角色化 Worker 编写标准

下一步最值得补的是端到端案例，用真实用户输入检验整套流程是否自然、顺滑、不会误路由。
