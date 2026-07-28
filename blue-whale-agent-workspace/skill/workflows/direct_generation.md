# 轻量生成编排（Lightweight Generation Workflow）

> **⚠️ 已替代（2026-07-24，IK2D8R）**：本文件已**重写**为根 Skill `skill_director_workflow` + Reference `ref_generation_action_guide`，不再是运行时实现权威。剔除 decision_context 路由判断与固定 stage 表，改为顾问式多轮工作流。运行时以 `runtime-bundle/` 为准；目录级说明见 `skill/SKILL.md` 顶部横幅，迁移结论见 `docs/wayfinder/IK2D8R-first-runtime-bundle-migration.md`（workflows/ 段）。

> 这是 Agent 对话里的**轻量编排链路**（`decision_branch=new_task` + `suggested_route=lightweight`），**不是 BottomDock 直生**。
>
> - 用户要快、自负责 prompt → **Dock 直生**（零优化、零 understanding，直传 Provider），见 `BACKEND-API-PRD.md` §5.4 / §6
> - 用户要好、要 Agent 帮优化与追问 → **本链路**（永远走 Prompt Optimizer，图推理前做 understanding）

目标：在 Agent 对话里处理用户要「要好」的直接生成——简单图 / 轻量视频，Agent 帮补全维度、优化提示词、生成后停住确认。

适用于：

- 「生成一个小猫跑步的视频」
- 「做一张赛博朋克城市图」
- 「让这张图动起来」
- 「生成一个女孩在雨中跳舞的视频」
- 「做一张保温杯产品图」

> 以上场景 Dock 直生也能做。区别在入口选择：要快走 Dock，要 Agent 编排走本链路。

不适用于（→ Full Canvas，见 `video_agent_canvas.md`）：

- 需要完整广告策略的视频
- 需要多阶段脚本/分镜/关键视觉的营销视频
- 用户明确要求使用某个复杂 Skill
- 需要品牌 campaign 或多版本方案

## 核心原则

本链路是 Agent `new_task` 分支的轻量分流（vs Full Canvas 重编排），不强制走完整 Video Agent Canvas。

但它仍必须遵守：

- 图推理前做图片理解（Agent 链路特征；Dock 直生不做）
- 提示词优化（Agent 永远走 Prompt Optimizer；Dock 直生零优化）
- 模型能力判断
- 画布写入
- 结果确认门
- 用户可见思考过程

## 路由判断

进入条件：`decision_context.decision_branch=new_task` 且 `suggested_route=lightweight`（turn 前置已由 L1 classifier 算好，见 `decision_layer.md` / `generation_route_decision.md`）。Director 不再自判链路，只从用户消息补全生成维度。

L1 在以下特征时给 `lightweight`：

- 目标清楚
- 不涉及复杂营销策略
- 不要求多版本脚本
- 不需要完整阶段计划
- 结果可以一次生成后确认

示例：

```text
生成一个小猫在草地上跑步的视频
```

判断：

- 任务类型：direct text-to-video
- 主体：小猫
- 动作：跑步
- 场景：草地
- 缺失：风格、时长、画幅可默认或轻量追问

## 阶段

| 阶段 | 名称 | Agent | 产物 | 是否确认 |
|---|---|---|---|---|
| 1 | 读 decision_context | Director | generation_intent(来自 decision_context) | 否 |
| 2 | 轻量补问 | Brief | minimal_brief | 视情况 |
| 3 | 图片理解 | Image Understanding | asset_understanding | 有图时 |
| 4 | 提示词草案 | Image Prompt / Generation | prompt_draft | 否 |
| 5 | 提示词优化 | Prompt Optimizer | optimized_prompt | 否 |
| 6 | 生成任务 | Generation | GenerationJob + image/video canvas node | 否 |
| 7 | 结果确认 | Confirmation Gate | image/video result | 是 |

## Stage 1：读 decision_context

进入条件已由 L1 前置算好（见上「路由判断」）。Director 只从用户消息补全生成维度：

识别：

- 生成类型：image / video / image-to-image / image-to-video
- 主体
- 动作
- 场景
- 风格
- 是否有参考图
- 是否需要音频/台词

## Stage 2：轻量补问

如果用户描述已经足够，直接默认补全，不打断。

默认策略：

- 图片默认：商业/写实/高质量静态图，除非用户指定风格。
- 视频默认：5 秒、写实或用户指定风格、稳定镜头、无字幕无水印。
- 画幅默认：短视频优先 9:16；未指定平台时可用通用比例。

只有关键缺失才追问：

- 主体不清
- 动作不清
- 上传图用途不清
- 用户要求与模型能力冲突

追问示例：

```text
我可以直接生成。你想要写实风格，还是动画风格？
```

## Stage 3：图片理解

Agent 链路里，用户上传图片或说「这张图」，必须先进入 `image_understanding.md`。

没有 `asset_understanding`，不能做图生图或图转视频。（Dock 直生不在此列——Dock 直传 Provider，由 Provider 消费图。）

## Stage 4：提示词草案

### 直接生图

进入 `image_generation_prompt.md`。

### 直接生视频

由 Generation Agent 生成视频提示词草案：

```text
视频提示词草案
- 主体：
- 动作：
- 场景：
- 镜头：
- 风格：
- 时长：
- 必须避免：
- 提示词草案：
```

### 图转视频

必须引用图片理解结果，并明确：

- 哪些主体保持不变
- 动起来的方式
- 镜头如何运动
- 是否保留背景

## Stage 5：提示词优化

Agent 链路永远走 Prompt Optimizer（这是与 Dock 直生零优化的本质区别）。

Prompt Optimizer 根据目标模型优化。

Seedance 2.0 视频生成必须读取：

- `seedance_prompt_optimizer.md`

图片生成必须读取：

- `image_prompt_contract.md`

## Stage 6：生成任务

创建 GenerationJob，并同步一个素材画布节点作为占位：

```text
generation_job
- job_id:
- type: image / video
- target_model:
- optimized_prompt: 内部字段，不展示给普通用户
- status: queued / processing / succeeded / failed

canvas node
- type: image / video
- stage_id:
- asset_ref: null
- status: queued / generating
```

任务完成后：

- `succeeded` -> 画布节点 `ready`，绑定输出 `asset_ref`
- `failed` -> 画布节点 `failed`，对话消息展示可理解错误

## Stage 7：结果确认

生成结果 ready 后进入确认门。

用户可操作：

- 确认保留
- 修改提示词再生成
- 重新生成
- 继续扩展为完整视频项目

## 示例：小猫跑步视频

用户：

```text
我想生成一个小猫跑步的视频
```

visible_reasoning：

```text
我理解你想直接生成一个轻量视频，不需要完整广告编排。
我会把主体、动作和场景整理成视频提示词，再做模型适配。
生成完成后会放到画布上让你确认。
```

默认补全：

```text
主体：小猫
动作：在草地上轻快跑步
场景：自然户外草地
风格：写实、明亮、自然光
时长：5 秒
镜头：低机位轻微跟拍
约束：无字幕、无水印、动作自然、不变形
```

优化后提示词示例：

```text
一只毛茸茸的小猫在阳光下的绿色草地上轻快跑步，低机位轻微跟拍，小猫动作自然连贯，耳朵和尾巴随跑动轻微摆动，背景有柔和的自然虚化。写实风格，明亮自然光，画面稳定，细节清晰，动作不卡顿，小猫身体不变形。保持无字幕，不要生成水印，不要生成 Logo。
```

## 禁止

- 不把简单生成任务强制升级成完整广告 workflow（Full Canvas）。
- 不跳过 Prompt Optimizer（Agent 链路铁律；Dock 直生零优化不在此列）。
- 不在缺少图片理解时做图转视频（Agent 链路；Dock 直传 Provider 不在此列）。
- 不把生成成功自动当成用户确认。
- 不与 Dock 直生混淆——Dock 直传 Provider、零优化、零 understanding；本链路永远走 Optimizer + 图推理前 understanding。
