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

## 当前入口与 Agent 分支

系统现在按入口分层，而不是按旧的 Direct / Image-to-Video / Full Canvas 三链路做主口径。

### 1. BottomDock 直生（要快）

用户在 Dock 里选择 image / video / image-to-video，填写参数和 prompt，直接交给 Provider。

```text
Dock 参数 + prompt + reference_asset
  -> Provider
  -> Asset
  -> Canvas image / video node
```

边界：

- 零 Agent 编排
- 零 Prompt Optimizer
- 零 Image Understanding
- Provider 自己消费图片像素

### 2. Agent 对话（要好）

用户从 AgentChatPanel 发自然语言时，先走判定分层：

```text
后端 decision_context
  -> L1 轻量 classifier
  -> decision_branch
  -> 主 Agent switch 收口
```

Agent 内部分支：

| 分支 | 适合场景 | 结果 |
|---|---|---|
| `new_task + lightweight` | 简单图 / 轻量视频 / 图转视频编排 | Brief 轻量补全 -> understanding（有图）-> Prompt Optimizer -> GenerationJob |
| `new_task + full_canvas` | UGC / 广告 / 短剧 / 品牌片 / 需要脚本分镜 | Brief -> Skill -> 分镜 -> 首批视觉 -> 视频 |
| `prompt_only` | 只要求优化 / 改写提示词 | 只输出 `optimized_prompt_preview`，不启 GenerationJob，不写 Canvas |
| `revise_canvas` | 修改当前画布结果 | 复用当前 workflow 重生，结果回确认门 |
| `product_switch` | 换产品 / 回到前一个产品 | 更新 active / previous 产品上下文后重新确认 Brief / Skill |
| `consult` / `clarify` | 咨询或意图不明 | 直接答复或追问，不启 Job |

对应权威文件：

- `skill/rules/decision_layer.md`
- `skill/rules/generation_route_decision.md`
- `skill/workers/director_agent.md`
- `skill/workflows/direct_generation.md`
- `skill/workflows/video_agent_canvas.md`
- `skill/workflows/image_generation_prompt.md`
- `skill/workflows/image_understanding.md`

## 目录结构

```text
blue-whale-agent-workspace/
  README.md
  AGENTS.md              # 跨工具协作入口（@CLAUDE.md，给非 Claude Code 的 Agent 读）
  CLAUDE.md              # 工作台协作规则（不是 Skill 入口）
  skill/                 # ← 对外 Skill 包，安装 = 复制这整个目录
    SKILL.md
    workers/
    workflows/
    rules/
    references/
    library/
    memory/
  *-PRD.md               # 产品/接口需求（工作台内部，不进 Skill 包）
  tests/                 # 编排验证场景（工作台内部）
```

### 对外分层（谁是发布单元）

工作台里有四类东西，对外职责不同：

| 层 | 目录 / 文件 | 定位 | 进 Skill 包？ |
|---|---|---|---|
| 工作台入口 | `AGENTS.md` / `CLAUDE.md` | 在这个工作台里怎么协作（给人 / AI 看） | 否 |
| **Skill 包** | `skill/` | 可安装的编排 Skill，**对外发布单元** | **是** |
| 产品 / 接口设计 | `*-PRD.md`、`FRONTEND-INTEGRATION-ROADMAP.md` | 给前后端实现看的需求 | 否 |
| 测试 | `tests/` | 验证编排路由的场景 | 否 |

**装这个 Skill = 复制 `skill/` 目录**，其余都是工作台内部产物。

### 顶层文件

| 文件 | 用途 |
|---|---|
| `README.md` | 给人看的项目总览 |
| `AGENTS.md` | 跨工具协作入口（`@CLAUDE.md`，给 Codex / Cursor 等非 Claude Code 的 Agent 读） |
| `CLAUDE.md` | 工作台协作规则（角色 / 七大原则 / 工作方式），不是 Skill 入口 |

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

“生成一个小猫跑步的视频”如果来自 Agent 对话，应该走 `new_task + lightweight`；如果来自 Dock，则走 BottomDock 直生。

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
- 两入口路由（BottomDock 直生 / Agent 对话）
- 多 Agent 分工
- 中文 Skill 库
- 图像识别中间层
- 生图提示词链路
- Seedance 视频提示词参考
- Prompt Optimizer 中间层（含 prompt_only 分支）
- 确认门
- 用户可见思考过程
- 后端数据契约
- 前端交互契约
- Foundry 式主入口路由和子 workflow 思路
- 角色化 Worker 编写标准

下一步最值得补的是端到端案例，用真实用户输入检验整套流程是否自然、顺滑、不会误路由。
