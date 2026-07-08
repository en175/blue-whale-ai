# Image Understanding Workflow

目标：用户上传图片后，先把图片转成可供 Agent 使用的资产理解结果。

这是 Video Agent Canvas 的中间层，不是最终创作阶段。

> **归属 Agent 链路**：understanding 是给 Agent 的 LLM 推理用的（Agent 基于图做 brief / skill / 分镜）。**Dock 直生不经过本 workflow**——Dock 把图随 `reference_asset_ids` 直传 Provider，Provider 自己消费图像素。详见 `backend_implementation_contract.md` 硬约束 8。

## 触发条件

- 用户上传图片
- 画布已有图片节点
- 用户说“用这张图”“参考这个图片”“把这个产品做成图/视频”
- 图生图或图片转视频任务开始前

## 阶段

| 阶段 | 名称 | 产物 | 是否需要用户确认 |
|---|---|---|---|
| 1 | 能力判断 | multimodal_status | 否 |
| 2 | 图片识别 | asset_understanding | 视情况 |
| 3 | 缺口补充 | user_asset_description | 是 |
| 4 | 持久化 | asset.understanding_data（写 asset 表，非画布节点） | 否 |

## Stage 1：能力判断

读取系统能力：

- 主 LLM 是否支持图片输入
- 是否配置独立视觉模型
- 是否只能处理文本

输出：

```text
multimodal_status:
- primary_llm_vision: true/false
- vision_model_available: true/false
- strategy: direct_vision / vision_adapter / ask_user
```

## Stage 2：图片识别

### direct_vision

主 LLM 直接识别图片。

### vision_adapter

独立视觉模型先识别图片，再把结构化摘要交给主 LLM。

### ask_user

没有视觉能力，不识别图片。向用户索要描述。

## Stage 3：缺口补充

当无法识别或识别不确定时，只问当前任务必要问题。

```text
我还需要确认图片里的关键信息：
1. 图片里的主体是什么？
2. 哪些外观特征必须保留？
3. 这张图是产品参考、风格参考，还是构图参考？
```

## Stage 4：持久化到 asset 表

把 understanding 写入 `assets.understanding_data`（数据本体），`understanding_status` 翻 `ready`。**不是画布节点**——画布只承载 image / video 素材，understanding 数据挂 asset 表（见 `BACKEND-API-PRD.md` §7）。

`understanding_data` 字段：

```text
subject
visual_traits
scene
text_or_logo
usage_intent
must_keep
can_change
uncertainties
source: direct_vision / vision_adapter / user_description
```

> ChatMessage 的 `asset_understanding` variant 是从这份数据**派生**的展示摘要（给用户读），不是数据本体。

## 阻断规则

以下情况不能进入图生图或图片转视频：

- 参考图未识别，且用户也未补充描述
- 不知道图片是产品参考、风格参考还是构图参考
- 必须保留的主体特征不清楚

## 禁止

- 不把图片上传成功等同于图片已理解。
- 不把文件名、URL 或 asset id 当成图片内容。
- 不假装模型看懂了图片。
