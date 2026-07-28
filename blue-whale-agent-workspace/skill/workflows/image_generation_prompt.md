# Image Generation Prompt Workflow

> **⚠️ 已替代（2026-07-24，IK2D8R）**：本文件已**重写**为 Bundle Reference `ref_generation_action_guide`，不再是运行时实现权威。图片动作参数指引归并到生成动作指南。运行时以 `runtime-bundle/` 为准；目录级说明见 `skill/SKILL.md` 顶部横幅，迁移结论见 `docs/wayfinder/IK2D8R-first-runtime-bundle-migration.md`（workflows/ 段）。

目标：把用户的图片生成需求转成稳定、可执行、可确认的生图提示词。

## 触发条件

- 用户要做产品图、商品图、海报图、关键帧、风格图
- 视频 workflow 进入首批关键视觉阶段
- 用户要求图生图、换背景、换场景、改风格

## 阶段

| 阶段 | 名称 | Agent | 产物 | 是否需要确认 |
|---|---|---|---|---|
| 1 | 读 decision_context | Director | image_task_type(来自 decision_context) | 否 |
| 2 | 资产理解检查 | Image Understanding | asset_understanding | 必要时 |
| 3 | 生图提示词草案 | Image Prompt | prompt_draft | 否 |
| 4 | 提示词优化 | Prompt Optimizer | optimized_prompt | 否 |
| 5 | 生成任务 | Generation | GenerationJob + image canvas node | 否 |
| 6 | 图片结果确认 | Provider | ready image canvas node | 是 |

## Stage 1：读 decision_context

进入条件:`decision_context.decision_branch=new_task` 且生图意图(turn 前置已算好,见 `decision_layer.md`)。Director 不再自判,只判断图片任务类型:

判断任务类型：

- 文生图
- 图生图
- 产品图
- 关键帧
- 风格图
- 场景图
- 局部重做

## Stage 2：资产理解检查

如果任务依赖上传图片，必须先有 `asset_understanding`。

没有则进入 `image_understanding.md`。

## Stage 3：生图提示词草案

Image Prompt Agent 输出：

- 主体
- 场景
- 构图
- 光影
- 风格
- 必须保留
- 必须避免
- prompt draft

## Stage 4：提示词优化

Prompt Optimizer Agent 根据目标模型优化。

优化只允许：

- 提高清晰度
- 补充构图和光影
- 增加稳定性约束
- 规范素材引用
- 增加负面约束

不允许：

- 改变已选 Skill
- 改变产品外观
- 删除核心卖点
- 改变用户确认的风格

## Stage 5：生成任务

创建 GenerationJob，并同步一个 `image` 画布节点作为 queued / generating 占位。给用户展示对话消息：

```text
我会先生成 {N} 张图片方向：
1. {方向一}
2. {方向二}
3. {方向三}

生成完成后放到画布上让你确认。
```

任务完成后：

- `succeeded` -> 画布节点 `ready`，绑定输出 `asset_ref`
- `failed` -> 画布节点 `failed`，对话消息展示可理解错误

## Stage 6：图片结果确认

图片 ready 后进入确认门。

用户可以：

- 确认保留
- 局部修改
- 重做
- 选择其中一张进入视频阶段

## 禁止

- 不在缺少图片理解时执行图生图。
- 不直接把用户一句话发给 Provider。
- 不跳过提示词优化层。
- 不把图片生成成功自动当成用户确认。
