# Generation Route Decision Rule

本规则定义用户要生成图片或视频时，**走 Dock 直生还是 Agent 对话**，以及 Agent 内部如何分流。

## 一句话规则

先按「要快 / 要好」选入口：**Dock = 直接生成（要快，用户自负责 prompt），Agent = 对话编排（要好，Agent 帮优化）**。Agent 内部再由 **L1 轻量 classifier（haiku 级，独立模型，非主 Agent 自判）** 给出意图方向与 `suggested_route` 软建议，主 Agent 据此路由到轻量编排或 Full Canvas。判定分层架构见 `decision_layer.md`。

## 两条入口

| 入口 | 承担 | 定位 |
|---|---|---|
| **BottomDock 直生** | 所有直接生成：Direct Image / Direct Video / Image-to-Video | 要快——用户手填参数 + prompt，零优化、零 understanding，直传 Provider |
| **Agent 对话** | L1 意图识别 → 轻量编排 / Full Canvas / 非生成回复 | 要好——永远走 Prompt Optimizer，图推理前做 understanding |

> Image-to-Video 两条入口都能做：Dock = 图 + prompt 直传 Provider；Agent = understanding + 优化 + 生成。用户按要快 / 要编排选。

## Dock 直生（无路由判定）

Dock 不判链路——用户在 Dock 选 type（image / video）、填参数 + prompt、选 reference_asset，直传 Provider。零优化、零 understanding（Provider 自己消费图）。详见 `BACKEND-API-PRD.md` §5.4 / §6。

## Agent 对话：L1 轻量 classifier（统一入口）

用户消息进 Agent,turn 前置先过 **L1 轻量 classifier**(独立 haiku 级模型,**不是主 Agent 自判**;硬状态由后端代码先算,`has_generating` 直接短路)。L1 输出 `intent_direction` + 仅 `new_task` 带 `suggested_route`(软建议),主 Agent 在 `new_task` branch 按建议路由到三条:

| 分流 | L1 输出 | 触发 | 链路 |
|---|---|---|---|
| **轻量编排** | `new_task` + `suggested_route=lightweight` | 简单图 / 轻量视频（「生成一张猫图」「5 秒小猫视频」） | 追问补全（仅方向歧义）+ Skill（有匹配才用）+ 优化提示词（硬停确认）+ 生成 |
| **Full Canvas** | `new_task` + `suggested_route=full_canvas` | 广告 / UGC / 短剧 / 品牌片 / 需要脚本分镜 | Brief → Skill → 分镜 → 视觉 → 视频（4 硬停 + 3 软过，见 `video_agent_canvas.md`） |
| **非生成** | `consult` / `revise` / `product_switch` / `confirm_pending` 等 | 咨询 / 修改 / 确认 / 切换 Skill | 对话回复（不启动 GenerationJob） |

### 判定信号

- **强信号（触发 Full Canvas）**：「广告 / UGC / 短剧 / 品牌片 / 脚本 / 分镜」
- **强信号（触发轻量）**：「生成一张图 / X 秒视频 / 单个镜头」
- **弱信号（歧义）** → 默认轻量编排

### 判定必须暴露 + 可推翻

L1 判定结果必须进 `visible_reasoning`，说人话，且在 Job 启动**前**暴露（推翻不烧生成资源）。用户可对话推翻（「不，我要完整编排」）→ 主 Agent 推翻 L1 软建议切分流（推翻规则见 `decision_layer.md`），已生成结果作为参考素材保留。

visible_reasoning 示例：

**轻量编排**：

```text
我理解你想直接生成一个轻量视频，不需要完整广告编排。我会先整理主体、动作和场景，再优化成模型可执行提示词。如果你想要完整脚本+分镜的广告片，告诉我。
```

**Full Canvas**：

```text
这个需求更像完整视频创作，需要先确认 Brief、选择 Skill，再进入脚本分镜和生成阶段。
```

## Prompt-only 链路

如果用户只是说：

- 优化这个提示词
- 帮我改成 Seedance 能用的提示词
- 帮我把这个图生视频 prompt 写好

则只走 Prompt Optimizer，不调用 Provider。

## 用户上传图片但没说用途

不要自动生成。应该问：

```text
我看到你上传了图片。你想用它做什么？
1. 生成商品图
2. 让图片动起来
3. 做成视频广告
4. 只分析图片内容
```

## 禁止

- 禁止 Agent 裸直接生成（Direct 已移到 Dock；Agent 永远走 Prompt Optimizer）。
- 禁止把复杂广告视频当成一句 prompt 直接发 Provider（Full Canvas 必须走编排）。
- 禁止用户上传图后自动假设用途。
- 禁止跳过图片理解做图转视频（Agent 链路；Dock 直传 Provider 不在此列）。
- 禁止 L1 判定不暴露（用户必须能看到 Agent 判走哪条分流）。
